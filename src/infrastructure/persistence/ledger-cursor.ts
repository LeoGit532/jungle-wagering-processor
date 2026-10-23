import { ApplicationError, requireObject, requireUuid } from '../../application/contracts';
export interface LedgerAnchor {
  id: string;
  at: string;
}
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
export function decodeLedgerCursor(walletId: string, cursor?: string): LedgerAnchor | undefined {
  if (!cursor) {
    return;
  }
  try {
    if (cursor.length > 1000) {
      throw new Error('Cursor too long');
    }
    const payload = requireObject(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (
      payload.walletId !== walletId ||
      typeof payload.at !== 'string' ||
      !CURSOR_TIMESTAMP.test(payload.at) ||
      !Number.isFinite(Date.parse(payload.at))
    ) {
      throw new Error('Invalid cursor payload');
    }
    return { id: requireUuid(payload.id), at: payload.at };
  } catch {
    throw new ApplicationError('INVALID_CURSOR', 400);
  }
}
export function encodeLedgerCursor(walletId: string, anchor: LedgerAnchor): string {
  return Buffer.from(JSON.stringify({ walletId, id: anchor.id, at: anchor.at })).toString(
    'base64url',
  );
}
export function ledgerPageLimit(value?: string): number {
  const limit = value === undefined ? 50 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApplicationError('INVALID_LIMIT', 400);
  }
  return limit;
}
