import { expect, test } from 'bun:test';
import { hashPayload } from '../../src/application/contracts';
import { parseWagerRequest } from '../../src/application/wager-request';

function envelope() {
  return {
    messageId: 'message-1',
    type: 'WagerTransactionRequested',
    occurredAt: '2026-10-23T12:00:00.000Z',
    data: {
      idempotencyKey: 'provider:transaction-1',
      providerId: 'provider',
      money: { amount: '25.00', currency: 'BRL' },
    },
  };
}

test('request parsing separates transport identity from financial data and hashes the full envelope', () => {
  const input = envelope();
  const parsed = parseWagerRequest(JSON.stringify(input));
  expect(parsed.messageId).toBe(input.messageId);
  expect(parsed.idempotencyKey).toBe(input.data.idempotencyKey);
  expect(parsed.data).toEqual({ providerId: 'provider', money: input.data.money });
  expect(parsed.inbox).toEqual({
    consumerName: 'wager-transactions',
    messageId: input.messageId,
    payloadHash: hashPayload(input),
  });
  expect(parsed.inbox.payloadHash).not.toBe(hashPayload(parsed.data));
});

test.each([
  ['type', { type: 'WalletBalanceChanged' }],
  ['date', { occurredAt: 'invalid-date' }],
  ['messageId', { messageId: '' }],
  ['data', { data: [] }],
  ['idempotencyKey', { data: { idempotencyKey: '' } }],
])('request parsing rejects invalid %s before financial processing', (_field, changes) => {
  expect(() => parseWagerRequest(JSON.stringify({ ...envelope(), ...changes }))).toThrow();
});

test('malformed JSON and non-object envelopes remain permanent input errors', () => {
  expect(() => parseWagerRequest('not-json')).toThrow(SyntaxError);
  expect(() => parseWagerRequest('null')).toThrow('INVALID_PAYLOAD');
  expect(() => parseWagerRequest('[]')).toThrow('INVALID_PAYLOAD');
});
