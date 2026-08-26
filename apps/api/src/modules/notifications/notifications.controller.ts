import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  listNotificationsQuery,
  readAllSchema,
  updatePreferencesSchema,
  type ListNotificationsQuery,
  type ReadAllDto,
  type UpdatePreferencesDto,
} from '@bobs-momo/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthedUser } from '../../common/types/request';
import { NotificationsService } from './notifications.service';

// Everything here is scoped to the calling user. There is no permission that
// grants reading another user's inbox, not even for OWNER.
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @Permissions('notification.own.read')
  list(
    @Query(new ZodValidationPipe(listNotificationsQuery)) query: ListNotificationsQuery,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.service.list(user.sub, query);
  }

  @Get('unread-count')
  @Permissions('notification.own.read')
  unreadCount(@CurrentUser() user: AuthedUser) {
    return this.service.unreadCount(user.sub);
  }

  @Get('preferences')
  @Permissions('notification.preference.update')
  getPreferences(@CurrentUser() user: AuthedUser) {
    return this.service.getPreferences(user.sub);
  }

  @Put('preferences')
  @Permissions('notification.preference.update')
  updatePreferences(
    @Body(new ZodValidationPipe(updatePreferencesSchema)) dto: UpdatePreferencesDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.service.updatePreferences(user.sub, dto);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @Permissions('notification.own.read')
  readAll(
    @Body(new ZodValidationPipe(readAllSchema)) dto: ReadAllDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.service.readAll(user.sub, dto);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @Permissions('notification.own.read')
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthedUser) {
    return this.service.markRead(user.sub, id);
  }
}
