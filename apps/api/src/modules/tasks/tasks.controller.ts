import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  cancelTaskSchema,
  completeTaskSchema,
  createAttachmentSchema,
  createCommentSchema,
  createTaskSchema,
  listTasksQuery,
  complianceQuery,
  myTasksQuery,
  submitChecklistSchema,
  updateTaskSchema,
  verifyTaskSchema,
  type CancelTaskDto,
  type CompleteTaskDto,
  type CreateAttachmentDto,
  type CreateCommentDto,
  type CreateTaskDto,
  type ListTasksQuery,
  type ComplianceQuery,
  type MyTasksQuery,
  type SubmitChecklistDto,
  type UpdateTaskDto,
  type VerifyTaskDto,
} from '@bobs-momo/shared';
import { CurrentUser, Scope } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { TasksService } from './tasks.service';

// `my` and `board` are declared above `:id`. NestJS matches in declaration
// order, and a `:id` route declared first swallows both and tries to parse
// them as UUIDs.
@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get()
  @Permissions('task.task.read')
  list(
    @Query(new ZodValidationPipe(listTasksQuery)) query: ListTasksQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.list(query, scope);
  }

  @Get('my')
  @Permissions('task.task.read')
  my(
    @Query(new ZodValidationPipe(myTasksQuery)) query: MyTasksQuery,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.my(query, user, scope);
  }

  @Get('board')
  @Permissions('task.task.read')
  board(
    @Query(new ZodValidationPipe(listTasksQuery)) query: ListTasksQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.board(query, scope);
  }

  // Not task.task.read: floor staff hold that at SELF scope, and this is the
  // per-outlet completion rate their manager is judged on.
  @Get('compliance')
  @Permissions('analytics.performance.read')
  compliance(
    @Query(new ZodValidationPipe(complianceQuery)) query: ComplianceQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.compliance(query, scope);
  }

  @Get(':id')
  @Permissions('task.task.read')
  getOne(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.service.getOne(id, scope);
  }

  @Post()
  @Permissions('task.task.create')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createTaskSchema)) dto: CreateTaskDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.create(dto, user, scope);
  }

  @Patch(':id')
  @Permissions('task.task.update_self')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) dto: UpdateTaskDto,
    @Scope() scope: RequestScope,
  ) {
    return this.service.update(id, dto, scope);
  }

  @Post(':id/start')
  @Permissions('task.task.update_self')
  @HttpCode(HttpStatus.OK)
  start(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.service.start(id, scope);
  }

  @Post(':id/complete')
  @Permissions('task.task.complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(completeTaskSchema)) dto: CompleteTaskDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.complete(id, dto, user, scope);
  }

  @Post(':id/verify')
  @Permissions('task.task.verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(verifyTaskSchema)) dto: VerifyTaskDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.verify(id, dto, user, scope);
  }

  @Post(':id/cancel')
  @Permissions('task.task.cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelTaskSchema)) dto: CancelTaskDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.cancel(id, dto, user, scope);
  }

  @Post(':id/checklist')
  @Permissions('task.task.complete')
  @HttpCode(HttpStatus.OK)
  submitChecklist(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(submitChecklistSchema)) dto: SubmitChecklistDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.submitChecklist(id, dto, user, scope);
  }

  @Get(':id/comments')
  @Permissions('task.task.read')
  listComments(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.service.listComments(id, scope);
  }

  @Post(':id/comments')
  @Permissions('task.comment.create')
  @HttpCode(HttpStatus.CREATED)
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createCommentSchema)) dto: CreateCommentDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.addComment(id, dto, user, scope);
  }

  @Post(':id/attachments')
  @Permissions('task.task.update_self')
  @HttpCode(HttpStatus.CREATED)
  addAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createAttachmentSchema)) dto: CreateAttachmentDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.addAttachment(id, dto, user, scope);
  }
}
