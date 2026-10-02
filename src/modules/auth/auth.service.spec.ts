import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { ARGON2_OPTIONS } from '@/common/constants/argon2';
import { UserRoleEnum, UserStatusEnum } from '@/common/constants/enum';
import {
  JwtAccessPayload,
  JwtRefreshPayload,
} from '@/common/interfaces/jwt-payload.interface';
import { RefreshSession } from '@/modules/sessions/entities/refresh-session.entity';
import { SessionsService } from '@/modules/sessions/sessions.service';
import { User } from '@/modules/users/entities/user.entity';
import { PasswordService } from '@/modules/users/password.service';
import { UsersService } from '@/modules/users/users.service';
import { AuthService } from './auth.service';
import {
  LoginAttemptsService,
  TOO_MANY_ATTEMPTS,
} from './login-attempts.service';
import { RegisterDto } from './dto/register.dto';

const jwtConfig = {
  accessSecret: 'a'.repeat(32),
  refreshSecret: 'r'.repeat(32),
  accessTtl: '15m',
  refreshTtl: '7d',
  issuer: 'test-issuer',
  audience: 'test-audience',
  refreshSessionMaxDays: 30,
  refreshReuseGraceSeconds: 30,
  loginMaxFailures: 3,
  loginFailureWindowSeconds: 900,
};
const PASSWORD = 'Str0ng!Passw0rd';
const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

// In-memory stand-in for SessionsService with the same semantics as the
// real one, in particular the conditional (compare-and-set) rotate.
class FakeSessions {
  readonly rows = new Map<string, RefreshSession>();

  create = jest.fn((userId: string, now: Date = new Date()) => {
    const session = {
      id: randomUUID(),
      userId,
      generation: 0,
      rotatedAt: now,
      expiresAt: new Date(now.getTime() + 30 * DAY_MS),
      revokedAt: null,
      createdAt: now,
    } as RefreshSession;
    this.rows.set(session.id, { ...session });
    return Promise.resolve({ ...session });
  });

  findById = jest.fn((id: string) => {
    const row = this.rows.get(id);
    return Promise.resolve(row ? { ...row } : null);
  });

  rotate = jest.fn((session: RefreshSession, now: Date = new Date()) => {
    const row = this.rows.get(session.id);
    if (!row || row.generation !== session.generation || row.revokedAt) {
      return Promise.resolve(null);
    }
    row.generation += 1;
    row.rotatedAt = now;
    return Promise.resolve({ ...row });
  });

  revoke = jest.fn((id: string) => {
    const row = this.rows.get(id);
    if (row && !row.revokedAt) row.revokedAt = new Date();
    return Promise.resolve();
  });

  only(): RefreshSession {
    const [row] = [...this.rows.values()];
    return row;
  }
}

