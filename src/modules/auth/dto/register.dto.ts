import { OmitType } from '@nestjs/swagger';
import { CreateUserDto } from '@/modules/users/dto/create-user.dto';

// Self-registration cannot pick its own role or status: with the global
// ValidationPipe's forbidNonWhitelisted, sending either one is a 400.
export class RegisterDto extends OmitType(CreateUserDto, [
  'role',
  'status',
] as const) {}
