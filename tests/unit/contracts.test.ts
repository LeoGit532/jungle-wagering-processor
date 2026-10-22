import { expect, test } from 'bun:test';
import {
  canonicalJson,
  hashPayload,
  parseWager,
  parseWallet,
} from '../../src/application/contracts';
const id = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
const valid = {
  providerId: 'provider',
  externalTransactionId: 'tx',
  playerId: id,
  walletId: id,
  roundId: 'round',
  gameId: 'game',
  kind: 'BET',
  money: { amount: '10.00', currency: 'BRL' },
};
test('canonical hash sorts nested keys and preserves financial strings', () => {
  expect(hashPayload({ b: 2, a: { z: 3, c: 1 } })).toBe(hashPayload({ a: { c: 1, z: 3 }, b: 2 }));
  expect(canonicalJson({ money: { currency: 'BRL', amount: '10.00' } })).toBe(
    '{"money":{"amount":"10.00","currency":"BRL"}}',
  );
  expect(hashPayload({ ...valid, money: { amount: '10.00', currency: 'BRL' } })).not.toBe(
    hashPayload({ ...valid, money: { amount: '11.00', currency: 'BRL' } }),
  );
});
test.each(['1', '1.0', '1.001', '-1.00', '1e2', '10000000000000000000000000000.00'])(
  'HTTP rejects invalid amount %s',
  (amount) => {
    expect(() => parseWager({ ...valid, money: { amount, currency: 'BRL' } })).toThrow();
  },
);
test('boundary rejects malformed UUID, numeric money, reserved provider and OPENING', () => {
  expect(() => parseWallet({ playerId: 'oops', initialBalance: valid.money })).toThrow();
  expect(() => parseWager({ ...valid, money: { amount: 10, currency: 'BRL' } })).toThrow();
  expect(() => parseWager({ ...valid, providerId: '__internal__' })).toThrow();
  expect(() => parseWager({ ...valid, kind: 'OPENING' })).toThrow();
  expect(() => parseWager({ ...valid, payloadHash: 'injected' })).toThrow('UNKNOWN_FIELD');
});
