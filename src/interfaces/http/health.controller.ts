import { Controller, Get, Inject } from '@nestjs/common';
import { ApplicationError } from '../../application/contracts';
import { READY } from './tokens';
@Controller('health')
export class HealthController {
  constructor(
    @Inject(READY)
    private readonly checkReady: () => Promise<void>,
  ) {}
  @Get('live')
  live() {
    return { status: 'ok' };
  }
  @Get('ready')
  async ready() {
    try {
      await this.checkReady();
      return { status: 'ok' };
    } catch {
      throw new ApplicationError('DEPENDENCIES_UNAVAILABLE', 503);
    }
  }
}
