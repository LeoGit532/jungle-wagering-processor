import { EntitySchema } from '@mikro-orm/core';
export class WalletRow {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
export const WalletSchema = new EntitySchema<WalletRow>({
  class: WalletRow,
  tableName: 'wallets',
  properties: {
    id: { type: 'uuid', primary: true },
    playerId: { type: 'uuid' },
    currency: { type: 'string', length: 3 },
    balance: { type: 'string', columnType: 'numeric(30,2)' },
    version: { type: 'integer' },
    createdAt: { type: 'Date' },
    updatedAt: { type: 'Date' },
  },
});
