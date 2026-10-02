import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { isUUID } from 'class-validator';
import { randomBytes } from 'crypto';
import { ARGON2_OPTIONS } from '@/common/constants/argon2';
import { UserRoleEnum, UserStatusEnum } from '@/common/constants/enum';
import {
  JwtAccessPayload,
  JwtRefreshPayload,
} from '@/common/interfaces/jwt-payload.interface';
import { durationToSeconds } from '@/common/utils/duration';
import { RefreshSession } from '@/modules/sessions/entities/refresh-session.entity';
import { SessionsService } from '@/modules/sessions/sessions.service';
import { User } from '@/modules/users/entities/user.entity';
import { PasswordService } from '@/modules/users/password.service';
import { UsersService } from '@/modules/users/users.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthTokens } from './interfaces/auth-tokens.interface';
import { LoginAttemptsService } from './login-attempts.service';

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_REFRESH_TOKEN = 'Invalid or expired refresh token';

type RefreshClaims = Pick<
  JwtRefreshPayload,
  'sub' | 'sid' | 'gen' | 'type' | 'iat' | 'exp'
>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Verified against when the email is unknown, so a miss costs the same
  // argon2 work as a wrong password and response time doesn't reveal which
  // emails have accounts.
  private readonly dummyHash: Promise<string>;

  // Refresh tokens get their own signer: they use the refresh secret and set
  // iat/exp explicitly, which the module's default expiresIn would conflict with.
  private readonly refreshJwt: JwtService;
  private readonly refreshTtlSeconds: number;
  private readonly reuseGraceMs: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly passwords: PasswordService,
    private readonly jwtService: JwtService,
    private readonly loginAttempts: LoginAttemptsService,
    config: ConfigService,
  ) {
    const issuer = config.getOrThrow<string>('jwt.issuer');
    const audience = config.getOrThrow<string>('jwt.audience');
    this.refreshJwt = new JwtService({
      secret: config.getOrThrow<string>('jwt.refreshSecret'),
      signOptions: { algorithm: 'HS256', issuer, audience },
      verifyOptions: { algorithms: ['HS256'], issuer, audience },
    });
    this.refreshTtlSeconds = durationToSeconds(
      config.getOrThrow<string>('jwt.refreshTtl'),
    );
    this.reuseGraceMs =
      (config.get<number>('jwt.refreshReuseGraceSeconds') ?? 30) * 1000;

    this.dummyHash = argon2.hash(
      randomBytes(32).toString('hex'),
      ARGON2_OPTIONS,
    );
    // Avoid an unhandled rejection before the first login awaits it.
    this.dummyHash.catch(() => undefined);
  }

  // Self-registered accounts always start as OPERATOR; only an admin can
  // assign another role, through POST /users.
  register(dto: RegisterDto): Promise<User> {
    return this.usersService.create({ ...dto, role: UserRoleEnum.OPERATOR });
  }

  async login({ email, password }: LoginDto): Promise<AuthTokens> {
    // Before hashing, so a locked account costs no argon2 work.
    this.loginAttempts.assertAllowed(email);

    const user = await this.usersService.findByEmailWithPassword(email);
    const passwordMatches = await this.passwords.verify(
      user?.password ?? (await this.dummyHash),
      password,
    );

    if (!user || !passwordMatches) {
      this.loginAttempts.recordFailure(email);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    this.loginAttempts.recordSuccess(email);

    // Safe to be specific here: the caller has proven they know the password.
    if (user.status !== UserStatusEnum.ACTIVE) {
      throw new UnauthorizedException('Account is inactive');
    }

    await this.upgradeHashIfNeeded(user, password);

    const session = await this.sessionsService.create(user.id);
    return this.issueTokens(user, session);
  }

  /**
   * Rotating refresh with reuse detection:
   * - token at the session's current generation: rotate (generation + 1);
   * - token one generation behind, within the grace window: a concurrent
   *   refresh already rotated, so return that same current refresh token;
   * - anything else: the token was replayed, so the session is revoked.
   */
  async refresh({ refreshToken }: RefreshTokenDto): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(refreshToken, false);
    // Pre-session refresh tokens have no sid; their holders log in again.
    if (!payload) throw new UnauthorizedException(INVALID_REFRESH_TOKEN);

    const now = new Date();
    let session = await this.sessionsService.findById(payload.sid);
    if (!this.isUsable(session, payload, now)) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    const user = await this.usersService.findOne(session.userId);
    if (!user || user.status !== UserStatusEnum.ACTIVE) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    if (payload.gen === session.generation) {
      const rotated = await this.sessionsService.rotate(session, now);
      if (rotated) return this.issueTokens(user, rotated);

      // Lost the race to a concurrent refresh with the same token: reload
      // and fall through to the grace check.
      session = await this.sessionsService.findById(payload.sid);
      if (!this.isUsable(session, payload, now)) {
        throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
      }
    }

    if (
      payload.gen === session.generation - 1 &&
      now.getTime() - session.rotatedAt.getTime() <= this.reuseGraceMs
    ) {
      // Same (sid, gen, rotated_at) => byte-identical refresh token to the
      // one the winning request received.
      return this.issueTokens(user, session);
    }

    this.logger.warn(
      `Refresh token reuse detected: session ${session.id} of user ${session.userId} revoked (token gen ${payload.gen}, current ${session.generation})`,
    );
    await this.sessionsService.revoke(session.id);
    throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
  }

  // Idempotent and silent: an invalid, expired or already revoked token is
  // simply ignored, so the response says nothing about it.
  async logout({ refreshToken }: LogoutDto): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken, true);
    if (!payload) return;

    await this.sessionsService.revoke(payload.sid);
  }

  private isUsable(
    session: RefreshSession | null,
    payload: RefreshClaims,
    now: Date,
  ): session is RefreshSession {
    return (
      session !== null &&
      session.userId === payload.sub &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > now.getTime()
    );
  }

  private async verifyRefreshToken(
    token: string,
    ignoreExpiration: boolean,
  ): Promise<RefreshClaims | null> {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.refreshJwt.verifyAsync<JwtRefreshPayload>(token, {
        ignoreExpiration,
      });
    } catch {
      return null;
    }

    // An access token already fails verification (different secret); the type
    // check guards against the secrets ever being set to the same value.
    if (
      payload.type !== 'refresh' ||
      typeof payload.exp !== 'number' ||
      typeof payload.sid !== 'string' ||
      !isUUID(payload.sid) ||
      !Number.isInteger(payload.gen)
    ) {
      return null;
    }

    return payload;
  }

  private async upgradeHashIfNeeded(
    user: User,
    password: string,
  ): Promise<void> {
    if (!this.passwords.needsRehash(user.password)) return;

    // Best effort: a failure here (busy hasher, DB blip) must not fail login.
    try {
      const newHash = await this.passwords.hash(password);
      await this.usersService.replacePasswordHash(
        user.id,
        user.password,
        newHash,
      );
    } catch (error) {
      this.logger.warn(
        `Could not upgrade password hash for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async issueTokens(
    user: User,
    session: RefreshSession,
  ): Promise<AuthTokens> {
    const accessPayload: Pick<
      JwtAccessPayload,
      'sub' | 'email' | 'role' | 'type'
    > = { sub: user.id, email: user.email, role: user.role, type: 'access' };

    const [accessToken, refreshToken] = await Promise.all([
      // Access tokens use the module's signOptions (see AuthModule).
      this.jwtService.signAsync(accessPayload),
      this.signRefreshToken(session),
    ]);

    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }

  // Deterministic for a given (sid, gen, rotated_at, expires_at): HS256 is
  // deterministic and every claim comes from the session row.
  private signRefreshToken(session: RefreshSession): Promise<string> {
    const iat = Math.floor(session.rotatedAt.getTime() / 1000);
    const exp = Math.min(
      iat + this.refreshTtlSeconds,
      Math.floor(session.expiresAt.getTime() / 1000),
    );
    const claims: RefreshClaims = {
      sub: session.userId,
      sid: session.id,
      gen: session.generation,
      type: 'refresh',
      iat,
      exp,
    };

    return this.refreshJwt.signAsync(claims);
  }
}
