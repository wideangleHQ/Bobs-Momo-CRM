'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { longDate } from '@/lib/format';
import { istHhmm, listShifts } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { businessDateOffset, toBusinessDate } from '@bobs-momo/shared';

export default function MyShiftsPage() {
  const can = useCan();
  const from = toBusinessDate();
  const to = businessDateOffset(27).toISOString().slice(0, 10);
  const query = { from, to, pageSize: 50 };

  const shifts = useQuery({
    queryKey: workforceKeys.shifts(query),
    queryFn: () => listShifts(query),
  });

  const rows = shifts.data?.data ?? [];

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 p-4">
      <PageHeader
        title="My shifts"
        subtitle="The next four weeks"
        action={
          can('workforce.shift.create') ? (
            <Link href="/shifts/roster">
              <Button type="button" variant="secondary" className="min-h-[44px]">
                Roster
              </Button>
            </Link>
          ) : null
        }
      />

      {shifts.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : shifts.isError ? (
        <ErrorState
          title="Could not load your shifts"
          message={(shifts.error as Error).message}
          onRetry={() => void shifts.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No shifts rostered"
          description="Nothing is scheduled for you in the next four weeks. Ask your manager to build the roster."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={s.id}>
              <Card className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{longDate(`${s.shiftDate}T00:00:00.000Z`)}</p>
                  <p className="text-sm text-text-muted">
                    {istHhmm(s.startsAt)} - {istHhmm(s.endsAt)}
                    {s.note ? ` · ${s.note}` : ''}
                  </p>
                </div>
                <Badge variant={s.status === 'CANCELLED' ? 'neutral' : 'success'}>{s.status}</Badge>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
