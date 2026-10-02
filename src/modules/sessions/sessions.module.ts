import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshSession } from './entities/refresh-session.entity';
import { SessionsService } from './sessions.service';

@Module({
  imports: [TypeOrmModule.forFeature([RefreshSession])],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
