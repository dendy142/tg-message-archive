import { Component, type ErrorInfo, type ReactNode } from 'react';
import { call } from '../api';
import { Icon } from './Icon';
import { t } from '../i18n';

/**
 * «Script error.» без объекта — ошибка скрипта с чужого домена (telegram-web-app.js); чинить нечего, не шлём.
 */
export const isOpaqueScriptError = (e: { error?: unknown; message?: string }) => !e.error && /^Script error\.?$/i.test(String(e.message ?? '').trim());

export function reportClientError(e: unknown, where: string) {
  const err = e instanceof Error ? e : new Error(String(e));
  call('clientError', { message: err.message.slice(0, 500), stack: (err.stack ?? '').slice(0, 4000), where: `${where} · v${__APP_VERSION__} (${__APP_COMMIT__})` }).catch(() => {});
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error(e, info.componentStack);
    reportClientError(e, `render${info.componentStack ? `: ${info.componentStack.trim().split('\n')[0]}` : ''}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty" style={{ minHeight: '100vh' }}>
        <div className="em-i err"><Icon name="alert" strokeWidth={1.7} /></div>
        <div className="em-t">{t('lock.crash.title')}</div>
        <div className="em-s">{t('lock.crash.text')}</div>
        <button className="btn tinted small" onClick={() => location.reload()}><Icon name="refresh" />{t('lock.crash.restart')}</button>
      </div>
    );
  }
}
