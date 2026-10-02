import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionsModule } from '../sessions/sessions.module';
import { User } from './entities/user.entity';
import { PasswordService } from './password.service';
import { UserCacheService } from './user-cache.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User]), SessionsModule],
  controllers: [UsersController],
  providers: [UsersService, PasswordService, UserCacheService],
  exports: [UsersService, PasswordService, UserCacheService],
})
export class UsersModule {}
