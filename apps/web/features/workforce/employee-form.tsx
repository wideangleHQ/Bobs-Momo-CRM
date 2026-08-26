'use client';

import { useState } from 'react';
import { createEmployeeSchema, updateEmployeeSchema } from '@bobs-momo/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { Employee } from '@/features/workforce/api';

export interface OutletOption {
  outletId: string;
  outletCode: string;
  departments: { id: string; name: string }[];
}

interface Props {
  outlets: OutletOption[];
  employee?: Employee;
  pending: boolean;
  problem: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel?: () => void;
}

export function EmployeeForm({ outlets, employee, pending, problem, onSubmit, onCancel }: Props) {
  const editing = Boolean(employee);
  const [fullName, setFullName] = useState(employee?.fullName ?? '');
  const [phone, setPhone] = useState(employee?.phone ?? '');
  const [outletId, setOutletId] = useState(employee?.outletId ?? outlets[0]?.outletId ?? '');
  const [departmentId, setDepartmentId] = useState(employee?.departmentId ?? '');
  const [designation, setDesignation] = useState(employee?.designation ?? '');
  const [joinedOn, setJoinedOn] = useState(
    employee?.joinedOn ?? new Date().toISOString().slice(0, 10),
  );
  const [invalid, setInvalid] = useState<string | null>(null);

  const departments = outlets.find((o) => o.outletId === outletId)?.departments ?? [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setInvalid(null);
    const raw = {
      fullName: fullName.trim(),
      phone: phone.trim(),
      outletId,
      departmentId: departmentId === '' ? null : departmentId,
      ...(designation.trim() === '' ? {} : { designation: designation.trim() }),
      ...(editing ? {} : { joinedOn }),
    };
    const parsed = editing
      ? updateEmployeeSchema.safeParse(raw)
      : createEmployeeSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setInvalid(first ? `${first.path.join('.')}: ${first.message}` : 'Check the form');
      return;
    }
    onSubmit(parsed.data as Record<string, unknown>);
  };

  return (
    <Card className="p-4">
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            inputMode="numeric"
            placeholder="9438011223"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="outletId">Outlet</Label>
          <Select
            id="outletId"
            value={outletId}
            onChange={(e) => {
              setOutletId(e.target.value);
              setDepartmentId('');
            }}
          >
            {outlets.map((o) => (
              <option key={o.outletId} value={o.outletId}>
                {o.outletCode}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="departmentId">Department</Label>
          <Select
            id="departmentId"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="designation">Designation</Label>
          <Input
            id="designation"
            placeholder="Head Cook"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
          />
        </div>

        {editing ? null : (
          <div className="space-y-1">
            <Label htmlFor="joinedOn">Joined on</Label>
            <Input
              id="joinedOn"
              type="date"
              value={joinedOn}
              onChange={(e) => setJoinedOn(e.target.value)}
            />
          </div>
        )}

        {invalid ?? problem ? (
          <p role="alert" className="text-sm text-danger">
            {invalid ?? problem}
          </p>
        ) : null}

        <div className="flex gap-3">
          {onCancel ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-[48px] flex-1"
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
          <Button type="submit" className="min-h-[48px] flex-1" disabled={pending}>
            {pending ? 'Saving...' : editing ? 'Save changes' : 'Create employee'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * There is no outlet or department endpoint a store manager can read, so the
 * choices come from the roster they can already see.
 * ponytail: swap this for GET /outlets the day that route drops its
 * admin.outlet.manage requirement.
 */
export function outletOptionsFrom(employees: Employee[]): OutletOption[] {
  const byOutlet = new Map<string, OutletOption>();
  for (const e of employees) {
    const entry = byOutlet.get(e.outletId) ?? {
      outletId: e.outletId,
      outletCode: e.outletCode,
      departments: [],
    };
    if (e.departmentId && !entry.departments.some((d) => d.id === e.departmentId)) {
      entry.departments.push({ id: e.departmentId, name: e.departmentName ?? 'Department' });
    }
    byOutlet.set(e.outletId, entry);
  }
  return [...byOutlet.values()];
}
