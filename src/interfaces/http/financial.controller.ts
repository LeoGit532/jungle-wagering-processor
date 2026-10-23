import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { Wagering } from '../../application/wagering';
import type { WagerStatus } from '../../domain/wager-transaction';
import { FinancialQueries } from '../../infrastructure/persistence/queries';
import { metrics } from '../../infrastructure/telemetry';
import { WAGERING, QUERIES, type HttpResponse } from './tokens';
@Controller()
export class FinancialController {
  constructor(
    @Inject(WAGERING)
    private readonly wagering: Wagering,
    @Inject(QUERIES)
    private readonly queries: FinancialQueries,
  ) {}
  @Get('metrics')
  metrics(
    @Res()
    res: {
      type(value: string): void;
      send(value: string): void;
    },
  ) {
    res.type('text/plain; version=0.0.4');
    res.send(metrics());
  }
  @Post('wallets')
  open(
    @Body()
    body: unknown,
  ) {
    return this.wagering.openWallet(body);
  }
  @Get('wallets/:id')
  wallet(
    @Param('id')
    id: string,
  ) {
    return this.queries.wallet(id);
  }
  @Get('wallets/:id/ledger')
  ledger(
    @Param('id')
    id: string,
    @Query('cursor')
    cursor?: string,
    @Query('limit')
    limit?: string,
  ) {
    return this.queries.ledger(id, cursor, limit);
  }
  @Post('wallets/:id/reconciliation')
  async reconcile(
    @Param('id')
    id: string,
    @Res()
    res: HttpResponse,
  ) {
    res.status(200).json(await this.queries.reconcile(id));
  }
  @Get('wagering/transactions/:id')
  transaction(
    @Param('id')
    id: string,
  ) {
    return this.queries.transaction(id);
  }
  @Get('providers/:provider/wagering/transactions/:external')
  external(
    @Param('provider')
    provider: string,
    @Param('external')
    external: string,
  ) {
    return this.queries.transaction(external, provider);
  }
  @Post('wagering/transactions')
  async submit(
    @Body()
    body: unknown,
    @Headers('idempotency-key')
    key: unknown,
    @Res()
    res: HttpResponse,
  ) {
    const result = await this.wagering.submit(body, key);
    res.status(financialStatus(result.status)).json(result);
  }
}

function financialStatus(status: WagerStatus): number {
  switch (status) {
    case 'FAILED':
      return 500;
    case 'REJECTED':
      return 422;
    case 'PENDING':
    case 'PENDING_REFERENCE':
      return 202;
    default:
      return 200;
  }
}
