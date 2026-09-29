import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '@/common/decorators/public.decorator';

const DB_PING_TIMEOUT_MS = 1500;

// Probes must work without a token. A failing check throws 503, which
// AllExceptionsFilter turns into the standard error body; Terminus logs the
// failing indicator's details, so they are not exposed to the caller.
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  // Liveness: the process is up and serving requests. Deliberately checks no
  // dependencies, so a database outage does not get the app restarted.
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  // Readiness: the app can serve traffic, i.e. the database answers.
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: DB_PING_TIMEOUT_MS }),
    ]);
  }
}
