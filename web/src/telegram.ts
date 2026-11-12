import { useEffect, useRef } from 'react';

type ThemeParams = Record<string, string>;

interface SerializableError extends Error {
  type?: string;
  parameters?: Record<string, unknown>;
}

interface WebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string }; start_param?: string };
  colorScheme: 'light' | 'dark';
  themeParams: ThemeParams;
  viewportStableHeight: number;
  isExpanded: boolean;
  version: string;
  platform: string;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: { impactOccurred(s: string): void; notificationOccurred(s: string): void; selectionChanged(): void };
  BiometricManager?: {
    isInited: boolean; isBiometricAvailable: boolean; isAccessGranted: boolean; isAccessRequested?: boolean; biometricType?: string;
    init(cb?: () => void): void;
    requestAccess(p: { reason?: string }, cb?: (granted: boolean) => void): void;
    authenticate(p: { reason?: string }, cb?: (ok: boolean, token?: string) => void): void;
  };
  Serverless?: { call(name: string, input: unknown, cb: (err: SerializableError | null, res?: unknown) => void): void; call(name: string, cb: (err: SerializableError | null, res?: unknown) => void): void };
  requestChat?: (reqId: string | number, cb?: (sent: boolean) => void) => void;
  shareMessage?: (preparedId: string, cb?: (sent: boolean) => void) => void;
  openInvoice?: (url: string, cb?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void) => void;
  isVersionAtLeast?: (v: string) => boolean;
  ready(): void; expand(): void; close(): void;
  showAlert(m: string, cb?: () => void): void;
  showConfirm(m: string, cb: (ok: boolean) => void): void;
  openTelegramLink?(url: string): void;
  openLink?(url: string): void;
  onEvent(e: string, cb: () => void): void;
  offEvent(e: string, cb: () => void): void;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  disableVerticalSwipes?(): void;
}

declare global {
  interface Window { Telegram?: { WebApp: WebApp } }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp;

export const insideTelegram = !!tg?.initData;

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try { tg.disableVerticalSwipes?.(); } catch { /* старые клиенты */ }
}

/** start_param или ?s=… в адресе: у web_app-кнопок уведомлений бота start_param нет. */
export function startParam(): string {
  const fromInit = tg?.initDataUnsafe?.start_param;
  if (fromInit) return fromInit;
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get('s') ?? q.get('tgWebAppStartParam') ?? '';
  } catch { return ''; }
}
export const colorScheme = () => tg?.colorScheme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'select') {
  try {
    if (kind === 'select') tg?.HapticFeedback.selectionChanged();
    else if (kind === 'success' || kind === 'warning' || kind === 'error') tg?.HapticFeedback.notificationOccurred(kind);
    else tg?.HapticFeedback.impactOccurred(kind);
  } catch { /* не критично */ }
}

// Telegram onClick вызывает ВСЕ колбэки «Назад»: держим свой стек и зовём только верхний.
const backStack: { fn: () => void }[] = [];
let backBound = false;
const backTop = () => backStack[backStack.length - 1]?.fn();

function syncBack() {
  if (!backBound) {
    backBound = true;
    tg?.BackButton.onClick(backTop);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && backStack.length) { e.preventDefault(); backTop(); } });
  }
  if (!tg) return;
  if (backStack.length) tg.BackButton.show(); else tg.BackButton.hide();
}

export function useBackButton(handler: (() => void) | null) {
  const ref = useRef(handler);
  ref.current = handler;
  const on = !!handler;
  useEffect(() => {
    if (!on) return;
    const entry = { fn: () => ref.current?.() };
    backStack.push(entry);
    syncBack();
    return () => {
      const i = backStack.indexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
      syncBack();
    };
  }, [on]);
}

export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!tg) { resolve(window.confirm(message)); return; }
    tg.showConfirm(message, resolve);
  });
}

export function alert(message: string): Promise<void> {
  return new Promise((resolve) => {
    if (!tg) { window.alert(message); resolve(); return; }
    tg.showAlert(message, resolve);
  });
}

export function openTgLink(url: string) {
  try {
    if (tg?.openTelegramLink) { tg.openTelegramLink(url); return; }
  } catch { /* старые клиенты */ }
  window.open(url, '_blank', 'noopener');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

/** Умеет ли клиент «Переслать в чат» подготовленное сообщение (Bot API 8.0). */
export const canShareMessage = () => typeof tg?.shareMessage === 'function' && (tg?.isVersionAtLeast?.('8.0') ?? true);

export function shareMessage(preparedId: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!tg?.shareMessage) { resolve(false); return; }
    try { tg.shareMessage(preparedId, (sent) => resolve(!!sent)); } catch { resolve(false); }
  });
}

/** Поддерживает ли клиент выбор группы кнопкой requestChat (Bot API 9.6). */
export const canRequestChat = () => typeof tg?.requestChat === 'function';

export function requestChat(preparedId: string | number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!tg?.requestChat) { resolve(false); return; }
    try { tg.requestChat(preparedId, (sent) => resolve(!!sent)); } catch { resolve(false); }
  });
}
