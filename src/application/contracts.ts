import { createHash } from "node:crypto";
import { DomainError, Money } from "../domain/money";
import type { WagerKind } from "../domain/wager-transaction";
export class ApplicationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}
export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("INVALID_PAYLOAD", 400);
  }
  return value as Record<string, unknown>;
}
export function requireIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    value !== value.trim()
  ) {
    throw new ApplicationError("INVALID_IDENTIFIER", 400);
  }
  return value;
}
export function requireUuid(value: unknown): string {
  const id = requireIdentifier(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new ApplicationError("INVALID_UUID", 400);
  }
  return id.toLowerCase();
}
function assertAllowedFields(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApplicationError("UNKNOWN_FIELD", 400);
  }
}
export function parseMoney(value: unknown): Money {
  const props = requireObject(value);
  assertAllowedFields(props, ["amount", "currency"]);
  if (
    typeof props.amount !== "string" ||
    !/^(0|[1-9]\d{0,27})\.\d{2}$/.test(props.amount)
  ) {
    throw new DomainError("INVALID_AMOUNT");
  }
  if (props.currency !== "BRL") {
    throw new DomainError("UNSUPPORTED_CURRENCY");
  }
  return Money.from({ amount: props.amount, currency: props.currency });
}
export function parseWallet(value: unknown) {
  const data = requireObject(value);
  assertAllowedFields(data, ["playerId", "initialBalance"]);
  return {
    playerId: requireUuid(data.playerId),
    initialBalance: parseMoney(data.initialBalance),
  };
}
export function parseWager(value: unknown) {
  const data = requireObject(value);
  assertAllowedFields(data, [
    "providerId",
    "externalTransactionId",
    "playerId",
    "walletId",
    "roundId",
    "gameId",
    "kind",
    "money",
    "referenceExternalTransactionId",
  ]);
  const providerId = requireIdentifier(data.providerId);
  if (providerId.startsWith("__")) {
    throw new ApplicationError("INVALID_PROVIDER", 400);
  }
  const kind = requireIdentifier(data.kind) as WagerKind;
  if (!["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"].includes(kind)) {
    throw new DomainError("INVALID_KIND");
  }
  return {
    providerId,
    externalTransactionId: requireIdentifier(data.externalTransactionId),
    playerId: requireUuid(data.playerId),
    walletId: requireUuid(data.walletId),
    roundId: requireIdentifier(data.roundId),
    gameId: requireIdentifier(data.gameId),
    kind,
    money: parseMoney(data.money),
    ...(data.referenceExternalTransactionId !== undefined
      ? {
          referenceExternalTransactionId: requireIdentifier(
            data.referenceExternalTransactionId,
          ),
        }
      : {}),
  };
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([leftKey], [rightKey]) =>
          leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0,
        )
        .map(
          ([entryKey, entryValue]) =>
            JSON.stringify(entryKey) + ":" + canonicalJson(entryValue),
        )
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}
export function hashPayload(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