describe('AuthService', () => {
  let service: AuthService;
  let sessions: FakeSessions;
  let passwordHash: string;
  let currentParamsHash: string;

  const jwtService = new JwtService({
    secret: jwtConfig.accessSecret,
    signOptions: {
      algorithm: 'HS256',
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
      expiresIn: '15m',
    },
  });
  const refreshSigner = new JwtService({
    secret: jwtConfig.refreshSecret,
    signOptions: {
      algorithm: 'HS256',
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
    },
  });
  const verifyOptions = (secret: string) => ({
    secret,
    issuer: jwtConfig.issuer,
    audience: jwtConfig.audience,
  });
  const decodeRefresh = (token: string) =>
    jwtService.verifyAsync<JwtRefreshPayload>(
      token,
      verifyOptions(jwtConfig.refreshSecret),
    );

  const usersService = {
    create: jest.fn(),
    findByEmailWithPassword: jest.fn<Promise<User | null>, [string]>(),
    findOne: jest.fn<Promise<User | null>, [string]>(),
    replacePasswordHash: jest.fn<Promise<boolean>, [string, string, string]>(),
  };

  const makeUser = (overrides: Partial<User> = {}) =>
    ({
      id: 'u1',
      email: 'user@example.com',
      role: UserRoleEnum.OPERATOR,
      status: UserStatusEnum.ACTIVE,
      password: passwordHash,
      ...overrides,
    }) as User;

  beforeAll(async () => {
    // Reuse detection and failed rehashes log warnings; keep test output clean.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    // argon2's library defaults (m=64 MiB, t=3, p=4): what older accounts have.
    passwordHash = await argon2.hash(PASSWORD);
    currentParamsHash = await argon2.hash(PASSWORD, ARGON2_OPTIONS);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessions = new FakeSessions();
    usersService.findOne.mockResolvedValue(makeUser());
    usersService.replacePasswordHash.mockResolvedValue(true);
    const config = new ConfigService({
      jwt: jwtConfig,
      hashing: { concurrency: 2, queueMax: 10 },
    });
    service = new AuthService(
      usersService as unknown as UsersService,
      sessions as unknown as SessionsService,
      new PasswordService(config),
      jwtService,
      new LoginAttemptsService(config),
      config,
    );
  });

  const login = async (user = makeUser()) => {
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    return service.login({ email: 'user@example.com', password: PASSWORD });
  };

  describe('register', () => {
    it('always creates an OPERATOR, whatever the body says', async () => {
      const dto = {
        email: 'user@example.com',
        password: PASSWORD,
        firstName: 'Test',
        lastName: 'User',
        role: UserRoleEnum.ADMIN,
      } as RegisterDto;

      await service.register(dto);

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRoleEnum.OPERATOR }),
      );
    });
  });

  describe('login lockout per account', () => {
    const attempt = (password: string, email = 'user@example.com') =>
      service.login({ email, password });

    beforeEach(() => {
      usersService.findByEmailWithPassword.mockResolvedValue(makeUser());
    });
    afterEach(() => jest.useRealTimers());

    it('locks the account after too many wrong passwords, before hashing', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(attempt('wrong')).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }
      const verify = jest.spyOn(PasswordService.prototype, 'verify');
      // Even the right password is refused while locked, without argon2 work.
      await expect(attempt(PASSWORD)).rejects.toMatchObject({
        status: 429,
        message: TOO_MANY_ATTEMPTS,
      });
      expect(verify).not.toHaveBeenCalled();
      verify.mockRestore();
    });

    it('only locks that account (case-insensitive), not other users', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          attempt('wrong', 'User@Example.com'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
      await expect(attempt(PASSWORD)).rejects.toMatchObject({ status: 429 });
      await expect(
        attempt(PASSWORD, 'other@example.com'),
      ).resolves.toHaveProperty('accessToken');
    });

    it('unlocks after the window and resets on success', async () => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      for (let i = 0; i < 2; i++) {
        await expect(attempt('wrong')).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }
      await expect(attempt(PASSWORD)).resolves.toHaveProperty('accessToken');
      // The success cleared the count: two more misses still don't lock.
      for (let i = 0; i < 2; i++) {
        await expect(attempt('wrong')).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }
      await expect(attempt('wrong')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(attempt(PASSWORD)).rejects.toMatchObject({ status: 429 });

      jest.advanceTimersByTime(900_000 + 1);
      await expect(attempt(PASSWORD)).resolves.toHaveProperty('accessToken');
    });
  });

  describe('login', () => {
    it('issues an access token carrying the user id and role', async () => {
      const { accessToken } = await login(
        makeUser({ role: UserRoleEnum.LEADER }),
      );

      const payload = await jwtService.verifyAsync<JwtAccessPayload>(
        accessToken,
        verifyOptions(jwtConfig.accessSecret),
      );
      expect(payload).toMatchObject({
        sub: 'u1',
        role: UserRoleEnum.LEADER,
        type: 'access',
      });
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('keeps the response shape', async () => {
      const tokens = await login();

      expect(Object.keys(tokens).sort()).toEqual([
        'accessToken',
        'refreshToken',
        'tokenType',
      ]);
      expect(tokens.tokenType).toBe('Bearer');
    });

    it('creates a session and puts its id and generation in the refresh token', async () => {
      const { refreshToken } = await login();

      expect(sessions.create).toHaveBeenCalledWith('u1');
      const session = sessions.only();
      const payload = await decodeRefresh(refreshToken);
      expect(payload).toMatchObject({
        sub: 'u1',
        sid: session.id,
        gen: 0,
        type: 'refresh',
        iat: Math.floor(session.rotatedAt.getTime() / 1000),
      });
      expect(payload.exp - payload.iat).toBe(SEVEN_DAYS_S);
    });

    it('rejects a wrong password', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(makeUser());

      await expect(
        service.login({ email: 'user@example.com', password: 'wrong' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('gives an unknown email the same error as a wrong password', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: PASSWORD }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });

    it('rejects an inactive account', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(
        makeUser({ status: UserStatusEnum.INACTIVE }),
      );

      await expect(
        service.login({ email: 'user@example.com', password: PASSWORD }),
      ).rejects.toThrow(new UnauthorizedException('Account is inactive'));
    });

    it('rehashes a password stored with old argon2 parameters', async () => {
      await login();

      expect(usersService.replacePasswordHash).toHaveBeenCalledTimes(1);
      const [id, oldHash, newHash] =
        usersService.replacePasswordHash.mock.calls[0];
      expect(id).toBe('u1');
      expect(oldHash).toBe(passwordHash);
      expect(newHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
      await expect(argon2.verify(newHash, PASSWORD)).resolves.toBe(true);
    });

    it('does not rehash a password with current parameters', async () => {
      await login(makeUser({ password: currentParamsHash }));

      expect(usersService.replacePasswordHash).not.toHaveBeenCalled();
    });

    it('still logs in when the rehash fails', async () => {
      usersService.replacePasswordHash.mockRejectedValue(new Error('db down'));

      await expect(login()).resolves.toHaveProperty('accessToken');
    });
  });

  describe('refresh', () => {
    it('rotates on the current generation and issues a new pair', async () => {
      const { refreshToken } = await login();

      const tokens = await service.refresh({ refreshToken });

      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).not.toBe(refreshToken);
      const payload = await decodeRefresh(tokens.refreshToken);
      expect(payload).toMatchObject({ type: 'refresh', gen: 1 });
      expect(sessions.only().generation).toBe(1);
    });

    it('returns the identical current refresh token for the previous generation within the grace window', async () => {
      const { refreshToken: first } = await login();
      const rotated = await service.refresh({ refreshToken: first });

      const retried = await service.refresh({ refreshToken: first });

      expect(retried.refreshToken).toBe(rotated.refreshToken);
      expect(retried.accessToken).toEqual(expect.any(String));
      expect(sessions.only().generation).toBe(1);
      expect(sessions.only().revokedAt).toBeNull();
    });

    it('gives two concurrent refreshes with the same token the same refresh token', async () => {
      const { refreshToken } = await login();

      const [a, b] = await Promise.all([
        service.refresh({ refreshToken }),
        service.refresh({ refreshToken }),
      ]);

      expect(a.refreshToken).toBe(b.refreshToken);
      expect(sessions.only().generation).toBe(1);
      expect(sessions.only().revokedAt).toBeNull();
    });

    it('reloads and uses the grace path when its conditional rotate loses', async () => {
      const { refreshToken } = await login();
      // Another request rotates between our read and our UPDATE.
      sessions.rotate.mockImplementationOnce((session: RefreshSession) => {
        const row = sessions.rows.get(session.id)!;
        row.generation += 1;
        row.rotatedAt = new Date();
        return Promise.resolve(null);
      });

      const loser = await service.refresh({ refreshToken });

      expect(sessions.findById).toHaveBeenCalledTimes(2);
      const payload = await decodeRefresh(loser.refreshToken);
      expect(payload.gen).toBe(1);
      expect(sessions.only().revokedAt).toBeNull();
      // Same token any other caller with the gen-0 token now gets.
      const again = await service.refresh({ refreshToken });
      expect(again.refreshToken).toBe(loser.refreshToken);
    });

    it('revokes the session when the previous generation is replayed after the grace window', async () => {
      const { refreshToken: first } = await login();
      const { refreshToken: second } = await service.refresh({
        refreshToken: first,
      });
      sessions.only().rotatedAt = new Date(Date.now() - 31_000);

      await expect(service.refresh({ refreshToken: first })).rejects.toThrow(
        new UnauthorizedException('Invalid or expired refresh token'),
      );
      expect(sessions.revoke).toHaveBeenCalledWith(sessions.only().id);
      // The legitimate holder is logged out too.
      await expect(
        service.refresh({ refreshToken: second }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('revokes the session when an older generation is replayed', async () => {
      const { refreshToken: gen0 } = await login();
      const { refreshToken: gen1 } = await service.refresh({
        refreshToken: gen0,
      });
      const { refreshToken: gen2 } = await service.refresh({
        refreshToken: gen1,
      });

      await expect(
        service.refresh({ refreshToken: gen0 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(sessions.only().revokedAt).toBeInstanceOf(Date);
      await expect(
        service.refresh({ refreshToken: gen2 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a revoked session', async () => {
      const { refreshToken } = await login();
      sessions.only().revokedAt = new Date();

      await expect(service.refresh({ refreshToken })).rejects.toThrow(
        new UnauthorizedException('Invalid or expired refresh token'),
      );
      expect(sessions.rotate).not.toHaveBeenCalled();
    });

    it('rejects an expired session', async () => {
      const { refreshToken } = await login();
      sessions.only().expiresAt = new Date(Date.now() - 1000);

      await expect(service.refresh({ refreshToken })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(sessions.rotate).not.toHaveBeenCalled();
    });

    it('rejects a token whose session no longer exists', async () => {
      const { refreshToken } = await login();
      sessions.rows.clear();

      await expect(service.refresh({ refreshToken })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('caps the token expiry at the absolute session end', async () => {
      const { refreshToken } = await login();
      const session = sessions.only();
      session.expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      const tokens = await service.refresh({ refreshToken });

      const payload = await decodeRefresh(tokens.refreshToken);
      expect(payload.exp).toBe(Math.floor(session.expiresAt.getTime() / 1000));
    });

    it('rejects an old stateless refresh token (no session id)', async () => {
      const legacy = await refreshSigner.signAsync(
        { sub: 'u1', type: 'refresh' },
        { expiresIn: '7d' },
      );

      await expect(service.refresh({ refreshToken: legacy })).rejects.toThrow(
        new UnauthorizedException('Invalid or expired refresh token'),
      );
    });

    it('rejects an access token', async () => {
      const { accessToken } = await login();

      await expect(
        service.refresh({ refreshToken: accessToken }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token signed with the refresh secret but typed access', async () => {
      const forged = await jwtService.signAsync(
        { sub: 'u1', type: 'access' },
        { secret: jwtConfig.refreshSecret },
      );

      await expect(
        service.refresh({ refreshToken: forged }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when the account was deactivated after login', async () => {
      const { refreshToken } = await login();
      usersService.findOne.mockResolvedValue(
        makeUser({ status: UserStatusEnum.INACTIVE }),
      );

      await expect(service.refresh({ refreshToken })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revokes the session of the refresh token', async () => {
      const { refreshToken } = await login();

      await service.logout({ refreshToken });

      expect(sessions.revoke).toHaveBeenCalledWith(sessions.only().id);
      await expect(service.refresh({ refreshToken })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('is idempotent', async () => {
      const { refreshToken } = await login();

      await service.logout({ refreshToken });
      await expect(service.logout({ refreshToken })).resolves.toBeUndefined();
    });

    it('still revokes with an expired refresh token', async () => {
      await login();
      const session = sessions.only();
      const past = Math.floor(Date.now() / 1000) - 3600;
      const expired = await refreshSigner.signAsync({
        sub: 'u1',
        sid: session.id,
        gen: 0,
        type: 'refresh',
        iat: past - 60,
        exp: past,
      });

      await service.logout({ refreshToken: expired });

      expect(sessions.revoke).toHaveBeenCalledWith(session.id);
    });

    it('silently ignores tokens it did not issue', async () => {
      const { accessToken } = await login();
      const legacy = await refreshSigner.signAsync(
        { sub: 'u1', type: 'refresh' },
        { expiresIn: '7d' },
      );

      await expect(
        service.logout({ refreshToken: accessToken }),
      ).resolves.toBeUndefined();
      await expect(
        service.logout({ refreshToken: legacy }),
      ).resolves.toBeUndefined();
      expect(sessions.revoke).not.toHaveBeenCalled();
    });
  });
});
