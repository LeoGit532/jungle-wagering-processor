import { Migration } from '@mikro-orm/migrations';
export class Migration202610220002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON wallet_ledger FOR EACH STATEMENT EXECUTE FUNCTION immutable_ledger();
CREATE FUNCTION check_wallet_version() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 THEN RAISE EXCEPTION 'wallet version starts at one' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.balance=OLD.balance AND NEW.version<>OLD.version) OR
     (NEW.balance<>OLD.balance AND NEW.version<>OLD.version+1) THEN
   RAISE EXCEPTION 'wallet version must track balance changes' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $guard$;
CREATE TRIGGER wallet_version BEFORE INSERT OR UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION check_wallet_version();
`);
  }
  override async down(): Promise<void> {
    this.addSql(
      'DROP TRIGGER wallet_version ON wallets; DROP FUNCTION check_wallet_version(); DROP TRIGGER ledger_no_truncate ON wallet_ledger;',
    );
  }
}
