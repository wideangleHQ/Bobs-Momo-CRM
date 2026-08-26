'use client';

import { useState } from 'react';
import { createVendorSchema } from '@bobs-momo/shared';
import { Field, TextArea, TextInput } from '@/features/inventory/fields';

export interface VendorDraft {
  name: string;
  phone: string;
  email: string;
  address: string;
  gstin: string;
}

export const emptyVendorDraft: VendorDraft = {
  name: '',
  phone: '',
  email: '',
  address: '',
  gstin: '',
};

/** Empty optional fields are dropped: "" fails every one of those regexes. */
export function vendorPayload(draft: VendorDraft): Record<string, string> {
  const out: Record<string, string> = { name: draft.name.trim() };
  if (draft.phone.trim()) out.phone = draft.phone.trim();
  if (draft.email.trim()) out.email = draft.email.trim();
  if (draft.address.trim()) out.address = draft.address.trim();
  if (draft.gstin.trim()) out.gstin = draft.gstin.trim().toUpperCase();
  return out;
}

export function vendorIssues(draft: VendorDraft): Record<string, string> {
  const parsed = createVendorSchema.safeParse(vendorPayload(draft));
  if (parsed.success) return {};
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

export function VendorFields(props: {
  draft: VendorDraft;
  onChange: (draft: VendorDraft) => void;
  disabled?: boolean;
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const issues = vendorIssues(props.draft);
  const set = (patch: Partial<VendorDraft>) => props.onChange({ ...props.draft, ...patch });
  const errorFor = (key: keyof VendorDraft) =>
    touched[key] && props.draft[key] ? (issues[key] ?? null) : null;
  const blur = (key: keyof VendorDraft) => setTouched({ ...touched, [key]: true });

  return (
    <fieldset disabled={props.disabled} className="flex flex-col gap-4">
      <Field label="Name" htmlFor="name" error={touched.name ? (issues.name ?? null) : null}>
        <div onBlur={() => blur('name')}>
          <TextInput
            id="name"
            value={props.draft.name}
            onChange={(name) => set({ name })}
            maxLength={120}
          />
        </div>
      </Field>

      <Field
        label="Phone (optional)"
        htmlFor="phone"
        hint="Ten digits, starting 6 to 9."
        error={errorFor('phone')}
      >
        <div onBlur={() => blur('phone')}>
          <TextInput
            id="phone"
            type="tel"
            value={props.draft.phone}
            onChange={(phone) => set({ phone })}
            maxLength={10}
          />
        </div>
      </Field>

      <Field label="Email (optional)" htmlFor="email" error={errorFor('email')}>
        <div onBlur={() => blur('email')}>
          <TextInput
            id="email"
            type="email"
            value={props.draft.email}
            onChange={(email) => set({ email })}
            maxLength={120}
          />
        </div>
      </Field>

      <Field label="Address (optional)" htmlFor="address" error={errorFor('address')}>
        <TextArea
          id="address"
          value={props.draft.address}
          onChange={(address) => set({ address })}
          maxLength={300}
        />
      </Field>

      <Field
        label="GSTIN (optional)"
        htmlFor="gstin"
        hint="Fifteen characters, for example 21ABCDE1234F1Z5."
        error={errorFor('gstin')}
      >
        <div onBlur={() => blur('gstin')}>
          <TextInput
            id="gstin"
            value={props.draft.gstin}
            onChange={(gstin) => set({ gstin: gstin.toUpperCase() })}
            maxLength={15}
          />
        </div>
      </Field>
    </fieldset>
  );
}
