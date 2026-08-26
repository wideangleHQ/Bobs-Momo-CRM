import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { EmployeesService } from './employees.service';
import { LeaveService } from './leave.service';
import { SalaryService } from './salary.service';
import { ShiftsService } from './shifts.service';
import { WorkforceController } from './workforce.controller';

// One module directory rather than five. Employees, attendance, shifts, leave
// and salary are one lane in the delivery plan and share the employee record,
// so splitting them into five NestJS modules would buy nothing but imports.
@Module({
  controllers: [WorkforceController],
  providers: [EmployeesService, AttendanceService, ShiftsService, LeaveService, SalaryService],
  exports: [AttendanceService, EmployeesService],
})
export class WorkforceModule {}
