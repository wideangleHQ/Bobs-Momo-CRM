import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { AdminController } from './admin.controller';
import { AdminAuditService } from './audit.service';
import { AdminOutletsService } from './outlets.service';
import { AdminReferenceService } from './reference.service';
import { AdminUsersService } from './users.service';

@Module({
  controllers: [AdminController],
  // PasswordService is stateless and AuthModule does not export it. Listing it
  // here hashes new logins with the same argon2 settings as the login path,
  // which is the only thing that matters.
  providers: [
    AdminUsersService,
    AdminOutletsService,
    AdminReferenceService,
    AdminAuditService,
    PasswordService,
  ],
})
export class AdminModule {}
