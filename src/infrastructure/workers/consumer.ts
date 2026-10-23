import type { Message } from '@aws-sdk/client-sqs';
import {
  ApplicationError,
  requireObject,
  requireIdentifier,
  hashPayload,
} from '../../application/contracts';
import { DomainError } from '../../domain/money';
import type { Wagering } from '../../application/wagering';
import { SqsGateway } from '../messaging/sqs';
import { context, log, metric } from '../telemetry';
const MAX_DELIVERIES = 5;
const VISIBILITY_SECONDS = 30;
const HEARTBEAT_INTERVAL_MS = 10000;
export class WagerConsumer {
  constructor(
    private readonly broker: SqsGateway,
    private readonly wagering: Wagering,
  ) {}
  async handle(queue: string, message: Message): Promise<void> {
    const heartbeat = this.startVisibilityHeartbeat(queue, message);
    try {
      await this.processEnvelope(message);
      // The use case returns after commit, including terminal business rejections.
      await this.broker.ack(queue, message);
    } catch (error) {
      await this.handleFailure(queue, message, error);
    } finally {
      clearInterval(heartbeat);
    }
  }
  private async processEnvelope(message: Message): Promise<void> {
    const envelope = requireObject(JSON.parse(message.Body ?? ''));
    const messageId = requireIdentifier(envelope.messageId);
    if (
      envelope.type !== 'WagerTransactionRequested' ||
      typeof envelope.occurredAt !== 'string' ||
      !Number.isFinite(Date.parse(envelope.occurredAt))
    ) {
      throw new ApplicationError('INVALID_ENVELOPE', 400);
    }
    const { idempotencyKey, ...data } = requireObject(envelope.data);
    await context.run({ correlationId: messageId, messageId }, () =>
      this.wagering.submit(data, idempotencyKey, {
        consumerName: 'wager-transactions',
        messageId,
        payloadHash: hashPayload(envelope),
      }),
    );
  }
  private async handleFailure(queue: string, message: Message, error: unknown): Promise<void> {
    const deliveryCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
    const permanent = isPermanentFailure(error);
    if (permanent || deliveryCount >= MAX_DELIVERIES) {
      await this.moveToDeadLetter(
        queue,
        message,
        permanent ? 'PERMANENT_MESSAGE_ERROR' : 'RETRIES_EXHAUSTED',
      );
      return;
    }
    const retryDelay = Math.min(60, 2 ** Math.min(deliveryCount, 6));
    await this.broker.visibility(queue, message, retryDelay);
    metric('wager_retries_total');
    log('message_retry', {
      messageId: message.MessageId,
      code: 'TRANSIENT_INFRASTRUCTURE',
    });
  }
  private async moveToDeadLetter(queue: string, message: Message, code: string): Promise<void> {
    if (code === 'RETRIES_EXHAUSTED') await this.auditPermanentFailure(message);
    const { dlq } = await this.broker.queues();
    await this.broker.send(
      dlq,
      message.Body ?? '',
      message.MessageId ?? 'invalid',
      hashPayload({ body: message.Body }),
    );
    await this.broker.ack(queue, message);
    metric('wager_dlq_total');
    log('message_dlq', { messageId: message.MessageId, code });
  }
  private async auditPermanentFailure(message: Message): Promise<void> {
    try {
      const envelope = requireObject(JSON.parse(message.Body ?? ''));
      const messageId = requireIdentifier(envelope.messageId);
      const { idempotencyKey, ...data } = requireObject(envelope.data);
      const result = await this.wagering.recordFailure(data, idempotencyKey, {
        consumerName: 'wager-transactions',
        messageId,
        payloadHash: hashPayload(envelope),
      });
      if (result.status === 'FAILED' && !result.idempotentReplay)
        metric('wager_transactions_total{status="FAILED"}');
    } catch {
      log('failure_audit_deferred', { messageId: message.MessageId, code: 'SEE_DLQ_ENVELOPE' });
    }
  }
  private startVisibilityHeartbeat(
    queue: string,
    message: Message,
  ): ReturnType<typeof setInterval> {
    return setInterval(() => {
      void this.broker.visibility(queue, message, VISIBILITY_SECONDS).catch(() =>
        log('visibility_heartbeat_failed', {
          messageId: message.MessageId,
          code: 'BROKER_UNAVAILABLE',
        }),
      );
    }, HEARTBEAT_INTERVAL_MS);
  }
}
function isPermanentFailure(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof ApplicationError && error.status < 500) ||
    error instanceof DomainError
  );
}
