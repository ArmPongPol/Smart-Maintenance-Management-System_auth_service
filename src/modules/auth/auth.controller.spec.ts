import { Test, TestingModule } from '@nestjs/testing';
import { UserRoleEnum } from '@/common/constants/enum';
import { User } from '@/modules/users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const authService = { logout: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('answers /me with the user JwtStrategy loaded, without a lookup', () => {
    const user = {
      id: 'u1',
      email: 'user@example.com',
      role: UserRoleEnum.OPERATOR,
    } as User;

    expect(controller.me(user)).toBe(user);
  });

  it('responds to logout with null data', async () => {
    authService.logout.mockResolvedValue(undefined);

    await expect(controller.logout({ refreshToken: 'x.y.z' })).resolves.toBe(
      null,
    );
    expect(authService.logout).toHaveBeenCalledWith({ refreshToken: 'x.y.z' });
  });
});
