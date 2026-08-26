import type { SVGProps } from 'react';

/**
 * Hand drawn so no icon package ships in the bundle. Paths are 24x24, stroked
 * with currentColor, so an icon inherits the token colour of its container.
 */
const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  tasks: 'M9 5h11M9 12h11M9 19h11M4 5l1.2 1.4L7.5 4M4 12l1.2 1.4L7.5 11M4 19l1.2 1.4L7.5 18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.2 1.9',
  calendar: 'M7 3v3m10-3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
  leave: 'M7 3v3m10-3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM9.5 13.5l5 5m0-5-5 5',
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 20v-1.5a4 4 0 0 0-3-3.87M16 3.6a4 4 0 0 1 0 7.75',
  box: 'M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5v-9ZM3.5 7.5 12 12m0 0 8.5-4.5M12 12v9',
  cart: 'M2.5 3.5h2.2l2.1 11a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2l1.4-7.3H5.8M9.5 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  truck: 'M2.5 6.5h10v10h-10zM12.5 10h4l3 3v3.5h-7zM7 20a1.8 1.8 0 1 0 0-3.5A1.8 1.8 0 0 0 7 20Zm10 0a1.8 1.8 0 1 0 0-3.5 1.8 1.8 0 0 0 0 3.5Z',
  rupee: 'M7 4h10M7 8.5h10M7 4c5 0 6.5 1.4 6.5 3.2S12 11 7.5 11H7l7.5 9',
  chart: 'M4 20V10m5 10V4m5 16v-7m5 7V8',
  message: 'M20.5 12.5c0 4.1-3.8 7.5-8.5 7.5a10 10 0 0 1-3.2-.5L3.5 21l1.6-3.7A7 7 0 0 1 3.5 12.5C3.5 8.4 7.3 5 12 5s8.5 3.4 8.5 7.5Z',
  bell: 'M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5ZM10.3 19a2 2 0 0 0 3.4 0',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-2.71 1.14V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.1 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.1a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.9 1.18l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.6 1Z',
  more: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  chevronDown: 'm6 9.5 6 6 6-6',
  chevronLeft: 'm14.5 5-7 7 7 7',
  chevronRight: 'm9.5 5 7 7-7 7',
  logout: 'M15 17.5 20 12l-5-5.5M20 12H9M12 3.5H5.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1H12',
  alert: 'M12 8.5v5m0 3.2v.05M10.3 3.9 2.5 18a1.5 1.5 0 0 0 1.3 2.2h16.4A1.5 1.5 0 0 0 21.5 18L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z',
  check: 'm4.5 12.5 5 5 10-11',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20.5 20.5 16 16',
  refresh: 'M20 11.5a8 8 0 1 0-1.2 5.5M20 5v6h-6',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13 6.5 5h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = 'h-6 w-6',
  ...rest
}: { name: string; className?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const d = PATHS[name] ?? PATHS.alert;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

/** Inline spinner for a pending button. Never replaces the button itself. */
export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" fill="none" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
