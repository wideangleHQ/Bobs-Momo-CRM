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
  bulkShiftSchema,
  createEmployeeSchema,
  createLeaveSchema,
  createSalarySchema,
  createShiftSchema,
  decideLeaveSchema,
  editPunchSchema,
  exitEmployeeSchema,
  listAttendanceQuery,
  listEmployeesQuery,
  listLeaveQuery,
  listShiftsQuery,
  punchSchema,
  startBreakSchema,
  updateEmployeeSchema,
  type BulkShiftDto,
  type CreateEmployeeDto,
  type CreateLeaveDto,
  type CreateSalaryDto,
  type CreateShiftDto,
  type DecideLeaveDto,
  type EditPunchDto,
  type ExitEmployeeDto,
  type ListAttendanceQuery,
  type ListEmployeesQuery,
  type ListLeaveQuery,
  type ListShiftsQuery,
  type PunchDto,
  type StartBreakDto,
} from '@bobs-momo/shared';
import { CurrentUser, Scope } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { grantsFor } from '../../common/permissions';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthedRequest, AuthedUser, RequestScope } from '../../common/types/request';
import { AttendanceService } from './attendance.service';
import { EmployeesService } from './employees.service';
import { LeaveService } from './leave.service';
import { SalaryService } from './salary.service';
import { ShiftsService } from './shifts.service';

