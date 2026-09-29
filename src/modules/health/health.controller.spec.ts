import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  const health = {
    check: jest.fn((indicators: (() => unknown)[]) => {
      indicators.forEach((indicator) => indicator());
      return Promise.resolve({ status: 'ok' });
    }),
  };
  const db = { pingCheck: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: TypeOrmHealthIndicator, useValue: db },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('does not touch the database for liveness', async () => {
    await controller.live();

    expect(health.check).toHaveBeenCalledWith([]);
    expect(db.pingCheck).not.toHaveBeenCalled();
  });

  it('pings the database with a timeout for readiness', async () => {
    await controller.ready();

    expect(db.pingCheck).toHaveBeenCalledWith('database', { timeout: 1500 });
  });
});
