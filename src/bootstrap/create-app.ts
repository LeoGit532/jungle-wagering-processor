import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { MikroORM } from "@mikro-orm/postgresql";
import { instrumentedWagering } from "../infrastructure/instrumented-wagering";
import { context, log } from "../infrastructure/telemetry";
import { WagerStore } from "../infrastructure/persistence/wager-store";
import { FinancialQueries } from "../infrastructure/persistence/queries";
import {
  ApiErrorFilter,
  FinancialController,
  HealthController,
  WAGERING,
  QUERIES,
  READY,
} from "../interfaces/http/api";
export async function createApplication(
  orm: MikroORM,
  checkBroker: () => Promise<void>,
  logger: boolean = true,
) {
  @Module({
    controllers: [FinancialController, HealthController],
    providers: [
      {
        provide: WAGERING,
        useValue: instrumentedWagering(new WagerStore(orm)),
      },
      { provide: QUERIES, useValue: new FinancialQueries(orm) },
      {
        provide: READY,
        useValue: async () => {
          await Promise.all([orm.em.fork().execute("select 1"), checkBroker()]);
        },
      },
    ],
  })
  class RuntimeModule {}
  const app = await NestFactory.create(RuntimeModule, {
    logger: logger
      ? {
          log: () => log("framework_log"),
          warn: () => log("framework_warning"),
          error: () => log("framework_error"),
        }
      : false,
  });
  app.use(
    (
      req: {
        headers: Record<string, string | string[] | undefined>;
      },
      res: {
        setHeader(name: string, value: string): void;
      },
      next: () => void,
    ) => {
      const raw = req.headers["x-correlation-id"];
      const correlationId =
        typeof raw === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(raw)
          ? raw
          : crypto.randomUUID();
      res.setHeader("x-correlation-id", correlationId);
      context.run({ correlationId }, next);
    },
  );
  app.useGlobalFilters(new ApiErrorFilter());
  return app;
}
