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
  assignOutletsSchema,
  assignRoleSchema,
  createCategorySchema,
  createDepartmentSchema,
  createOutletSchema,
  createUnitSchema,
  createUserSchema,
  disableUserSchema,
  listAuditQuery,
  listDepartmentsQuery,
  listUsersQuery,
  updateCategorySchema,
  updateDepartmentSchema,
  updateOutletSchema,
  updateUnitSchema,
  updateUserSchema,
  type AssignOutletsDto,
  type AssignRoleDto,
  type CreateCategoryDto,
  type CreateDepartmentDto,
  type CreateOutletDto,
  type CreateUnitDto,
  type CreateUserDto,
  type DisableUserDto,
  type ListAuditQuery,
  type ListDepartmentsQuery,
  type ListUsersQuery,
  type UpdateCategoryDto,
  type UpdateDepartmentDto,
  type UpdateOutletDto,
  type UpdateUnitDto,
  type UpdateUserDto,
} from '@bobs-momo/shared';
import { Scope } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthedRequest, RequestScope } from '../../common/types/request';
import { actorOf } from './audit-writer';
import { AdminAuditService } from './audit.service';
import { AdminOutletsService } from './outlets.service';
import { AdminReferenceService } from './reference.service';
import { AdminUsersService } from './users.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly outlets: AdminOutletsService,
    private readonly reference: AdminReferenceService,
    private readonly audit: AdminAuditService,
  ) {}

  // ---- users -------------------------------------------------------------

  @Get('users')
  @Permissions('admin.user.read')
  listUsers(
    @Query(new ZodValidationPipe(listUsersQuery)) query: ListUsersQuery,
    @Req() req: AuthedRequest,
    @Scope() scope: RequestScope,
  ) {
    return this.users.list(query, actorOf(req), scope);
  }

  @Get('users/:id')
  @Permissions('admin.user.read')
  getUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Scope() scope: RequestScope,
  ) {
    return this.users.get(id, actorOf(req), scope);
  }

  @Post('users')
  @Permissions('admin.user.create')
  @HttpCode(HttpStatus.CREATED)
  createUser(
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto,
    @Req() req: AuthedRequest,
    @Scope() scope: RequestScope,
  ) {
    return this.users.create(dto, actorOf(req), scope);
  }

  @Patch('users/:id')
  @Permissions('admin.user.update')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
    @Req() req: AuthedRequest,
    @Scope() scope: RequestScope,
  ) {
    return this.users.update(id, dto, actorOf(req), scope);
  }

  @Post('users/:id/disable')
  @Permissions('admin.user.disable')
  @HttpCode(HttpStatus.OK)
  disableUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(disableUserSchema)) dto: DisableUserDto,
    @Req() req: AuthedRequest,
    @Scope() scope: RequestScope,
  ) {
    return this.users.disable(id, dto, actorOf(req), scope);
  }

  @Post('users/:id/assign-role')
  @Permissions('admin.user.assign_role')
  @HttpCode(HttpStatus.OK)
  assignRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignRoleSchema)) dto: AssignRoleDto,
    @Req() req: AuthedRequest,
    @Scope() scope: RequestScope,
  ) {
    return this.users.assignRole(id, dto, actorOf(req), scope);
  }

  @Post('users/:id/assign-outlets')
  @Permissions('admin.user.assign_outlet')
  @HttpCode(HttpStatus.OK)
  assignOutlets(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignOutletsSchema)) dto: AssignOutletsDto,
    @Req() req: AuthedRequest,
    @Scope() scope: RequestScope,
  ) {
    return this.users.assignOutlets(id, dto, actorOf(req), scope);
  }

  // ---- outlets and departments -------------------------------------------

  @Get('outlets')
  @Permissions('admin.outlet.manage')
  listOutlets() {
    return this.outlets.listOutlets();
  }

  @Post('outlets')
  @Permissions('admin.outlet.manage')
  @HttpCode(HttpStatus.CREATED)
  createOutlet(
    @Body(new ZodValidationPipe(createOutletSchema)) dto: CreateOutletDto,
    @Req() req: AuthedRequest,
  ) {
    return this.outlets.createOutlet(dto, actorOf(req));
  }

  @Patch('outlets/:id')
  @Permissions('admin.outlet.manage')
  updateOutlet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateOutletSchema)) dto: UpdateOutletDto,
    @Req() req: AuthedRequest,
  ) {
    return this.outlets.updateOutlet(id, dto, actorOf(req));
  }

  @Get('departments')
  @Permissions('admin.department.manage')
  listDepartments(
    @Query(new ZodValidationPipe(listDepartmentsQuery)) query: ListDepartmentsQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.outlets.listDepartments(query, scope);
  }

  @Post('departments')
  @Permissions('admin.department.manage')
  @HttpCode(HttpStatus.CREATED)
  createDepartment(
    @Body(new ZodValidationPipe(createDepartmentSchema)) dto: CreateDepartmentDto,
    @Req() req: AuthedRequest,
    @Scope() scope: RequestScope,
  ) {
    return this.outlets.createDepartment(dto, actorOf(req), scope);
  }

  @Patch('departments/:id')
  @Permissions('admin.department.manage')
  updateDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) dto: UpdateDepartmentDto,
    @Req() req: AuthedRequest,
    @Scope() scope: RequestScope,
  ) {
    return this.outlets.updateDepartment(id, dto, actorOf(req), scope);
  }

  // ---- reference data ----------------------------------------------------

  @Get('categories')
  @Permissions('inventory.category.manage')
  listCategories() {
    return this.reference.listCategories();
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

  @Patch('categories/:id')
  @Permissions('inventory.category.manage')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) dto: UpdateCategoryDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reference.updateCategory(id, dto, actorOf(req));
  }

  @Get('units')
  @Permissions('inventory.unit.manage')
  listUnits() {
    return this.reference.listUnits();
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

  @Patch('units/:id')
  @Permissions('inventory.unit.manage')
  updateUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUnitSchema)) dto: UpdateUnitDto,
    @Req() req: AuthedRequest,
  ) {
    return this.reference.updateUnit(id, dto, actorOf(req));
  }

  // ---- audit log ---------------------------------------------------------

  // The only audit route in the application. There is no POST, PATCH or DELETE
  // here and there must never be one: an admin action with no trail is exactly
  // what this module exists to prevent.
  @Get('audit-log')
  @Permissions('admin.audit.read')
  listAuditLog(
    @Query(new ZodValidationPipe(listAuditQuery)) query: ListAuditQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.audit.list(query, scope);
  }
}
