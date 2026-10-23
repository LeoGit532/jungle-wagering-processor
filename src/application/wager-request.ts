import { ApplicationError, hashPayload, requireIdentifier, requireObject } from './contracts';
import type { InboxContext } from './ports/wagering';

export interface WagerRequest {
  readonly messageId: string;
  readonly data: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly inbox: InboxContext;
}

/** Valida o envelope de transporte sem misturar suas regras com o contrato financeiro. */
export function parseWagerRequest(body: string): WagerRequest {
  const envelope = requireObject(JSON.parse(body));
  const messageId = requireIdentifier(envelope.messageId);
  if (
    envelope.type !== 'WagerTransactionRequested' ||
    typeof envelope.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(envelope.occurredAt))
  ) {
    throw new ApplicationError('INVALID_ENVELOPE', 400);
  }

  const { idempotencyKey, ...data } = requireObject(envelope.data);
  return {
    messageId,
    data,
    idempotencyKey: requireIdentifier(idempotencyKey),
    inbox: {
      consumerName: 'wager-transactions',
      messageId,
      // A inbox identifica o envelope inteiro; Wagering calcula o hash de negócio separadamente.
      payloadHash: hashPayload(envelope),
    },
  };
}
