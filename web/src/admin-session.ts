import type { AdminMe } from './admin-api';

const SESSION_KEY = 'grounded-support.admin-session.v1';
const VIEW_KEY = 'grounded-support.admin-view.v1';

export type PersistedAdminSession = { token: string; expiresAt: number; me: AdminMe };

function tokenExpiry(token: string): number | null {
  const encoded = token.split('.')[1];
  if (!encoded) return null;
  try {
    const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isSafeInteger(payload.exp) ? payload.exp * 1000 : null;
  } catch { return null; }
}

export function saveAdminSession(token: string, me: AdminMe): PersistedAdminSession | null {
  const expiresAt = tokenExpiry(token);
  if (!expiresAt || expiresAt <= Date.now()) return null;
  const value = { token, expiresAt, me };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  return value;
}

export function loadAdminSession(): PersistedAdminSession | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(SESSION_KEY) || 'null') as PersistedAdminSession | null;
    if (!value || typeof value.token !== 'string' || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()) {
      clearAdminSession(); return null;
    }
    return value;
  } catch { clearAdminSession(); return null; }
}

export function clearAdminSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

export function saveAdminView(view: string): void { window.localStorage.setItem(VIEW_KEY, view); }
export function loadAdminView(): string | null { return window.localStorage.getItem(VIEW_KEY); }
