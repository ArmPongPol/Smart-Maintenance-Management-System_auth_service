import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard, UNAUTHORIZED_MESSAGE } from './jwt-auth.guard';

describe('JwtAuthGuard.handleRequest', () => {
  const guard = new JwtAuthGuard(new Reflector());

  const rejection = (fn: () => unknown): UnauthorizedException => {
    try {
      fn();
    } catch (error) {
      return error as UnauthorizedException;
    }
    throw new Error('expected handleRequest to throw');
  };

  it('returns the user when authentication succeeded', () => {
    const user = { id: 'u1' };

    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('gives a generic 401 for a rejected token and keeps the reason as cause', () => {
    const error = rejection(() =>
      guard.handleRequest(null, false, new Error('jwt expired')),
    );

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.message).toBe(UNAUTHORIZED_MESSAGE);
    expect(error.cause).toBe('jwt expired');
  });

  it('gives the same generic 401 when the strategy rejects the account', () => {
    const error = rejection(() =>
      guard.handleRequest(
        new UnauthorizedException('Account not found or inactive'),
        false,
      ),
    );

    expect(error.message).toBe(UNAUTHORIZED_MESSAGE);
    expect(error.cause).toBe('Account not found or inactive');
  });

  it('lets non-auth errors through unchanged', () => {
    const outage = new ServiceUnavailableException('db down');

    expect(rejection(() => guard.handleRequest(outage, false))).toBe(outage);
  });
});
