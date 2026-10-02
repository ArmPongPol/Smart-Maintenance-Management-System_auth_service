import { UserRoleEnum, UserStatusEnum } from '@/common/constants/enum';
import { IsStrongPassword } from '@/common/decorators/is-strong-password.decorator';
import {
  normalizeEmail,
  trim,
} from '@/common/transformers/string.transformers';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'test@gmail.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ minLength: 12 })
  @IsStrongPassword()
  password: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ enum: UserRoleEnum, default: UserRoleEnum.OPERATOR })
  @IsOptional()
  @IsEnum(UserRoleEnum)
  role?: UserRoleEnum;

  @ApiPropertyOptional({ enum: UserStatusEnum, default: UserStatusEnum.ACTIVE })
  @IsOptional()
  @IsEnum(UserStatusEnum)
  status?: UserStatusEnum;
}
