'use client';

import type { ReactNode } from 'react';
import { BellIcon, HelpIcon } from './ui/icons';

// The app frame, laid out like the PayPal Developer Dashboard: a white top bar, a left sidebar
// and a light canvas. Shared by the dashboard, its loading skeleton and its error page.

// Runway's own mark: a runway seen from above, narrowing towards the horizon.
function RunwayMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Runway">
      <rect width="32" height="32" rx="8" fill="var(--pp-navy)" />
      <path d="M13 6h6l5 20H8L13 6Z" fill="var(--pp-blue)" />
      <path d="M16 9v3M16 15v3.5M16 21.5V25" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BrandLockup() {
  return (
    <div className="flex items-center gap-3">
      <RunwayMark className="size-8" />
      <span className="text-xl font-semibold tracking-tight text-pp-navy">Runway</span>
      <span className="h-6 w-px bg-pp-border" aria-hidden />
      <span className="hidden text-xs text-pp-muted sm:inline">Cash-flow agent for PayPal invoices</span>
    </div>
  );
}

function TopBar() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-pp-border bg-white px-6">
      <BrandLockup />
      <div className="ml-auto flex items-center gap-1 text-pp-navy">
        <span className="inline-flex size-9 items-center justify-center rounded-full" title="Help">
          <HelpIcon />
        </span>
        <span className="inline-flex size-9 items-center justify-center rounded-full" title="Notifications">
          <BellIcon />
        </span>
        <span className="ml-2 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-pp-navy text-sm font-semibold text-white">
            RW
          </span>
          <span className="hidden text-sm font-semibold sm:inline">Demo studio</span>
        </span>
      </div>
    </header>
  );
}

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-pp-canvas font-paypal text-pp-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-64 shrink-0 flex-col border-r border-pp-border bg-white" aria-label="Reports">
          {sidebar}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
