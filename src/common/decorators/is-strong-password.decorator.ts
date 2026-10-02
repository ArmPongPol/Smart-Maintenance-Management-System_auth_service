import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 12;
/** bcrypt-style 72-byte truncation does not apply to argon2, but cap input to
 *  bound hashing cost — an unbounded password is a cheap DoS vector. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Composed password policy: length floor plus character-class variety.
 * Applied to registration, admin user creation and password change alike.
 */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH, {
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
    }),
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: `Password must not exceed ${PASSWORD_MAX_LENGTH} characters`,
    }),
    Matches(/[a-z]/, { message: 'Password must contain a lowercase letter' }),
    Matches(/[A-Z]/, { message: 'Password must contain an uppercase letter' }),
    Matches(/[0-9]/, { message: 'Password must contain a number' }),
    Matches(/[^A-Za-z0-9]/, {
      message: 'Password must contain a special character',
    }),
  );
}
