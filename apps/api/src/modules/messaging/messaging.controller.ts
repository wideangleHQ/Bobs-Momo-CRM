import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  listMessagesQuery,
  sendBroadcastSchema,
  sendDirectMessageSchema,
  type ListMessagesQuery,
  type SendBroadcastDto,
  type SendDirectMessageDto,
} from '@bobs-momo/shared';
import { CurrentUser, Scope } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { MessagingService } from './messaging.service';

@Controller('messages')
export class MessagingController {
  constructor(private readonly service: MessagingService) {}

  @Get()
  @Permissions('messaging.message.read')
  list(
    @Query(new ZodValidationPipe(listMessagesQuery)) query: ListMessagesQuery,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.list(query, user, scope);
  }

  @Get('unread-count')
  @Permissions('messaging.message.read')
  unreadCount(@CurrentUser() user: AuthedUser, @Scope() scope: RequestScope) {
    return this.service.unreadCount(user, scope);
  }

  @Post()
  @Permissions('messaging.direct.send')
  @HttpCode(HttpStatus.CREATED)
  send(
    @Body(new ZodValidationPipe(sendDirectMessageSchema)) dto: SendDirectMessageDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.service.sendDirect(dto, user);
  }

  // Separate from POST /messages because listing both keys on one handler would
  // mean either key is enough, and a cashier who can send a direct message must
  // not be able to broadcast.
  @Post('broadcast')
  @Permissions('messaging.broadcast.send')
  @HttpCode(HttpStatus.CREATED)
  broadcast(
    @Body(new ZodValidationPipe(sendBroadcastSchema)) dto: SendBroadcastDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.broadcast(dto, user, scope);
  }

  @Post(':id/read')
  @Permissions('messaging.message.read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ): Promise<void> {
    return this.service.markRead(id, user, scope);
  }
}
