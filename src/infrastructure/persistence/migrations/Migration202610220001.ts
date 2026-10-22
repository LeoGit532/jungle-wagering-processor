import { Migration } from '@mikro-orm/migrations';
export class Migration202610220001 extends Migration {
  override async up(): Promise<void> {
    this
      .addSql(`alter table wager_transactions drop constraint wager_transactions_wallet_id_currency_fkey;
create function check_processed_currency() returns trigger language plpgsql as $$ begin
 if NEW.status='PROCESSED' and not exists(select 1 from wallets where id=NEW.wallet_id and currency=NEW.currency) then raise exception 'processed currency mismatch' using errcode='23514'; end if; return null; end; $$;
create constraint trigger processed_currency after insert or update on wager_transactions deferrable initially deferred for each row execute function check_processed_currency();`);
    this.addSql(
      "alter table wager_transactions add column reference_attempts integer not null default 0 check(reference_attempts>=0), add column next_reference_at timestamptz not null default now(); create index due_references on wager_transactions(next_reference_at,id) where status='PENDING_REFERENCE';",
    );
  }
  override async down(): Promise<void> {
    this.addSql(
      'drop trigger processed_currency on wager_transactions; drop function check_processed_currency(); alter table wager_transactions add foreign key(wallet_id,currency) references wallets(id,currency);',
    );
    this.addSql(
      'drop index due_references; alter table wager_transactions drop column reference_attempts,drop column next_reference_at;',
    );
  }
}
