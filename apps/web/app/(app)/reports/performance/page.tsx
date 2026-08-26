'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { fetchPerformance } from '@/features/analytics/api';
import { analyticsKeys } from '@/features/analytics/keys';
import { seriesColor } from '@/features/analytics/charts';
import { csvFilename, downloadCsv, toCsv } from '@/features/analytics/csv';
import {
  ReportBody,
  ReportFilters,
  outletCodeFor,
  useOutletOptions,
  useReportRange,
} from '@/features/analytics/report-frame';
import { ReportTable, pct } from '@/features/analytics/table';
import type { PerformanceResponse, PerformanceRow } from '@/features/analytics/types';

/** A rate with no denominator is not zero, so the bar is absent rather than empty. */
function RateCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-muted">no data</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span
        aria-hidden="true"
        className="hidden h-2 w-16 overflow-hidden rounded-sm bg-border sm:inline-block"
      >
        <span
          className="block h-full"
          style={{
            width: `${Math.min(100, Math.max(0, value * 100))}%`,
            background: seriesColor(0),
          }}
        />
      </span>
      <span className="tabular-nums">{pct(value)}</span>
    </span>
  );
}

export default function PerformanceReportPage() {
  const range = useReportRange(29, 186);
  const outlets = useOutletOptions();
  const filters = { from: range.from, to: range.to, outletId: range.outletId || undefined };

  const query = useQuery({
    queryKey: analyticsKeys.performance(filters),
    queryFn: () => fetchPerformance(filters),
    enabled: range.rangeError === null,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  function exportCsv(data: PerformanceResponse) {
    const csv = toCsv(
      [
        'employee_code',
        'full_name',
        'outlet_code',
        'tasks_assigned',
        'tasks_completed',
        'completion_rate',
        'on_time_rate',
        'avg_delay_mins',
        'attendance_consistency',
        'late_count',
      ],
      data.rows.map((row) => [
        row.employeeCode,
        row.fullName,
        row.outletCode ?? '',
        row.tasksAssigned,
        row.tasksCompleted,
        row.completionRate,
        row.onTimeRate,
        row.avgDelayMins,
        row.attendanceConsistency,
        row.lateCount,
      ]),
    );
    downloadCsv(
      csvFilename(
        'performance',
        outletCodeFor(outlets.data?.data, range.outletId),
        range.from,
        range.to,
      ),
      csv,
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Employee performance"
        description="Task completion, punctuality and attendance consistency"
      />

      <ReportFilters
        range={range}
        actions={
          query.data ? (
            <Button type="button" variant="secondary" onClick={() => exportCsv(query.data)}>
              Download CSV
            </Button>
          ) : null
        }
      />

      <Card className="p-3 text-sm text-text">
        <p>
          Completion rate counts tasks the person finished against tasks assigned to them,
          excluding cancelled ones, so a manager tidying their backlog cannot lower a score.
        </p>
        <p className="mt-2">
          On time means a task finished at or before its due time, counted only across tasks that
          had a due time, so a task with no deadline is never late.
        </p>
        <p className="mt-2">
          Attendance consistency is the share of expected working days the person was present,
          counting a half day as half, with weekly offs and approved leave excluded from the
          denominator.
        </p>
        <p className="mt-2 font-medium">
          This is a prompt to go and look at something, not evidence on its own.
        </p>
      </Card>

      <ReportBody
        query={query}
        blocked={range.rangeError}
        onRetry={() => void query.refetch()}
        isEmpty={(data: PerformanceResponse) => data.rows.length === 0}
        emptyTitle="No active employees in scope"
        emptyDescription="There are no active employees at the outlets you can see, so there is nothing to score. Add employees on the workforce screen."
      >
        {(data: PerformanceResponse) => (
          <ReportTable<PerformanceRow>
            caption="Performance per employee"
            rows={data.rows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'code', header: 'Code', cell: (row) => row.employeeCode },
              { key: 'name', header: 'Name', cell: (row) => row.fullName },
              { key: 'outlet', header: 'Outlet', cell: (row) => row.outletCode ?? '' },
              {
                key: 'assigned',
                header: 'Assigned',
                align: 'right',
                cell: (row) => String(row.tasksAssigned),
              },
              {
                key: 'completed',
                header: 'Completed',
                align: 'right',
                cell: (row) => String(row.tasksCompleted),
              },
              {
                key: 'completion',
                header: 'Completion',
                align: 'right',
                cell: (row) => <RateCell value={row.completionRate} />,
              },
              {
                key: 'ontime',
                header: 'On time',
                align: 'right',
                cell: (row) => <RateCell value={row.onTimeRate} />,
              },
              {
                key: 'delay',
                header: 'Avg delay',
                align: 'right',
                cell: (row) =>
                  row.avgDelayMins === null ? 'no data' : `${row.avgDelayMins.toFixed(1)} min`,
              },
              {
                key: 'attendance',
                header: 'Attendance',
                align: 'right',
                cell: (row) => <RateCell value={row.attendanceConsistency} />,
              },
              {
                key: 'late',
                header: 'Late days',
                align: 'right',
                cell: (row) => String(row.lateCount),
              },
            ]}
          />
        )}
      </ReportBody>
    </div>
  );
}
