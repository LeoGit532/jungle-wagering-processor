import { MikroORM } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { WalletSchema } from "./entities";
import { Migration202610210001 } from "./migrations/Migration202610210001";
import { Migration202610220001 } from "./migrations/Migration202610220001";
export function openDatabase(
  url = process.env.DATABASE_URL ??
    "postgresql://challenge:challenge@localhost:5432/wagering",
) {
  return MikroORM.init({
    clientUrl: url,
    entities: [WalletSchema],
    extensions: [Migrator],
    migrations: {
      migrationsList: [Migration202610210001, Migration202610220001],
      transactional: true,
      allOrNothing: true,
      snapshot: false,
    },
    pool: { min: 0, max: 12 },
  });
}
