import * as argon2 from 'argon2';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ARGON2_OPTIONS } from '../../common/constants/argon2';
import { UserRoleEnum } from '../../common/constants/enum';
import { CreateUserDto } from '../../modules/users/dto/create-user.dto';
import { User } from '../../modules/users/entities/user.entity';
import dataSource from '../data-source';

// Creates the first administrator (npm run seed:admin). Self-registration only
// creates OPERATOR accounts, so without this nobody could reach POST /users.
// Safe to re-run: does nothing if the email already exists.
async function main(): Promise<void> {
  // Goes through CreateUserDto so the seed obeys the same email normalization
  // and password policy as the API.
  const dto = plainToInstance(CreateUserDto, {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    firstName: process.env.ADMIN_FIRST_NAME ?? 'System',
    lastName: process.env.ADMIN_LAST_NAME ?? 'Administrator',
    role: UserRoleEnum.ADMIN,
  });

  const errors = await validate(dto);
  if (errors.length) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new Error(
      `Set ADMIN_EMAIL and ADMIN_PASSWORD in .env:\n- ${messages.join('\n- ')}`,
    );
  }

  await dataSource.initialize();
  try {
    const users = dataSource.getRepository(User);

    if (await users.exists({ where: { email: dto.email } })) {
      console.log(`Admin ${dto.email} already exists, nothing to do.`);
      return;
    }

    await users.insert({
      ...dto,
      password: await argon2.hash(dto.password, ARGON2_OPTIONS),
    });
    console.log(`Created admin ${dto.email}.`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
