import { Migration } from '@mikro-orm/migrations';
export class Migration202610210001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
CREATE TABLE wallets (
 id uuid PRIMARY KEY, player_id uuid NOT NULL, currency varchar(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 balance numeric(30,2) NOT NULL CHECK(balance >= 0), version integer NOT NULL CHECK(version >= 1),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(player_id,currency), UNIQUE(id,currency)
);
CREATE TABLE wager_transactions (
 id uuid PRIMARY KEY, provider_id text NOT NULL, external_transaction_id text NOT NULL,
 idempotency_key text NOT NULL UNIQUE, payload_hash text NOT NULL,
 wallet_id uuid NOT NULL REFERENCES wallets(id), kind text NOT NULL CHECK(kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
 status text NOT NULL CHECK(status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
 reference_transaction_id uuid REFERENCES wager_transactions(id),
 amount numeric(30,2) NOT NULL CHECK(amount >= 0), currency varchar(3) NOT NULL,
 state jsonb NOT NULL, response jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(wallet_id,currency) REFERENCES wallets(id,currency),
 UNIQUE(provider_id,external_transaction_id), UNIQUE(id,wallet_id),
 CHECK(kind NOT IN ('REFUND','ROLLBACK') OR status <> 'PROCESSED' OR reference_transaction_id IS NOT NULL)
);
CREATE UNIQUE INDEX one_reversal_per_kind ON wager_transactions(reference_transaction_id,kind)
 WHERE status='PROCESSED' AND kind IN ('REFUND','ROLLBACK');
CREATE INDEX pending_references ON wager_transactions(created_at,id) WHERE status='PENDING_REFERENCE';
CREATE TABLE wallet_ledger (
 id uuid PRIMARY KEY, wallet_id uuid NOT NULL REFERENCES wallets(id), transaction_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
 amount numeric(30,2) NOT NULL CHECK(amount > 0), currency varchar(3) NOT NULL,
 balance_before numeric(30,2) NOT NULL CHECK(balance_before >= 0),
 balance_after numeric(30,2) NOT NULL CHECK(balance_after >= 0), created_at timestamptz NOT NULL,
 FOREIGN KEY(transaction_id,wallet_id) REFERENCES wager_transactions(id,wallet_id),
 FOREIGN KEY(wallet_id,currency) REFERENCES wallets(id,currency),
 UNIQUE(transaction_id,wallet_id),
 CHECK(balance_after = balance_before + CASE WHEN direction='CREDIT' THEN amount ELSE -amount END)
);
CREATE INDEX ledger_cursor ON wallet_ledger(wallet_id,created_at,id);
CREATE TABLE inbox_messages (
 consumer_name text NOT NULL, message_id text NOT NULL, payload_hash text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 PRIMARY KEY(consumer_name,message_id)
);
CREATE TABLE outbox_messages (
 id uuid PRIMARY KEY, aggregate_id uuid NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 next_attempt_at timestamptz, published_at timestamptz
);
CREATE INDEX due_outbox ON outbox_messages(next_attempt_at,occurred_at,id) WHERE published_at IS NULL;
CREATE FUNCTION immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE FUNCTION check_wallet_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; stored numeric; reconstructed numeric;
BEGIN
 IF TG_TABLE_NAME='wallets' THEN target := NEW.id; ELSE target := NEW.wallet_id; END IF;
 SELECT balance INTO stored FROM wallets WHERE id=target FOR UPDATE;
 SELECT coalesce(sum(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) INTO reconstructed FROM wallet_ledger WHERE wallet_id=target;
 IF stored IS DISTINCT FROM reconstructed THEN RAISE EXCEPTION 'wallet ledger mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER wallet_ledger_consistency AFTER INSERT OR UPDATE ON wallets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_wallet_ledger();
CREATE CONSTRAINT TRIGGER ledger_wallet_consistency AFTER INSERT ON wallet_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_wallet_ledger();
CREATE FUNCTION check_transaction_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t wager_transactions; count_entries integer;
BEGIN
 IF TG_TABLE_NAME='wallet_ledger' THEN SELECT * INTO t FROM wager_transactions WHERE id=NEW.transaction_id;
 ELSE SELECT * INTO t FROM wager_transactions WHERE id=NEW.id; END IF;
 SELECT count(*) INTO count_entries FROM wallet_ledger WHERE transaction_id=t.id;
 IF (t.status='PROCESSED' AND t.kind <> 'LOSS' AND count_entries <> 1) OR
    ((t.status <> 'PROCESSED' OR t.kind='LOSS') AND count_entries <> 0) THEN
   RAISE EXCEPTION 'transaction ledger mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM wallet_ledger WHERE transaction_id=t.id AND (amount <> t.amount OR currency <> t.currency)) THEN
   RAISE EXCEPTION 'transaction ledger amount mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER transaction_ledger_consistency AFTER INSERT OR UPDATE ON wager_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transaction_ledger();
CREATE CONSTRAINT TRIGGER ledger_transaction_consistency AFTER INSERT ON wallet_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transaction_ledger();
CREATE FUNCTION protect_terminal_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('PROCESSED','REJECTED','FAILED') THEN
 RAISE EXCEPTION 'terminal transaction is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER transaction_terminal BEFORE UPDATE OR DELETE ON wager_transactions FOR EACH ROW EXECUTE FUNCTION protect_terminal_transaction();
`);
  }
  override async down(): Promise<void> {
    this.addSql(
      'DROP TABLE outbox_messages, inbox_messages, wallet_ledger, wager_transactions, wallets CASCADE; DROP FUNCTION immutable_ledger(), check_wallet_ledger(), check_transaction_ledger(), protect_terminal_transaction();',
    );
  }
}
