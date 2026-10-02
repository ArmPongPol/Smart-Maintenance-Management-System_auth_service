import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRoleEnum, UserStatusEnum } from '@/common/constants/enum';
import { JwtAccessPayload } from '@/common/interfaces/jwt-payload.interface';
import { User } from '@/modules/users/entities/user.entity';
import { UserCacheService } from '@/modules/users/user-cache.service';
import { UsersService } from '@/modules/users/users.service';
import { JwtStrategy } from './jwt.strategy';

const payload: JwtAccessPayload = {
  sub: 'u1',
  email: 'user@example.com',
  role: UserRoleEnum.OPERATOR,
  type: 'access',
  iat: 0,
  exp: 900,
  iss: 'test-issuer',
  aud: 'test-audience',
};

const activeUser = (overrides: Partial<User> = {}) =>
  ({
    id: 'u1',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: UserRoleEnum.ADMIN,
    status: UserStatusEnum.ACTIVE,
    ...overrides,
  }) as User;

describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;
  let userCache: UserCacheService;

  const usersService = { findOne: jest.fn<Promise<User | null>, [string]>() };

  beforeEach(() => {
    jest.clearAllMocks();
    const config = new ConfigService({
      jwt: {
        accessSecret: 'a'.repeat(32),
        issuer: 'test-issuer',
        audience: 'test-audience',
      },
      cache: { userTtlMs: 5000 },
    });
    userCache = new UserCacheService(config);
    strategy = new JwtStrategy(
      config,
      usersService as unknown as UsersService,
      userCache,
    );
  });

  it('returns the role from the database, not from the token', async () => {
    usersService.findOne.mockResolvedValue(activeUser());

    await expect(strategy.validate(payload)).resolves.toMatchObject({
      id: 'u1',
      email: 'user@example.com',
      role: UserRoleEnum.ADMIN,
    });
  });

  it('returns the full user (what /auth/me responds with)', async () => {
    const user = activeUser();
    usersService.findOne.mockResolvedValue(user);

    await expect(strategy.validate(payload)).resolves.toBe(user);
  });

  it('serves repeat requests from the cache without another query', async () => {
    usersService.findOne.mockResolvedValue(activeUser());

    const first = await strategy.validate(payload);
    const second = await strategy.validate(payload);

    expect(second).toBe(first);
    expect(usersService.findOne).toHaveBeenCalledTimes(1);
  });

  it('reloads after the cache entry is invalidated', async () => {
    usersService.findOne.mockResolvedValueOnce(activeUser());
    await strategy.validate(payload);

    userCache.invalidate('u1');
    usersService.findOne.mockResolvedValueOnce(
      activeUser({ status: UserStatusEnum.INACTIVE }),
    );

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersService.findOne).toHaveBeenCalledTimes(2);
  });

  it('rejects a refresh token', async () => {
    await expect(
      strategy.validate({
        ...payload,
        type: 'refresh',
      } as unknown as JwtAccessPayload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token without exp', async () => {
    await expect(
      strategy.validate({
        ...payload,
        exp: undefined,
      } as unknown as JwtAccessPayload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a deleted account', async () => {
    usersService.findOne.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an inactive account', async () => {
    usersService.findOne.mockResolvedValue({
      id: 'u1',
      status: UserStatusEnum.INACTIVE,
    } as User);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('gives missing and inactive accounts the same message', async () => {
    usersService.findOne.mockResolvedValueOnce(null);
    const missing = await strategy.validate(payload).catch((e: Error) => e);
    usersService.findOne.mockResolvedValueOnce(
      activeUser({ status: UserStatusEnum.INACTIVE }),
    );
    const inactive = await strategy.validate(payload).catch((e: Error) => e);

    expect(missing).toBeInstanceOf(UnauthorizedException);
    expect((missing as Error).message).toBe((inactive as Error).message);
  });
});
