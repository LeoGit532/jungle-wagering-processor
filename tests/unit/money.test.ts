import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money';
const money = (amount: string, currency = 'BRL') => Money.from({ amount, currency });
describe('Money', () => {
  test.each(['', 'NaN', 'Infinity', '1e2', '-1', '1.001', ' 1', '+1', '.1', '01', '1.'])(
    'rejects invalid input %j',
    (value) => {
      expect(() => money(value)).toThrow('INVALID_AMOUNT');
    },
  );
  test('normalizes scale without rounding', () => {
    expect(money('1.2').toString()).toBe('1.20');
    expect(money('1').toString()).toBe('1.00');
  });
  test('exact arithmetic beyond safe integer range', () => {
    expect(money('9007199254740993.10').add(money('0.20')).toString()).toBe('9007199254740993.30');
  });
  test('immutable arithmetic and signed internal differences', () => {
    const a = money('0.10');
    expect(a.add(money('0.20')).toString()).toBe('0.30');
    expect(a.toString()).toBe('0.10');
    expect(a.subtract(money('0.20')).toString()).toBe('-0.10');
    expect(a.negate().isNegative()).toBe(true);
  });
  test('currency conflicts', () => {
    expect(() => money('1').add(money('1', 'USD'))).toThrow('CURRENCY_MISMATCH');
    expect(() => money('1').isLessThan(money('1', 'USD'))).toThrow();
  });
  test('JSON uses fixed decimal string', () => {
    expect(JSON.stringify(money('1'))).toBe('{"amount":"1.00","currency":"BRL"}');
  });
  test('invalid currency', () => {
    expect(() => money('1', 'brl')).toThrow('INVALID_CURRENCY');
  });
});
