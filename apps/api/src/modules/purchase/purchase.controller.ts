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
  Req,
} from '@nestjs/common';
import {
  createPurchaseSchema,
  createRequestSchema,
  decideRequestSchema,
  listPurchasesQuery,
  listRequestsQuery,
  priceHistoryQuery,
  voidPurchaseSchema,
  type CreatePurchaseDto,
  type CreateRequestDto,
  type DecideRequestDto,
  type ListPurchasesQuery,
  type ListRequestsQuery,
  type PriceHistoryQuery,
  type VoidPurchaseDto,
} from '@bobs-momo/shared';
import { CurrentUser, Scope } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthedRequest, AuthedUser, RequestScope } from '../../common/types/request';
import { PurchaseRequestService } from './purchase-request.service';
import { PurchaseService } from './purchase.service';

@Controller()
export class PurchaseController {
  constructor(
    private readonly requests: PurchaseRequestService,
    private readonly purchases: PurchaseService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ---- requests ----------------------------------------------------------

  @Get('purchase-requests')
  @Permissions('purchase.request.read')
  listRequests(
    @Query(new ZodValidationPipe(listRequestsQuery)) query: ListRequestsQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.requests.list(query, scope);
  }

  @Get('purchase-requests/:id')
  @Permissions('purchase.request.read')
  getRequest(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.requests.get(id, scope);
  }

  @Post('purchase-requests')
  @Permissions('purchase.request.create')
  @HttpCode(HttpStatus.CREATED)
  createRequest(
    @Body(new ZodValidationPipe(createRequestSchema)) dto: CreateRequestDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.requests.create(dto, user, scope);
  }

  // Approve and reject share a key: they are the same decision authority, and a
  // separate reject key would let somebody refuse what they cannot grant.
  @Post('purchase-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchase.request.approve')
  approveRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideRequestSchema)) dto: DecideRequestDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.requests.decide(id, 'APPROVED', dto, user, scope);
  }

  @Post('purchase-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchase.request.approve')
  rejectRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideRequestSchema)) dto: DecideRequestDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.requests.decide(id, 'REJECTED', dto, user, scope);
  }

  @Post('purchase-requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchase.request.cancel')
  cancelRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideRequestSchema)) dto: DecideRequestDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.requests.decide(id, 'CANCELLED', dto, user, scope);
  }

  // ---- purchases ---------------------------------------------------------

  @Get('purchases')
  @Permissions('purchase.record.read')
  listPurchases(
    @Query(new ZodValidationPipe(listPurchasesQuery)) query: ListPurchasesQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.purchases.list(query, scope);
  }

  @Get('purchases/price-history')
  @Permissions('purchase.price_history.read')
  priceHistory(@Query(new ZodValidationPipe(priceHistoryQuery)) query: PriceHistoryQuery) {
    return this.purchases.priceHistory(query);
  }

  @Get('purchases/:id')
  @Permissions('purchase.record.read')
  getPurchase(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.purchases.get(id, scope);
  }

  @Post('purchases')
  @Permissions('purchase.record.create')
  @HttpCode(HttpStatus.CREATED)
  async createPurchase(
    @Body(new ZodValidationPipe(createPurchaseSchema)) dto: CreatePurchaseDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
    @Req() req: AuthedRequest,
  ) {
    // A retried submit must not receive the stock twice or issue a second
    // purchase number against the same paper bill.
    const key = req.headers['idempotency-key'];
    const { hit, commit } = await this.idempotency.replay<
      Awaited<ReturnType<PurchaseService['create']>>
    >(typeof key === 'string' ? key : undefined, user.sub, 'purchases', dto);
    if (hit) return hit;

    const result = await this.purchases.create(dto, user, scope);
    await commit(result);
    return result;
  }

  @Post('purchases/:id/void')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchase.record.void')
  voidPurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(voidPurchaseSchema)) dto: VoidPurchaseDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.purchases.void(id, dto, user, scope);
  }
}
