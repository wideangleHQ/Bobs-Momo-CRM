import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, PasswordService, TokenService],
  // TokenService is exported because JwtAuthGuard verifies with it.
  exports: [TokenService],
})
export class AuthModule {}
