import { expect, test } from 'bun:test';
import { InboxMessage } from '../../src/domain/inbox-message';
import { OutboxMessage } from '../../src/domain/outbox-message';
import { Money, MAX_MONEY_AMOUNT } from '../../src/domain/money';
import { Wallet } from '../../src/domain/wallet';
const at = '2026-10-22T12:00:00.000Z';
const event = () => ({
  toJSON: () => ({
    eventId: crypto.randomUUID(),
    aggregateId: crypto.randomUUID(),
    eventType: 'TestEvent',
    occurredAt: at,
    data: { money: { amount: '10.00', currency: 'BRL' } },
  }),
});
test('inbox transitions once and preserves the original processed timestamp', () => {
  const message = InboxMessage.receive({
    messageId: 'm',
    consumerName: 'consumer',
    payloadHash: 'hash',
    receivedAt: at,
  });
  expect(message.isProcessed()).toBe(false);
  expect(message.matchesPayload('hash')).toBe(true);
  expect(message.matchesPayload('other')).toBe(false);
  message.markProcessed(at);
  message.markProcessed('2026-10-23T12:00:00.000Z');
  expect(message.snapshot.processedAt).toBe(at);
});
test('outbox retries exponentially and has a bounded schedule', () => {
  const message = OutboxMessage.enqueue(event());
  expect(message.isDue(new Date(at))).toBe(true);
  message.scheduleRetry(new Date(at));
  expect(message.snapshot.attempts).toBe(1);
  expect(message.snapshot.nextAttemptAt).toBe('2026-10-22T12:00:01.000Z');
  expect(message.isDue(new Date(at))).toBe(false);
  for (let attempt = 0; attempt < 10; attempt++) message.scheduleRetry(new Date(at));
  expect(Date.parse(message.snapshot.nextAttemptAt!) - Date.parse(at)).toBe(60000);
});
test('published outbox cannot retry or publish twice', () => {
  const message = OutboxMessage.enqueue(event());
  message.markPublished(new Date(at));
  expect(message.isPending()).toBe(false);
  expect(message.isDue(new Date(at))).toBe(false);
  expect(() => message.scheduleRetry(new Date(at))).toThrow('OUTBOX_ALREADY_PUBLISHED');
  expect(() => message.markPublished(new Date(at))).toThrow('OUTBOX_ALREADY_PUBLISHED');
});
test('outbox snapshots deeply isolate their payload from caller mutation', () => {
  const envelope = event().toJSON();
  const message = OutboxMessage.enqueue({ toJSON: () => envelope });
  envelope.data.money.amount = '99.00';
  expect((message.snapshot.payload.data as { money: { amount: string } }).money.amount).toBe(
    '10.00',
  );
  expect(Object.isFrozen(message.snapshot.payload.data)).toBe(true);
});
test('exact monetary storage limit is validated before persistence', () => {
  expect(Money.from({ amount: MAX_MONEY_AMOUNT, currency: 'BRL' }).toString()).toBe(
    MAX_MONEY_AMOUNT,
  );
  expect(() => Money.from({ amount: '10000000000000000000000000000.00', currency: 'BRL' })).toThrow(
    'AMOUNT_OUT_OF_RANGE',
  );
});
test('credit overflow preserves wallet state and version', () => {
  const wallet = Wallet.open({
    id: 'wallet',
    playerId: 'player',
    initialBalance: Money.maximum('BRL'),
    at,
  });
  expect(() =>
    wallet.credit(Money.from({ amount: '0.01', currency: 'BRL' }), 'credit', 'entry', at),
  ).toThrow('BALANCE_LIMIT_EXCEEDED');
  expect(wallet.snapshot.version).toBe(1);
  expect(wallet.snapshot.balance.toString()).toBe(MAX_MONEY_AMOUNT);
});
