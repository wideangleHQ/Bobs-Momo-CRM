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
  createRecurrenceSchema,
  createTemplateSchema,
  listRecurrencesQuery,
  listTemplatesQuery,
  updateRecurrenceSchema,
  updateTemplateSchema,
  type CreateRecurrenceDto,
  type CreateTemplateDto,
  type ListRecurrencesQuery,
  type ListTemplatesQuery,
  type UpdateRecurrenceDto,
  type UpdateTemplateDto,
} from '@bobs-momo/shared';
import { Scope } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { RequestScope } from '../../common/types/request';
import { TemplatesService } from './templates.service';

@Controller('checklist-templates')
export class ChecklistTemplatesController {
  constructor(private readonly service: TemplatesService) {}

  // Reading a template is not managing one: a cook's app needs the item list
  // to render the checklist.
  @Get()
  @Permissions('task.task.read')
  list(@Query(new ZodValidationPipe(listTemplatesQuery)) query: ListTemplatesQuery) {
    return this.service.listTemplates(query);
  }

  @Get(':id')
  @Permissions('task.task.read')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTemplate(id);
  }

  @Post()
  @Permissions('task.template.manage')
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(createTemplateSchema)) dto: CreateTemplateDto) {
    return this.service.createTemplate(dto);
  }

  @Patch(':id')
  @Permissions('task.template.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) dto: UpdateTemplateDto,
  ) {
    return this.service.updateTemplate(id, dto);
  }
}

@Controller('task-recurrences')
export class TaskRecurrencesController {
  constructor(private readonly service: TemplatesService) {}

  @Get()
  @Permissions('task.recurrence.manage')
  list(
    @Query(new ZodValidationPipe(listRecurrencesQuery)) query: ListRecurrencesQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.listRecurrences(query, scope);
  }

  @Post()
  @Permissions('task.recurrence.manage')
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(createRecurrenceSchema)) dto: CreateRecurrenceDto) {
    return this.service.createRecurrence(dto);
  }

  @Patch(':id')
  @Permissions('task.recurrence.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRecurrenceSchema)) dto: UpdateRecurrenceDto,
  ) {
    return this.service.updateRecurrence(id, dto);
  }
}
