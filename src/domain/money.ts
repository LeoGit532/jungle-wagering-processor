import { DomainError } from './errors';
export { DomainError } from './errors';
export interface MoneyProps {
  amount: string;
  currency: string;
}
// NUMERIC(30,2) reserva 28 dígitos inteiros e 2 decimais no PostgreSQL.
export const MAX_MONEY_AMOUNT = '9999999999999999999999999999.99';
const MAX_MONEY_CENTS = 10n ** 30n - 1n;
/**
 * Valor monetário imutável: 25.30 BRL fica armazenado como 2530n centavos.
 * bigint evita a imprecisão de ponto flutuante; a moeda acompanha o valor.
 * Operações devolvem outro Money e nunca alteram a instância original.
 */
export class Money {
  private constructor(
    private readonly cents: bigint,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }
  // Entrada do domínio: aceita decimais não negativos, sem arredondar.
  // A camada HTTP é mais restritiva: exige BRL e exatamente duas casas.
  static from(props: MoneyProps): Money {
    if (typeof props.amount !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(props.amount)) {
      throw new DomainError('INVALID_AMOUNT');
    }
    if (typeof props.currency !== 'string' || !/^[A-Z]{3}$/.test(props.currency)) {
      throw new DomainError('INVALID_CURRENCY');
    }
    // Converte partes da string diretamente: '25.3' -> 25n * 100n + 30n.
    const [whole, fraction = ''] = props.amount.split('.');
    const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (cents > MAX_MONEY_CENTS) {
      throw new DomainError('AMOUNT_OUT_OF_RANGE');
    }
    return new Money(cents, props.currency);
  }
  static maximum(currency: string): Money {
    return Money.from({ amount: MAX_MONEY_AMOUNT, currency });
  }
  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }
  // Resultados intermediários podem ultrapassar a capacidade do banco ou ser
  // negativos. Wallet valida os limites antes de aceitar um novo saldo; isso
  // permite também representar diferenças negativas na reconciliação.
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }
  subtract(other: Money): Money {
    return this.add(other.negate());
  }
  negate(): Money {
    return new Money(-this.cents, this.currency);
  }
  isZero(): boolean {
    return this.cents === 0n;
  }
  isPositive(): boolean {
    return this.cents > 0n;
  }
  isNegative(): boolean {
    return this.cents < 0n;
  }
  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }
  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents === other.cents;
  }
  // Retorna decimal com duas casas sem converter o valor financeiro em number.
  toString(): string {
    const absoluteCents = this.cents < 0n ? -this.cents : this.cents;
    return (
      (this.cents < 0n ? '-' : '') +
      (absoluteCents / 100n).toString() +
      '.' +
      (absoluteCents % 100n).toString().padStart(2, '0')
    );
  }
  // bigint não é serializável em JSON; o contrato externo usa amount como string.
  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }
  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError('CURRENCY_MISMATCH');
    }
  }
}
