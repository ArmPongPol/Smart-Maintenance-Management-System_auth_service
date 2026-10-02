import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRoleEnum } from '@/common/constants/enum';
import { RolesGuard } from '@/common/guards/roles.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  const usersService = {
    findOneOrFail: jest.fn(),
    findAll: jest.fn(),
    directory: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('passes the uuid through as a string', async () => {
    usersService.findOneOrFail.mockResolvedValue({ id: 'abc' });

    await controller.findOne('abc');

    expect(usersService.findOneOrFail).toHaveBeenCalledWith('abc');
  });
});

// Stands in for JwtAuthGuard: authenticates as the role in X-Test-Role, so
// the real RolesGuard and the controller's @RequiredRoles are what's tested.
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    req.user = {
      id: 'u1',
      email: 'user@example.com',
      role: req.header('x-test-role') as UserRoleEnum,
    };
    return true;
  }
}

describe('UsersController (HTTP, role checks)', () => {
  let app: INestApplication<App>;

  const usersService = {
    findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    directory: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets an OPERATOR read the directory, with a private cache header', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/directory')
      .set('x-test-role', UserRoleEnum.OPERATOR)
      .expect(200);

    expect(res.headers['cache-control']).toBe('private, max-age=30');
  });

  it('forbids an OPERATOR from listing users', async () => {
    await request(app.getHttpServer())
      .get('/users')
      .set('x-test-role', UserRoleEnum.OPERATOR)
      .expect(403);

    expect(usersService.findAll).not.toHaveBeenCalled();
  });

  it('lets an ADMINISTRATOR list users', async () => {
    await request(app.getHttpServer())
      .get('/users')
      .set('x-test-role', UserRoleEnum.ADMIN)
      .expect(200);
  });
});
