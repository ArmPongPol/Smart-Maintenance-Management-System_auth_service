import { TransformFnParams } from 'class-transformer';

// For use with class-transformer's @Transform. Non-string values pass through
// untouched so the validators (@IsString, @IsEmail) still report them.

export const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Emails are stored lowercased so the unique constraint is effectively
// case-insensitive; every write and lookup must go through this.
export const normalizeEmail = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
