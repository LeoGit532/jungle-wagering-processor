import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { ApplicationError } from "../../application/contracts";
import { DomainError } from "../../domain/errors";
import { context, metric, log } from "../../infrastructure/telemetry";
import type { HttpResponse } from "./tokens";

interface HttpError {
  status: number;
  code: string;
}
const TRANSIENT_ERRORS = new Set([
  "08000",
  "08003",
  "08006",
  "40001",
  "40P01",
  "55P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "57P01",
]);
const LOCK_ERRORS = new Set(["40001", "40P01", "55P03"]);

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const { status, code } = classifyError(error);
    const databaseCode = underlyingErrorCode(error);
    if (databaseCode && LOCK_ERRORS.has(databaseCode))
      metric("wager_lock_conflicts_total");
    if (status >= 500) log("request_failed", { code });
    host.switchToHttp().getResponse<HttpResponse>().status(status).json({
      error: { code },
      correlationId: context.getStore()?.correlationId,
    });
  }
}

function classifyError(error: unknown): HttpError {
  if (error instanceof ApplicationError)
    return { status: error.status, code: error.code };
  if (error instanceof DomainError)
    return { status: domainErrorStatus(error.code), code: error.code };

  const databaseCode = underlyingErrorCode(error);
  let response: HttpError = { status: 500, code: "INTERNAL_ERROR" };
  if (databaseCode === "23505")
    response = { status: 409, code: "RESOURCE_CONFLICT" };
  else if (databaseCode && TRANSIENT_ERRORS.has(databaseCode))
    response = { status: 503, code: "INFRASTRUCTURE_UNAVAILABLE" };

  const httpError = error as { getStatus?: () => number };
  if (typeof httpError?.getStatus === "function") {
    const status = httpError.getStatus();
    response = { status, code: status === 400 ? "INVALID_JSON" : "HTTP_ERROR" };
  }
  return response;
}

function domainErrorStatus(code: string): number {
  if (code.includes("CONFLICT")) return 409;
  if (code === "WALLET_NOT_FOUND") return 404;
  if (code === "INVALID_TRANSACTION_STATE") return 500;
  return 400;
}

function underlyingErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  const exception = error as { code?: string; cause?: unknown };
  return exception.code ?? underlyingErrorCode(exception.cause);
}
