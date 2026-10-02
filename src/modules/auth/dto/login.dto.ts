import { PASSWORD_MAX_LENGTH } from '@/common/decorators/is-strong-password.decorator';
import { normalizeEmail } from '@/common/transformers/string.transformers';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'test@gmail.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email: string;

  // No strength rules here: they belong to setting a password, and a policy
  // change must not lock out accounts created under the old one.
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
