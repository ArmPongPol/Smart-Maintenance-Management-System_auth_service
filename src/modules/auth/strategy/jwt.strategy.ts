import { UserStatusEnum } from '@/common/constants/enum';
import { JwtAccessPayload } from '@/common/interfaces/jwt-payload.interface';
import { User } from '@/modules/users/entities/user.entity';
import { UserCacheService } from '@/modules/users/user-cache.service';
import { UsersService } from '@/modules/users/users.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    private readonly userCache: UserCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
      // getOrThrow: an undefined issuer/audience would silently skip the check.
      issuer: config.getOrThrow<string>('jwt.issuer'),
      audience: config.getOrThrow<string>('jwt.audience'),
      algorithms: ['HS256'],
    });
  }

  // Called only after passport-jwt has verified signature, expiry, issuer and
  // audience. The user is re-read (through a cache of a few seconds that
  // UsersService invalidates on change) so a role change or deactivation
  // takes effect right away instead of when the token expires.
  //
  // The returned User (no password hash) becomes request.user; it is a
  // superset of AuthenticatedUser ({ id, email, role }).
  async validate(payload: JwtAccessPayload): Promise<User> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Expected an access token');
    }

    if (typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Token has no expiry');
    }

    const user = await this.userCache.getOrLoad(payload.sub, () =>
      this.usersService.findOne(payload.sub),
    );
    // One message for both cases: don't reveal whether the account exists.
    if (!user || user.status !== UserStatusEnum.ACTIVE) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    return user;
  }
}
