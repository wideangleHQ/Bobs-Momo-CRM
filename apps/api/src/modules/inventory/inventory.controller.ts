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
  createCategorySchema,
  createItemSchema,
  createUnitSchema,
  listItemsQuery,
  listStockQuery,
  listTransactionsQuery,
  recordTransactionSchema,
  setReorderLevelSchema,
  updateItemSchema,
  type CreateCategoryDto,
  type CreateItemDto,
  type CreateUnitDto,
  type ListItemsQuery,
  type ListStockQuery,
  type ListTransactionsQuery,
  type RecordTransactionDto,
  type SetReorderLevelDto,
  type UpdateItemDto,
} from '@bobs-momo/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, Scope } from '../../common/decorators/current-user.decorator';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { grantsFor } from '../../common/permissions';
import type { AuthedRequest, AuthedUser, RequestScope } from '../../common/types/request';
import { actorOf } from '../admin/audit-writer';
import { AdminReferenceService } from '../admin/reference.service';
import { InventoryService, type RecordedTransaction } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly idempotency: IdempotencyService,
    private readonly reference: AdminReferenceService,
  ) {}

  @Get('categories')
  @Permissions('inventory.item.read')
  listCategories() {
    return this.service.listCategories();
  }

  @Post('categories')
  @Permissions('inventory.category.manage')
  @HttpCode(HttpStatus.CREATED)
  createCategory(
    @Body(new ZodValidationPipe(createCategorySchema)) dto: CreateCategoryDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reference.createCategory(dto, actorOf(req));
  }

  @Get('units')
  @Permissions('inventory.item.read')
  listUnits() {
    return this.service.listUnits();
  }

  @Post('units')
  @Permissions('inventory.unit.manage')
  @HttpCode(HttpStatus.CREATED)
  createUnit(
    @Body(new ZodValidationPipe(createUnitSchema)) dto: CreateUnitDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reference.createUnit(dto, actorOf(req));
  }

  @Get('items')
  @Permissions('inventory.item.read')
  listItems(@Query(new ZodValidationPipe(listItemsQuery)) query: ListItemsQuery) {
    return this.service.listItems(query);
  }

  @Get('items/:id')
  @Permissions('inventory.item.read')
  getItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getItem(id);
  }

  @Post('items')
  @Permissions('inventory.item.create')
  @HttpCode(HttpStatus.CREATED)
  createItem(@Body(new ZodValidationPipe(createItemSchema)) dto: CreateItemDto) {
    return this.service.createItem(dto);
  }

  @Patch('items/:id')
  @Permissions('inventory.item.update')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateItemSchema)) dto: UpdateItemDto,
  ) {
    return this.service.updateItem(id, dto);
  }

  @Post('items/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Permissions('inventory.item.deactivate')
  deactivateItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deactivateItem(id);
  }

  @Get('stock')
  @Permissions('inventory.stock.read')
  listStock(
    @Query(new ZodValidationPipe(listStockQuery)) query: ListStockQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.listStock(query, scope);
  }

  @Patch('stock/:itemId/reorder-level')
  @Permissions('inventory.reorder_level.update')
  setReorderLevel(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodValidationPipe(setReorderLevelSchema)) dto: SetReorderLevelDto,
    @Scope() scope: RequestScope,
  ) {
    return this.service.setReorderLevel(itemId, dto, scope);
  }

  @Get('transactions')
  @Permissions('inventory.transaction.read')
  listTransactions(
    @Query(new ZodValidationPipe(listTransactionsQuery)) query: ListTransactionsQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.listTransactions(query, scope);
  }

  @Post('transactions')
  @Permissions('inventory.transaction.create')
  @HttpCode(HttpStatus.CREATED)
  async record(
    @Body(new ZodValidationPipe(recordTransactionSchema)) dto: RecordTransactionDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
    @Req() req: AuthedRequest,
  ): Promise<RecordedTransaction> {
    // Recording that stock was used or wasted is one thing. Declaring that the
    // ledger itself was wrong is another, and it has its own key.
    if (dto.type === 'ADJUSTMENT' && !('inventory.adjustment.create' in grantsFor(user.roleKey))) {
      throw DomainError.forbidden('You cannot record an adjustment');
    }
    // A phone on a bad connection retries. Without this, the retry issues the
    // stock twice and the balance is quietly wrong.
    const key = req.headers['idempotency-key'];
    const { hit, commit } = await this.idempotency.replay<RecordedTransaction>(
      typeof key === 'string' ? key : undefined,
      user.sub,
      'inventory.transactions',
      dto,
    );
    if (hit) return hit;

    const result = await this.service.record(dto, user, scope);
    await commit(result);
    return result;
  }
}
