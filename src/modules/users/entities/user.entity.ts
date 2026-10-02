import { Entity, Column } from 'typeorm';
import { UserRoleEnum, UserStatusEnum } from '../../../common/constants/enum';
import { BaseEntity } from '@/common/entities/base.entity';

// "user" is a reserved word in Postgres, so the table is named "users".
@Entity({ name: 'users' })
export class User extends BaseEntity {
  @Column({
    name: 'email',
    type: 'varchar',
    unique: true,
  })
  email: string;

  // Excluded from queries by default so it never ends up in a response.
  // Select it explicitly where needed (e.g. login): addSelect('user.password').
  @Column({
    name: 'password',
    type: 'varchar',
    select: false,
  })
  password: string;

  @Column({
    name: 'first_name',
    type: 'varchar',
  })
  firstName: string;

  @Column({
    name: 'last_name',
    type: 'varchar',
  })
  lastName: string;

  @Column({
    name: 'role',
    type: 'enum',
    enum: UserRoleEnum,
    default: UserRoleEnum.OPERATOR,
  })
  role: UserRoleEnum;

  @Column({
    name: 'status',
    type: 'enum',
    enum: UserStatusEnum,
    default: UserStatusEnum.ACTIVE,
  })
  status: UserStatusEnum;
}
