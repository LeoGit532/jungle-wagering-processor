import { AsyncLocalStorage } from "node:async_hooks";
export interface Context {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
}
export const context = new AsyncLocalStorage<Context>();
const values = new Map<string, number>();
export function metric(name: string, increment = 1): void {
  values.set(name, (values.get(name) ?? 0) + increment);
}
export function gauge(name: string, value: number): void {
  values.set(name, value);
}
export function metrics(): string {
  return [...values].map(([key, value]) => key + " " + value).join("\n") + "\n";
}
export function log(
  event: string,
  details: Context & {
    code?: string;
    status?: string;
  } = {},
): void {
  if (process.env.SILENT_LOGS === "1") {
    return;
  }
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...context.getStore(),
      ...details,
    }),
  );
}
