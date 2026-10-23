import { DomainError, Money } from './money';
import { WalletLedgerEntry, type LedgerDirection } from './wallet-ledger-entry';
export { WalletLedgerEntry, type LedgerDirection, type LedgerState } from './wallet-ledger-entry';
export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
/**
 * Mantém saldo e versão e produz o lançamento correspondente a cada movimento.
 * Não acessa banco nem resolve concorrência: quem chama deve persistir saldo
 * e ledger na mesma transação SQL, segurando o lock desta carteira.
 */
export class Wallet {
  private constructor(private state: WalletState) {}
  // Uma carteira nova começa na versão 1. O lançamento OPENING, quando necessário,
  // é criado pela persistência junto com a abertura, não por este método.
  static open(props: { id: string; playerId: string; initialBalance: Money; at: string }): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new DomainError('NEGATIVE_BALANCE');
    }
    return Wallet.rehydrate({
      id: props.id,
      playerId: props.playerId,
      balance: props.initialBalance,
      version: 1,
      createdAt: props.at,
      updatedAt: props.at,
    });
  }
  // Reconstrói o estado já persistido sem repetir os efeitos de uma abertura.
  // A cópia congelada impede alterações externas pelo snapshot.
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(Object.freeze({ ...state }));
  }
  get snapshot(): Readonly<WalletState> {
    return this.state;
  }
  debit(money: Money, transactionId: string, entryId: string, at: string): WalletLedgerEntry {
    return this.move('DEBIT', money, transactionId, entryId, at);
  }
  credit(money: Money, transactionId: string, entryId: string, at: string): WalletLedgerEntry {
    return this.move('CREDIT', money, transactionId, entryId, at);
  }
  // Débito e crédito compartilham as mesmas validações e a criação do ledger.
  private move(
    direction: LedgerDirection,
    money: Money,
    transactionId: string,
    entryId: string,
    at: string,
  ): WalletLedgerEntry {
    if (!money.isPositive()) {
      throw new DomainError('INVALID_MOVEMENT_AMOUNT');
    }
    // Calcula primeiro; qualquer validação que falhe deixa o estado intacto.
    // Money também impede operações entre moedas diferentes.
    const before = this.state.balance;
    const after = direction === 'DEBIT' ? before.subtract(money) : before.add(money);
    if (after.isNegative()) {
      throw new DomainError('INSUFFICIENT_FUNDS');
    }
    if (Money.maximum(money.currency).isLessThan(after))
      throw new DomainError('BALANCE_LIMIT_EXCEEDED');
    // O lançamento registra valor, direção e saldo antes/depois para auditoria.
    const entry = WalletLedgerEntry.create({
      id: entryId,
      walletId: this.state.id,
      transactionId,
      direction,
      money,
      balanceBefore: before,
      balanceAfter: after,
      createdAt: at,
    });
    // Só troca o snapshot após validar e criar o lançamento. A versão avança
    // uma vez por movimento; não é ela que fornece o lock entre processos.
    this.state = Object.freeze({
      ...this.state,
      balance: after,
      version: this.state.version + 1,
      updatedAt: at,
    });
    return entry;
  }
}
