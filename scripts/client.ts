import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FinancialResponse } from '../src/application/ports/wagering';
export const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3100';
export interface Wallet {
  id: string;
  playerId: string;
  balance: { amount: string; currency: string };
  version: number;
}
export interface Reconciliation {
  consistent: boolean;
  storedBalance: { amount: string; currency: string };
  calculatedBalance: { amount: string; currency: string };
  checkedEntries: number;
}
export async function request(path: string, body?: unknown, key?: string): Promise<Response> {
  return fetch(apiBase + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
}
export async function createWallet(amount = '100.00'): Promise<Wallet> {
  const response = await request('/wallets', {
    playerId: crypto.randomUUID(),
    initialBalance: { amount, currency: 'BRL' },
  });
  if (response.status !== 201) throw new Error('Wallet creation failed: HTTP ' + response.status);
  return response.json() as Promise<Wallet>;
}
export function operation(wallet: Wallet, kind = 'BET', amount = '0.01') {
  return {
    providerId: 'experiment',
    externalTransactionId: crypto.randomUUID(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: 'experiment-round',
    gameId: 'experiment-game',
    kind,
    money: { amount, currency: 'BRL' },
  };
}
export async function submit(
  body: unknown,
  key: string,
): Promise<{ status: number; result: FinancialResponse }> {
  const response = await request('/wagering/transactions', body, key);
  return { status: response.status, result: (await response.json()) as FinancialResponse };
}
export async function reconcile(wallet: Wallet): Promise<Reconciliation> {
  const response = await request('/wallets/' + wallet.id + '/reconciliation', {});
  if (response.status !== 200) throw new Error('Reconciliation unavailable');
  return response.json() as Promise<Reconciliation>;
}
export async function readMetrics(): Promise<Map<string, number>> {
  const text = await (await request('/metrics')).text();
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const separator = line.lastIndexOf(' ');
    if (separator > 0) values.set(line.slice(0, separator), Number(line.slice(separator + 1)));
  }
  return values;
}
export async function report(name: string, data: unknown, markdown: string): Promise<void> {
  const directory = resolve(process.env.REPORT_DIR ?? 'docs/reports');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, name + '.json'), JSON.stringify(data, null, 2) + '\n');
  await writeFile(resolve(directory, name + '.md'), markdown + '\n');
}
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
