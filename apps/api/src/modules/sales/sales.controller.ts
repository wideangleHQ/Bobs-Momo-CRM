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
  Req,
} from '@nestjs/common';
import {
  createSalesEntrySchema,
  listSalesEntriesQuery,
  updateSalesEntrySchema,
  type CreateSalesEntryDto,
  type ListSalesEntriesQuery,
  type UpdateSalesEntryDto,
} from '@bobs-momo/shared';
import { CurrentUser, Scope } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthedRequest, AuthedUser, RequestScope } from '../../common/types/request';
import { SalesService } from './sales.service';

@Controller('sales-entries')
export class SalesController {
  constructor(
    private readonly service: SalesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Permissions('sales.entry.read')
  list(
    @Query(new ZodValidationPipe(listSalesEntriesQuery)) query: ListSalesEntriesQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.list(query, scope);
  }

  @Get(':id')
  @Permissions('sales.entry.read')
  get(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.service.get(id, scope);
  }

  @Post()
  @Permissions('sales.entry.create')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createSalesEntrySchema)) dto: CreateSalesEntryDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
    @Req() req: AuthedRequest,
  ) {
    // The unique key on (outletId, businessDate) already stops a second person
    // entering the same day. This stops a double tap on a weak connection
    // reading back as a 409 to the person who submitted once.
    const key = req.headers['idempotency-key'];
    const { hit, commit } = await this.idempotency.replay<Awaited<ReturnType<SalesService['create']>>>(
      typeof key === 'string' ? key : undefined,
      user.sub,
      'sales-entries',
      dto,
    );
    if (hit) return hit;

    const result = await this.service.create(dto, user, scope);
    await commit(result);
    return result;
  }

  // sales.entry.unlock is not listed here. Amending is the permission; holding
  // unlock is what the service checks once the 48 hour window has passed.
  @Patch(':id')
  @Permissions('sales.entry.amend')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSalesEntrySchema)) dto: UpdateSalesEntryDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.service.update(id, dto, user, scope);
  }
}
