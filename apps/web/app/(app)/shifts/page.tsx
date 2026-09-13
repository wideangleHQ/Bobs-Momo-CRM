'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { longDate } from '@/lib/format';
import { istHhmm, listShifts } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { businessDateOffset, toBusinessDate } from '@bobs-momo/shared';
import { Icon } from '@/components/ui/icons';

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
    <div className="w-full space-y-6 sm:space-y-8">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-100">
        <PageHeader
          title="My Rostered Shifts"
          description="Your scheduled floor and kitchen shifts for the next 4 weeks."
        />

        <div className="flex flex-wrap items-center gap-2.5">
          {can('workforce.attendance.read') && (
            <Link href="/attendance">
              <Button type="button" variant="secondary" className="min-h-[40px] text-xs sm:text-sm gap-1.5">
                <Icon name="clock" className="h-3.5 w-3.5" />
                <span>Attendance Punch</span>
              </Button>
            </Link>
          )}

          {can('workforce.shift.create') && (
            <Link href="/shifts/roster">
              <Button type="button" className="min-h-[40px] text-xs sm:text-sm gap-1.5 bg-red-600 hover:bg-red-700 text-white">
                <Icon name="calendar" className="h-3.5 w-3.5" />
                <span>Shift Roster Board</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* ── SHIFTS GRID ────────────────────────────────────── */}
      {shifts.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
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
          title="No upcoming shifts rostered"
          description="You have no scheduled shifts in the next four weeks. Check with your store manager regarding the weekly roster."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {rows.map((s) => (
            <div
              key={s.id}
              className="group relative flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md hover:border-zinc-300"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
                    <Icon name="calendar" className="h-5 w-5" />
                  </div>
                  <Badge variant={s.status === 'CANCELLED' ? 'neutral' : 'success'}>{s.status}</Badge>
                </div>

                <h3 className="text-base font-bold text-zinc-900">
                  {longDate(`${s.shiftDate}T00:00:00.000Z`)}
                </h3>
                <p className="text-sm font-semibold text-zinc-700 mt-1 flex items-center gap-1.5">
                  <Icon name="clock" className="h-4 w-4 text-zinc-400" />
                  <span>{istHhmm(s.startsAt)} – {istHhmm(s.endsAt)}</span>
                </p>
                {s.note ? (
                  <p className="text-xs text-zinc-400 mt-2 bg-zinc-50 p-2 rounded-lg border border-zinc-100">
                    {s.note}
                  </p>
                ) : null}
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-400 font-medium">
                <span>Rostered Shift</span>
                <span>IST Timezone</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
