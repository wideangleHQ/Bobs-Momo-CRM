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
  Put,
  Query,
} from '@nestjs/common';
import {
  createVendorSchema,
  listVendorsQuery,
  setVendorItemsSchema,
  updateVendorSchema,
  type CreateVendorDto,
  type ListVendorsQuery,
  type SetVendorItemsDto,
  type UpdateVendorDto,
} from '@bobs-momo/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { VendorsService } from './vendors.service';

// Vendors have no outlet column. Both shops buy from the same suppliers, and a
// price series split per outlet would halve the data the trend chart needs.
@Controller('vendors')
export class VendorsController {
  constructor(private readonly service: VendorsService) {}

  @Get()
  @Permissions('vendor.vendor.read')
  list(@Query(new ZodValidationPipe(listVendorsQuery)) query: ListVendorsQuery) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('vendor.vendor.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @Permissions('vendor.vendor.create')
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(createVendorSchema)) dto: CreateVendorDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Permissions('vendor.vendor.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateVendorSchema)) dto: UpdateVendorDto,
  ) {
    return this.service.update(id, dto);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Permissions('vendor.vendor.deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deactivate(id);
  }

  @Put(':id/items')
  @Permissions('vendor.vendor.update')
  setItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setVendorItemsSchema)) dto: SetVendorItemsDto,
  ) {
    return this.service.setItems(id, dto);
  }
}
