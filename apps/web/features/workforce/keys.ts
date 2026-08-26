export const workforceKeys = {
  employees: (params: Record<string, unknown>) => ['employees', params] as const,
  employee: (id: string) => ['employees', id] as const,
  salary: (employeeId: string) => ['employees', employeeId, 'salary'] as const,
  board: () => ['attendance', 'today'] as const,
  attendance: (params: Record<string, unknown>) => ['attendance', 'history', params] as const,
  shifts: (params: Record<string, unknown>) => ['shifts', params] as const,
  leave: (params: Record<string, unknown>) => ['leave', params] as const,
};
