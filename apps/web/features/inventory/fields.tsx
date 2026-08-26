'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { DatePicker } from '@/components/ui/date-picker';
import { FieldMessage } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

// Thin wrappers over components/ui so a screen passes a string and a setter
// instead of unpacking an event. The purchase feature imports these too.

export function Field(props: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.htmlFor}>{props.label}</Label>
      {props.children}
      <FieldMessage error={props.error ?? undefined} hint={props.hint} />
    </div>
  );
}

export function TextInput(props: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  type?: 'text' | 'email' | 'search' | 'tel';
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <Input
      id={props.id}
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      maxLength={props.maxLength}
      invalid={props.invalid}
      autoFocus={props.autoFocus}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function TextArea(props: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  rows?: number;
}) {
  return (
    <Textarea
      id={props.id}
      rows={props.rows ?? 3}
      value={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      maxLength={props.maxLength}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function SelectInput(props: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select
      id={props.id}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.placeholder ? <option value="">{props.placeholder}</option> : null}
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function DateInput(props: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  return (
    <DatePicker
      id={props.id}
      value={props.value}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

/**
 * Numeric keypad, never the full keyboard, and the unit stays visible while the
 * user types. Chapter 16: entering grams into a kilogram field is the most
 * expensive data entry error in this system. Keystrokes that are not a valid
 * 3 decimal quantity are dropped rather than corrected, so the field never
 * fights the person typing.
 */
export function QtyInput(props: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  allowNegative?: boolean;
}) {
  const pattern = props.allowNegative ? /^-?\d*\.?\d{0,3}$/ : /^\d*\.?\d{0,3}$/;
  return (
    <NumberInput
      id={props.id}
      value={props.value}
      unit={props.unit}
      disabled={props.disabled}
      invalid={props.invalid}
      placeholder={props.placeholder ?? '0.000'}
      onChange={(e) => {
        const next = e.target.value.trim();
        if (next === '' || pattern.test(next)) props.onChange(next);
      }}
    />
  );
}

/** Money, two decimals. Same keypad reasoning as QtyInput. */
export function MoneyInput(props: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <NumberInput
      id={props.id}
      value={props.value}
      unit="Rs"
      disabled={props.disabled}
      invalid={props.invalid}
      placeholder={props.placeholder ?? '0.00'}
      onChange={(e) => {
        const next = e.target.value.trim();
        if (next === '' || /^\d*\.?\d{0,2}$/.test(next)) props.onChange(next);
      }}
    />
  );
}

/** A filter toggle. Tabs are for switching views, chips for narrowing a list. */
export function Chip(props: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: 'default' | 'danger';
}) {
  const activeClass =
    props.tone === 'danger'
      ? 'border-danger bg-danger text-white'
      : 'border-primary bg-primary text-primary-fg';
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium ${
        props.active ? activeClass : 'border-border-strong bg-surface text-text'
      }`}
    >
      {props.children}
    </button>
  );
}

/** Inline banner for a failed mutation. Shows the API's own wording. */
export function FormError(props: { message: string | null; children?: ReactNode }) {
  if (!props.message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-text"
    >
      <p className="font-medium">{props.message}</p>
      {props.children}
    </div>
  );
}

/** 300 ms is long enough that a search box does not fire on every keystroke. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
