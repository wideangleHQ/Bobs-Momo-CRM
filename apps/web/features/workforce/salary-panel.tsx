'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSalarySchema } from '@bobs-momo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { longDate, money } from '@/lib/format';
import { createSalary, getSalary } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';

/**
 * The API returns 403 to everyone without workforce.salary.read, so the query
 * never fires without the key. Hiding the panel is the usability half; not
 * asking is what keeps a store manager's console clean of a failed request.
 */
export function SalaryPanel({ employeeId }: { employeeId: string }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const canRead = can('workforce.salary.read');
  const canWrite = can('workforce.salary.write');

  const [adding, setAdding] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [monthlyCtc, setMonthlyCtc] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const salary = useQuery({
    queryKey: workforceKeys.salary(employeeId),
    queryFn: () => getSalary(employeeId),
    enabled: canRead,
  });

  const save = useMutation({
    mutationFn: (body: unknown) => createSalary(body),
    onSuccess: () => {
      setAdding(false);
      setMonthlyCtc('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: workforceKeys.salary(employeeId) });
    },
    onError: (err: Error) => setProblem(err.message),
  });

  if (!canRead) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = createSalarySchema.safeParse({
      employeeId,
      effectiveFrom,
      monthlyCtc,
      ...(note.trim() === '' ? {} : { note: note.trim() }),
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the figures');
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Salary</h2>
        {canWrite && !adding ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            onClick={() => setAdding(true)}
          >
            Add a record
          </Button>
        ) : null}
      </div>

      {salary.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : salary.isError ? (
        <ErrorState
          title="Could not load salary"
          message={(salary.error as Error).message}
          onRetry={() => void salary.refetch()}
        />
      ) : (salary.data?.records.length ?? 0) === 0 ? (
        <EmptyState
          title="No salary on file"
          description="Add the current structure so payroll has a dated record to read from."
        />
      ) : (
        <ul className="space-y-2">
          {salary.data?.records.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 border-t pt-2">
              <div>
                <p className="font-medium">{money(r.monthlyCtc)} a month</p>
                <p className="text-sm text-text-muted">
                  From {longDate(`${r.effectiveFrom}T00:00:00.000Z`)}
                  {r.effectiveTo ? ` to ${longDate(`${r.effectiveTo}T00:00:00.000Z`)}` : ''}
                </p>
                {r.note ? <p className="text-sm text-text-muted">{r.note}</p> : null}
              </div>
              {r.isCurrent ? <Badge variant="success">Current</Badge> : null}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="space-y-3 border-t pt-3" onSubmit={submit}>
          <div className="space-y-1">
            <Label htmlFor="effectiveFrom">Effective from</Label>
            <Input
              id="effectiveFrom"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="monthlyCtc">Monthly figure</Label>
            <Input
              id="monthlyCtc"
              inputMode="decimal"
              value={monthlyCtc}
              onChange={(e) => setMonthlyCtc(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="salaryNote">Note</Label>
            <Input id="salaryNote" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="min-h-[44px] flex-1"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="min-h-[44px] flex-1" disabled={save.isPending}>
              {save.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