@Controller()
export class WorkforceController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly attendance: AttendanceService,
    private readonly shifts: ShiftsService,
    private readonly leave: LeaveService,
    private readonly salary: SalaryService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ---- employees ---------------------------------------------------------

  @Get('employees')
  @Permissions('workforce.employee.read')
  listEmployees(
    @Query(new ZodValidationPipe(listEmployeesQuery)) query: ListEmployeesQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.employees.list(query, scope);
  }

  @Get('employees/:id')
  @Permissions('workforce.employee.read')
  getEmployee(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.employees.get(id, scope);
  }

  @Post('employees')
  @Permissions('workforce.employee.create')
  @HttpCode(HttpStatus.CREATED)
  createEmployee(
    @Body(new ZodValidationPipe(createEmployeeSchema)) dto: CreateEmployeeDto,
    @Scope() scope: RequestScope,
  ) {
    return this.employees.create(dto, scope);
  }

  @Patch('employees/:id')
  @Permissions('workforce.employee.update')
  updateEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) dto: import('@bobs-momo/shared').UpdateEmployeeDto,
    @Scope() scope: RequestScope,
  ) {
    return this.employees.update(id, dto, scope);
  }

  @Post('employees/:id/exit')
  @Permissions('workforce.employee.update')
  @HttpCode(HttpStatus.OK)
  exitEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(exitEmployeeSchema)) dto: ExitEmployeeDto,
    @Scope() scope: RequestScope,
  ) {
    return this.employees.exit(id, dto, scope);
  }

  // ---- attendance --------------------------------------------------------

  @Post('attendance/punch')
  @Permissions('workforce.attendance.edit', 'workforce.attendance.punch_self')
  @HttpCode(HttpStatus.CREATED)
  async punch(
    @Body(new ZodValidationPipe(punchSchema)) dto: PunchDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
    @Req() req: AuthedRequest,
  ) {
    // Required, not optional. A cook on 3G taps punch, sees nothing for two
    // seconds and taps again; without the key the second tap is a second IN and
    // the guard's 409 looks like a bug to somebody who did nothing wrong.
    const key = IdempotencyService.require(
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined,
    );
    const { hit, commit } = await this.idempotency.replay<
      Awaited<ReturnType<AttendanceService['punch']>>
    >(key, user.sub, 'attendance.punch', dto);
    if (hit) return hit;

    const result = await this.attendance.punch(dto, user, scope);
    await commit(result);
    return result;
  }

  @Post('attendance/break/start')
  @Permissions('workforce.break.log_self')
  @HttpCode(HttpStatus.OK)
  startBreak(
    @Body(new ZodValidationPipe(startBreakSchema)) dto: StartBreakDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.attendance.startBreak(dto, user, scope);
  }

  @Post('attendance/break/end')
  @Permissions('workforce.break.log_self')
  @HttpCode(HttpStatus.OK)
  endBreak(@CurrentUser() user: AuthedUser, @Scope() scope: RequestScope) {
    return this.attendance.endBreak(user, scope);
  }

  @Get('attendance/today')
  @Permissions('workforce.attendance.read')
  today(@Scope() scope: RequestScope) {
    return this.attendance.today(scope);
  }

  @Get('attendance')
  @Permissions('workforce.attendance.read')
  listAttendance(
    @Query(new ZodValidationPipe(listAttendanceQuery)) query: ListAttendanceQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.attendance.list(query, scope);
  }

  @Patch('attendance/punches/:id')
  @Permissions('workforce.attendance.edit')
  editPunch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(editPunchSchema)) dto: EditPunchDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.attendance.editPunch(id, dto, user, scope);
  }

  // ---- shifts ------------------------------------------------------------

  @Get('shifts')
  @Permissions('workforce.shift.read')
  listShifts(
    @Query(new ZodValidationPipe(listShiftsQuery)) query: ListShiftsQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.shifts.list(query, scope);
  }

  @Post('shifts')
  @Permissions('workforce.shift.create')
  @HttpCode(HttpStatus.CREATED)
  createShift(
    @Body(new ZodValidationPipe(createShiftSchema)) dto: CreateShiftDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.shifts.create(dto, user, scope);
  }

  @Post('shifts/bulk')
  @Permissions('workforce.shift.create')
  @HttpCode(HttpStatus.CREATED)
  bulkShifts(
    @Body(new ZodValidationPipe(bulkShiftSchema)) dto: BulkShiftDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.shifts.bulk(dto, user, scope);
  }

  @Post('shifts/:id/cancel')
  @Permissions('workforce.shift.create')
  @HttpCode(HttpStatus.OK)
  cancelShift(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.shifts.remove(id, scope);
  }

  // ---- leave -------------------------------------------------------------

  @Get('leave-requests')
  @Permissions('workforce.leave.read')
  listLeave(
    @Query(new ZodValidationPipe(listLeaveQuery)) query: ListLeaveQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.leave.list(query, scope);
  }

  @Get('leave-requests/:id')
  @Permissions('workforce.leave.read')
  getLeave(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.leave.get(id, scope);
  }

  @Post('leave-requests')
  @Permissions('workforce.leave.request')
  @HttpCode(HttpStatus.CREATED)
  createLeave(
    @Body(new ZodValidationPipe(createLeaveSchema)) dto: CreateLeaveDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.leave.create(dto, user, scope, canDecideLeave(user));
  }

  @Post('leave-requests/:id/approve')
  @Permissions('workforce.leave.decide')
  @HttpCode(HttpStatus.OK)
  approveLeave(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideLeaveSchema)) dto: DecideLeaveDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.leave.decide(id, 'APPROVED', dto, user, scope);
  }

  @Post('leave-requests/:id/reject')
  @Permissions('workforce.leave.decide')
  @HttpCode(HttpStatus.OK)
  rejectLeave(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideLeaveSchema)) dto: DecideLeaveDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.leave.decide(id, 'REJECTED', dto, user, scope);
  }

  // Decide first, so a manager gets outlet scope and an employee falls through
  // to the SELF grant and can only withdraw their own.
  @Post('leave-requests/:id/cancel')
  @Permissions('workforce.leave.decide', 'workforce.leave.request')
  @HttpCode(HttpStatus.OK)
  cancelLeave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.leave.cancel(id, user, scope, canDecideLeave(user));
  }

  // ---- salary ------------------------------------------------------------

  @Get('employees/:id/salary')
  @Permissions('workforce.salary.read')
  listSalary(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.salary.list(id, scope);
  }

  @Post('salary')
  @Permissions('workforce.salary.write')
  @HttpCode(HttpStatus.CREATED)
  createSalary(
    @Body(new ZodValidationPipe(createSalarySchema)) dto: CreateSalaryDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.salary.create(dto, user, scope);
  }
}

function canDecideLeave(user: AuthedUser): boolean {
  return 'workforce.leave.decide' in grantsFor(user.roleKey);
}
