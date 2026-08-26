'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { useOutletOptions } from '@/features/analytics/report-frame';
import {
  listMessagingDepartments,
  messagingKeys,
  sendBroadcast,
  type BroadcastResult,
  type MessageScope,
} from './api';

const MAX_BODY = 2000;

// Scope ALL reaches staff at an outlet the sender may never have visited, so
// the API restricts it to two roles. Hiding it here keeps the choice honest.
const ALL_SCOPE_ROLES = ['OWNER', 'OPERATIONS_MANAGER'];

export function BroadcastComposer() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const outlets = useOutletOptions();
  const [scope, setScope] = useState<Exclude<MessageScope, 'DIRECT'>>('OUTLET');
  const [outletId, setOutletId] = useState(() => user?.outletIds[0] ?? '');
  const [departmentId, setDepartmentId] = useState('');
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<BroadcastResult | null>(null);

  const departments = useQuery({
    queryKey: messagingKeys.departments(),
    queryFn: listMessagingDepartments,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const send = useMutation({
    mutationFn: () =>
      sendBroadcast({
        scope,
        ...(scope === 'OUTLET' ? { outletId } : {}),
        ...(scope === 'DEPARTMENT' ? { departmentId } : {}),
        body: body.trim(),
        ...(pin ? { pin: true } : {}),
      }),
    onSuccess: (result) => {
      setSent(result);
      setBody('');
      setPin(false);
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: messagingKeys.all() });
    },
  });

  const canSendAll = user ? ALL_SCOPE_ROLES.includes(user.roleKey) : false;
  const outletOptions = outlets.data?.data ?? [];
  const departmentOptions = departments.data?.data ?? [];

  const targetMissing =
    (scope === 'OUTLET' && outletId === '') || (scope === 'DEPARTMENT' && departmentId === '');
  const ready = body.trim().length > 0 && body.length <= MAX_BODY && !targetMissing;

  const targetName =
    scope === 'ALL'
      ? 'everyone in the business'
      : scope === 'OUTLET'
        ? (outletOptions.find((o) => o.id === outletId)?.code ?? 'the selected outlet')
        : (departmentOptions.find((d) => d.id === departmentId)?.name ?? 'the selected department');

  return (
    <Card className="p-3">
      <h2 className="text-sm font-semibold text-text">Send a broadcast</h2>
      <p className="mt-1 text-sm text-text-muted">
        A broadcast is a record. It cannot be edited or deleted, and a correction is a second
        message.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="broadcast-scope">Send to</Label>
          <Select
            id="broadcast-scope"
            value={scope}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setScope(e.target.value as Exclude<MessageScope, 'DIRECT'>);
              setConfirming(false);
            }}
          >
            <option value="OUTLET">An outlet</option>
            <option value="DEPARTMENT">A department</option>
            {canSendAll ? <option value="ALL">Everyone</option> : null}
          </Select>
        </div>

        {scope === 'OUTLET' ? (
          <div>
            <Label htmlFor="broadcast-outlet">Outlet</Label>
            <Select
              id="broadcast-outlet"
              value={outletId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setOutletId(e.target.value)}
            >
              <option value="">Pick an outlet</option>
              {outletOptions.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.code}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {scope === 'DEPARTMENT' ? (
          <div>
            <Label htmlFor="broadcast-department">Department</Label>
            <Select
              id="broadcast-department"
              value={departmentId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setDepartmentId(e.target.value)
              }
            >
              <option value="">Pick a department</option>
              {departmentOptions.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.outletCode ? `${department.outletCode} ` : ''}
                  {department.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <div className="mt-3">
        <Label htmlFor="broadcast-body">Message</Label>
        <Textarea
          id="broadcast-body"
          rows={3}
          maxLength={MAX_BODY}
          placeholder="Fryer 2 is out of service until Thursday. Use fryer 1 for rolls."
          value={body}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setBody(e.target.value);
            setConfirming(false);
          }}
        />
        <p className="mt-1 text-xs text-text-muted">
          {body.length} of {MAX_BODY} characters
        </p>
      </div>

      <div className="mt-2">
        <Checkbox
          id="broadcast-pin"
          checked={pin}
          label="Pin this to the top of the feed"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPin(e.target.checked)}
        />
        <p className="text-xs text-text-muted">
          Three pins per scope at most. A pin strip nobody reads is worse than no pin.
        </p>
      </div>

      {send.isError ? (
        <p role="alert" className="mt-3 rounded-md bg-danger-bg p-3 text-sm text-danger">
          {errorMessage(send.error)}
        </p>
      ) : null}

      {sent ? (
        <p role="status" className="mt-3 rounded-md bg-success-bg p-3 text-sm text-success">
          Sent
          {sent.recipientEstimate === undefined
            ? '.'
            : ` to about ${sent.recipientEstimate} ${sent.recipientEstimate === 1 ? 'person' : 'people'}.`}
        </p>
      ) : null}

      {confirming ? (
        <div className="mt-3 rounded-md bg-warning-bg p-3">
          <p className="text-sm text-warning">
            This goes to {targetName} and cannot be recalled. Some of them get it on WhatsApp.
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" pending={send.isPending} onClick={() => send.mutate()}>
              Send it
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Go back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button
            type="button"
            disabled={!ready}
            onClick={() => {
              setSent(null);
              setConfirming(true);
            }}
          >
            Review and send
          </Button>
          {targetMissing && body.trim().length > 0 ? (
            <p className="mt-1 text-sm text-warning">Pick who this goes to first.</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
