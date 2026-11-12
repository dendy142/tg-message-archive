import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { call, ApiError } from './api';
import { tg, useBackButton, startParam, insideTelegram, haptic } from './telegram';
import { setTimezone, deviceTimezone } from './util';
import { setLang, t, type Key } from './i18n';
import { readCache, writeCache, setCacheEnabled } from './cache';
import { getItem, setItem } from './storage';
import { NavCtx, LayerCtx, type Nav, type Route, type Tab, type FeedKind, type ChoiceSpec } from './nav';
import { useBus } from './bus';
import type { Bootstrap } from './types';
import { Icon, type IconName } from './components/Icon';
import { Sheet, ChoiceList } from './components/Sheet';
import { Lock } from './screens/Lock';
import { Onboarding } from './screens/Onboarding';
import { Feed } from './screens/Feed';
import { Chats } from './screens/Chats';
import { Media } from './screens/Media';
import { Stats } from './screens/Stats';
import { Settings } from './screens/Settings';
import { EventCard } from './screens/EventCard';
import { Conversation } from './screens/Conversation';
import { Contact } from './screens/Contact';
import { Search } from './screens/Search';

const TABS: { id: Tab; icon: IconName; label: Key }[] = [
  { id: 'feed', icon: 'inbox', label: 'app.tab.feed' },
  { id: 'chats', icon: 'chat', label: 'app.tab.chats' },
  { id: 'media', icon: 'image', label: 'app.tab.media' },
  { id: 'stats', icon: 'chart', label: 'app.tab.stats' },
  { id: 'settings', icon: 'settings', label: 'app.tab.settings' },
];

/** start_param вида e<id> (событие) или c<chatId> (чат) → начальный экран в стеке. */
function routeFromStart(): Route | null {
  const s = startParam();
  const e = /^e(\d+)$/.exec(s);
  if (e) return { name: 'event', id: Number(e[1]) };
  const c = /^c(-?\d+)$/.exec(s);
  if (c) return { name: 'chat', chatId: Number(c[1]) };
  // r<chatId> — «Ответить» под уведомлением: переписка с курсором в поле ответа.
  const r = /^r(-?\d+)$/.exec(s);
  if (r) return { name: 'chat', chatId: Number(r[1]), compose: true };
  return null;
}

interface Layer { key: number; route: Route }

