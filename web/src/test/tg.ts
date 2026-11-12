// Ответы Serverless.call задаёт тест через serverless.handler(name, input);
// handler, вернувший NEVER, не отвечает вовсе (проверка таймаута).
export const NEVER = Symbol('never');
type Handler = (name: string, input: unknown) => unknown;

export const serverless: { handler: Handler; calls: { name: string; input: unknown }[] } = {
  handler: () => ({}),
  calls: [],
};

export function resetServerless() {
  serverless.handler = () => ({});
  serverless.calls = [];
}

const noop = () => {};
export const webApp = {
  initData: 'query_id=test', initDataUnsafe: { user: { id: 7, first_name: 'Тест' } },
  colorScheme: 'light', themeParams: {}, viewportStableHeight: 700, isExpanded: true, version: '9.0', platform: 'tdesktop',
  BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
  HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
  Serverless: {
    call(name: string, input: unknown, cb: (err: unknown, res?: unknown) => void) {
      serverless.calls.push({ name, input });
      Promise.resolve().then(() => serverless.handler(name, input)).then(
        (res) => { if (res !== NEVER) cb(null, res); },
        (err) => cb(err),
      );
    },
  },
  ready: noop, expand: noop, close: noop,
  showAlert: (_m: string, cb?: () => void) => cb?.(),
  showConfirm: (_m: string, cb: (ok: boolean) => void) => cb(true),
  onEvent: noop, offEvent: noop, setHeaderColor: noop, setBackgroundColor: noop,
};
