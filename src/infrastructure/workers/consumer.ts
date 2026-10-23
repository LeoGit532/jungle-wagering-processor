import type { Message } from '@aws-sdk/client-sqs';
import { ApplicationError, hashPayload } from '../../application/contracts';
import { parseWagerRequest } from '../../application/wager-request';
import { DomainError } from '../../domain/errors';
import type { Wagering } from '../../application/wagering';
import type { SqsGateway } from '../messaging/sqs';
import {
  MAX_DELIVERY_ATTEMPTS,
  MAX_DELIVERY_BACKOFF_SECONDS,
  MESSAGE_VISIBILITY_SECONDS,
  VISIBILITY_HEARTBEAT_MS,
} from '../messaging/queue-policy';
import { context, log, metric } from '../telemetry';

type ConsumerBroker = Pick<SqsGateway, 'ack' | 'visibility' | 'queues' | 'send'>;
type WagerProcessor = Pick<Wagering, 'submit' | 'recordFailure'>;
type DeadLetterReason = 'PERMANENT_MESSAGE_ERROR' | 'RETRIES_EXHAUSTED';

export class WagerConsumer {
  constructor(
    private readonly broker: ConsumerBroker,
    private readonly wagering: WagerProcessor,
  ) {}

  async handle(queue: string, message: Message): Promise<void> {
    const heartbeat = this.startVisibilityHeartbeat(queue, message);
    try {
      await this.processEnvelope(message);
      // O caso de uso só retorna após commit, inclusive quando confirma uma rejeição de negócio.
      await this.broker.ack(queue, message);
    } catch (error) {
      await this.handleFailure(queue, message, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async processEnvelope(message: Message): Promise<void> {
    const request = parseWagerRequest(message.Body ?? '');
    await context.run({ correlationId: request.messageId, messageId: request.messageId }, () =>
      this.wagering.submit(request.data, request.idempotencyKey, request.inbox),
    );
  }

  private async handleFailure(queue: string, message: Message, error: unknown): Promise<void> {
    const deliveryCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
    const permanent = isPermanentFailure(error);
    if (permanent || deliveryCount >= MAX_DELIVERY_ATTEMPTS) {
      const reason = permanent ? 'PERMANENT_MESSAGE_ERROR' : 'RETRIES_EXHAUSTED';
      await this.moveToDeadLetter(queue, message, reason);
      return;
    }

    const retryDelay = Math.min(MAX_DELIVERY_BACKOFF_SECONDS, 2 ** Math.min(deliveryCount, 6));
    await this.broker.visibility(queue, message, retryDelay);
    metric('wager_retries_total');
    log('message_retry', { messageId: message.MessageId, code: 'TRANSIENT_INFRASTRUCTURE' });
  }

  private async moveToDeadLetter(
    queue: string,
    message: Message,
    reason: DeadLetterReason,
  ): Promise<void> {
    if (reason === 'RETRIES_EXHAUSTED') {
      await this.auditPermanentFailure(message);
    }
    const { dlq } = await this.broker.queues();
    await this.broker.send(
      dlq,
      message.Body ?? '',
      message.MessageId ?? 'invalid',
      hashPayload({ body: message.Body }),
    );
    await this.broker.ack(queue, message);
    metric('wager_dlq_total');
    log('message_dlq', { messageId: message.MessageId, code: reason });
  }

  private async auditPermanentFailure(message: Message): Promise<void> {
    try {
      const request = parseWagerRequest(message.Body ?? '');
      const result = await context.run(
        { correlationId: request.messageId, messageId: request.messageId },
        () => this.wagering.recordFailure(request.data, request.idempotencyKey, request.inbox),
      );
      if (result.status === 'FAILED' && !result.idempotentReplay) {
        metric('wager_transactions_total{status="FAILED"}');
      }
    } catch {
      // Banco indisponível não pode receber auditoria; o envelope permanece recuperável na DLQ.
      log('failure_audit_deferred', { messageId: message.MessageId, code: 'SEE_DLQ_ENVELOPE' });
    }
  }

  private startVisibilityHeartbeat(
    queue: string,
    message: Message,
  ): ReturnType<typeof setInterval> {
    return setInterval(() => {
      void this.broker.visibility(queue, message, MESSAGE_VISIBILITY_SECONDS).catch(() =>
        log('visibility_heartbeat_failed', {
          messageId: message.MessageId,
          code: 'BROKER_UNAVAILABLE',
        }),
      );
    }, VISIBILITY_HEARTBEAT_MS);
  }
}

function isPermanentFailure(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof ApplicationError && error.status < 500) ||
    error instanceof DomainError
  );
}
