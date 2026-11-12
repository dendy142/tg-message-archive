import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { tg, initTelegram, colorScheme } from './telegram';
import { App } from './app';
import { setLang, langFromCode } from './i18n';
import { ErrorBoundary, reportClientError, isOpaqueScriptError } from './components/ErrorBoundary';
import './theme.css';

function applyTheme() {
  const p = tg?.themeParams ?? {};
  const root = document.documentElement;
  for (const [k, v] of Object.entries(p)) root.style.setProperty(`--tg-theme-${k.replace(/_/g, '-')}`, String(v));
  root.dataset.scheme = colorScheme();
  try { tg?.setBackgroundColor('secondary_bg_color'); tg?.setHeaderColor('secondary_bg_color'); } catch { /* старые клиенты */ }
}

function trackScroll() {
  let on = false, off = false;
  const root = document.documentElement;
  const upd = () => {
    const y = window.scrollY;
    if ((y > 4) !== on) { on = y > 4; root.toggleAttribute('data-scrolled', on); }
    if ((y > 44) !== off) { off = y > 44; root.toggleAttribute('data-title-off', off); }
  };
  window.addEventListener('scroll', upd, { passive: true });
  upd();
}

setLang(langFromCode(tg?.initDataUnsafe?.user?.language_code));
initTelegram();
applyTheme();
trackScroll();
tg?.onEvent('themeChanged', applyTheme);
window.addEventListener('error', (e) => { if (!isOpaqueScriptError(e)) reportClientError(e.error ?? e.message, 'window.onerror'); });
window.addEventListener('unhandledrejection', (e) => reportClientError(e.reason, 'unhandledrejection'));
if (!tg) window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
