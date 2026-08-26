export const taskKeys = {
  my: () => ['tasks', 'my'] as const,
  list: (params: Record<string, unknown>) => ['tasks', 'list', params] as const,
  detail: (id: string) => ['tasks', id] as const,
  templates: (params: Record<string, unknown>) => ['checklist-templates', params] as const,
  recurrences: (params: Record<string, unknown>) => ['task-recurrences', params] as const,
};
