import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UserRoleEnum } from '@/common/constants/enum';
import { RequiredRoles } from '@/common/decorators/roles.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { DirectoryQueryDto } from './dto/directory-query.dto';

@ApiBearerAuth()
@RequiredRoles(UserRoleEnum.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll(@Query() query: FindUsersQueryDto) {
    return this.usersService.findAll(query);
  }

  // Names for other services' user ids (maintenance reporters, technicians,
  // comment authors). Open to every role, so it returns no email addresses.
  // Declared before ':id' so "directory" isn't parsed as a uuid.
  @Get('directory')
  // Matches the server-side cache (DIRECTORY_CACHE_TTL_MS, default 30 s).
  @Header('Cache-Control', 'private, max-age=30')
  @RequiredRoles(
    UserRoleEnum.ADMIN,
    UserRoleEnum.LEADER,
    UserRoleEnum.TECHNICIAN,
    UserRoleEnum.OPERATOR,
  )
  directory(@Query() query: DirectoryQueryDto) {
    return this.usersService.directory(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOneOrFail(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}