const routeOfChat = (r: Route, chatId: number) => 'chatId' in r && r.chatId === chatId;
interface Toast { msg: string; tone?: 'ok' | 'err'; n: number }

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [tab, setTabState] = useState<Tab>(() => {
    const t = getItem<Tab>('ui.tab');
    return t && TABS.some((x) => x.id === t) ? t : 'feed';
  });
  const [visited, setVisited] = useState<Tab[]>(() => [tab]);
  const [stack, setStack] = useState<Layer[]>([]);
  const [toastState, setToast] = useState<Toast | null>(null);
  const [feedIntent, setFeedIntent] = useState<{ kind: FeedKind; n: number } | null>(null);
  const [choice, setChoice] = useState<{ spec: ChoiceSpec<unknown>; resolve: (v: unknown) => void } | null>(null);
  const lastSpec = useRef<ChoiceSpec<unknown> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrolls = useRef(new Map<string, number>());
  const keySeq = useRef(0);
  const lockChecked = useRef(false);
  const toastRef = useRef<((msg: string, tone?: 'ok' | 'err') => void) | null>(null);

  const activeId = stack.length ? `s${stack[stack.length - 1].key}` : `t${tab}`;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const saveScroll = () => scrolls.current.set(activeRef.current, window.scrollY);

  const reloadBoot = useCallback(async () => {
    const b = await call<Bootstrap>('bootstrap');
    setTimezone(b.settings.timezone);
    setLang(b.settings.lang);
    setBoot(b);
    // С замком архив на устройстве не храним: кеш выключается и стирается.
    setCacheEnabled(!b.settings.lockEnabled);
    writeCache('bootstrap', b);
    if (!lockChecked.current) { lockChecked.current = true; if (b.settings.lockEnabled) setLocked(true); }
    return b;
  }, []);

  // Пояс с устройства: новым — сразу, с «auto» — при переезде; выбранный руками не трогаем.
  const tzSynced = useRef(false);
  useEffect(() => {
    if (!boot || tzSynced.current) return;
    tzSynced.current = true;
    const dev = deviceTimezone();
    const s = boot.settings;
    const want = dev && (s.tzSource === 'auto' ? dev !== s.timezone : s.tzSource == null && !s.onboardedAt);
    if (want) call('settings', { timezone: dev, tzSource: 'auto' }).then(() => reloadBoot()).catch(() => {});
  }, [boot, reloadBoot]);

  const start = useCallback(() => {
    setError(null);
    const cached = readCache<Bootstrap>('bootstrap');
    if (cached) { setTimezone(cached.settings.timezone); setLang(cached.settings.lang); setBoot((b) => b ?? cached); }
    const r = routeFromStart();
    if (cached && r) setStack([{ key: ++keySeq.current, route: r }]);
    reloadBoot()
      .then(() => { if (!cached && r) setStack([{ key: ++keySeq.current, route: r }]); })
      .catch((e: ApiError) => { if (cached) toastRef.current?.(e.message, 'err'); else setError(e.message); });
  }, [reloadBoot]);
  useEffect(start, [start]);

  const lockOn = !!boot?.settings.lockEnabled;
  const autoLockMin = boot?.settings.autoLockMin ?? null;
  useEffect(() => {
    if (!lockOn || autoLockMin == null) return;
    let hiddenAt = 0;
    const hide = () => { if (!hiddenAt) hiddenAt = Date.now(); };
    const show = () => {
      if (hiddenAt && Date.now() - hiddenAt >= autoLockMin * 60_000) setLocked(true);
      hiddenAt = 0;
    };
    const onVisibility = () => (document.hidden ? hide() : show());
    document.addEventListener('visibilitychange', onVisibility);
    tg?.onEvent('deactivated', hide);
    tg?.onEvent('activated', show);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      tg?.offEvent('deactivated', hide);
      tg?.offEvent('activated', show);
    };
  }, [lockOn, autoLockMin]);

  useLayoutEffect(() => { window.scrollTo(0, scrolls.current.get(activeId) ?? 0); }, [activeId]);

  const pop = useCallback(() => {
    setStack((s) => {
      const top = s[s.length - 1];
      if (top) scrolls.current.delete(`s${top.key}`);
      return s.slice(0, -1);
    });
    haptic('light');
  }, []);
  const push = useCallback((r: Route) => {
    saveScroll();
    setStack((s) => [...s, { key: ++keySeq.current, route: r }]);
    haptic('light');
  }, []);
  const setTab = useCallback((t: Tab, opts?: { feedKind?: FeedKind }) => {
    if (opts?.feedKind) setFeedIntent({ kind: opts.feedKind, n: Date.now() });
    if (t === activeRef.current.slice(1) && activeRef.current.startsWith('t')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    saveScroll();
    setStack([]);
    setTabState(t);
    setItem('ui.tab', t);
    setVisited((v) => (v.includes(t) ? v : [...v, t]));
    haptic('select');
  }, []);

  useBackButton(stack.length && !locked ? pop : null);

  useBus((ev) => {
    if (ev.type !== 'chatDeleted') return;
    setStack((s) => {
      const keep = s.filter((l) => !routeOfChat(l.route, ev.chatId));
      for (const l of s) if (!keep.includes(l)) scrolls.current.delete(`s${l.key}`);
      return keep.length === s.length ? s : keep;
    });
  });

  const toast = useCallback((msg: string, tone?: 'ok' | 'err') => {
    setToast({ msg, tone, n: Date.now() });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), tone === 'err' ? 3600 : 2400);
  }, []);
  toastRef.current = toast;

  const unlock = useCallback(() => setLocked(false), []);
  const choose = useCallback(<T,>(spec: ChoiceSpec<T>) => new Promise<T | null>((resolve) => {
    lastSpec.current = spec as ChoiceSpec<unknown>;
    setChoice({ spec: spec as ChoiceSpec<unknown>, resolve: resolve as (v: unknown) => void });
  }), []);
  const pick = (v: unknown) => { choice?.resolve(v); setChoice(null); };

  const patchCounts = useCallback((p: Partial<Bootstrap['counts']>) => {
    setBoot((b) => (b ? { ...b, counts: { ...b.counts, ...p } } : b));
  }, []);

  const nav = useMemo<Nav | null>(() => (boot ? {
    boot, reloadBoot, tab, setTab, feedIntent, push, pop, toast, choose, patchCounts,
  } : null), [boot, reloadBoot, tab, setTab, feedIntent, push, pop, toast, choose, patchCounts]);

  if (error) {
    return (
      <div className="center-screen">
        <div className="empty" style={{ padding: 0 }}>
          <div className="em-i err"><Icon name="alert" /></div>
          <div className="em-t">{t('app.openFailed')}</div>
          <div className="em-s">{insideTelegram ? error : t('app.openFromTelegram')}</div>
          {insideTelegram && <button className="btn tinted small" onClick={start}><Icon name="refresh" />{t('common.retry')}</button>}
        </div>
      </div>
    );
  }
  if (!boot || !nav) return <div className="center-screen"><div className="spin" /></div>;

  const needsOnboarding = !boot.onboarded || !boot.connection.connected;
  const onboarding = needsOnboarding && stack.length === 0;
  const showTabbar = !onboarding && stack.length === 0;
  const spec = choice?.spec ?? lastSpec.current;

  return (
    <NavCtx.Provider value={nav}>
      <div className={`app${showTabbar ? ' with-tabbar' : ''}`}>
        {onboarding ? <Onboarding /> : (
          <>
            {visited.map((t) => {
              const on = !stack.length && t === tab;
              return (
                <section key={t} className="layer tab" hidden={!on}>
                  <LayerCtx.Provider value={on}><TabScreen tab={t} /></LayerCtx.Provider>
                </section>
              );
            })}
            {stack.map((l, i) => {
              const on = i === stack.length - 1;
              return (
                <section key={l.key} className="layer enter" hidden={!on}>
                  <LayerCtx.Provider value={on}><StackScreen route={l.route} /></LayerCtx.Provider>
                </section>
              );
            })}
          </>
        )}
        {showTabbar && (
          <nav className="tabbar">
            {TABS.map((tb) => (
              <button key={tb.id} className={tab === tb.id ? 'on' : ''} onClick={() => setTab(tb.id)} aria-current={tab === tb.id ? 'page' : undefined}>
                <span className="tb-ico"><Icon name={tb.icon} strokeWidth={tab === tb.id ? 2.1 : 1.8} />
                  {tb.id === 'feed' && (boot.counts.unreadEvents ?? 0) > 0 && <span className="tb-badge">{Math.min(boot.counts.unreadEvents ?? 0, 99)}</span>}
                </span>{t(tb.label)}
              </button>
            ))}
          </nav>
        )}
        {toastState && (
          <div key={toastState.n} className={`toast${toastState.tone ? ` ${toastState.tone}` : ''}`} role="status">
            {toastState.tone && <Icon name={toastState.tone === 'ok' ? 'check' : 'alert'} strokeWidth={2.2} />}
            {toastState.msg}
          </div>
        )}
        <Sheet open={!!choice} onClose={() => pick(null)} title={spec?.title} message={spec?.message}>
          {spec && <ChoiceList spec={spec} onPick={pick} />}
        </Sheet>
        {/* Замок — слоем поверх: после разблокировки экраны, прокрутка и загруженное на месте. */}
        {locked && <div className="lock-overlay"><Lock mode={boot.settings.lockMode === 'pin' ? 'pin' : 'biometric'} onUnlock={unlock} /></div>}
      </div>
    </NavCtx.Provider>
  );
}

const TabScreen = memo(function TabScreen({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'feed': return <Feed />;
    case 'chats': return <Chats />;
    case 'media': return <Media />;
    case 'stats': return <Stats />;
    case 'settings': return <Settings />;
  }
});

const StackScreen = memo(function StackScreen({ route }: { route: Route }) {
  switch (route.name) {
    case 'event': return <EventCard id={route.id} />;
    case 'chat': return <Conversation chatId={route.chatId} chatName={route.chatName} jumpTo={route.jumpTo} focusId={route.focusId} compose={route.compose} />;
    case 'contact': return <Contact chatId={route.chatId} />;
    case 'media': return <Media chatId={route.chatId} chatName={route.chatName} />;
    case 'stats': return <Stats chatId={route.chatId} chatName={route.chatName} />;
    case 'search': return <Search initial={route.q} chatId={route.chatId} chatName={route.chatName} />;
  }
});
