import { useEffect, useRef, useState, useCallback, type ReactNode, type RefObject } from 'react';
import type { Cursor } from '../types';
import { Icon, type IconName } from './Icon';
import { avatarBg, initials } from '../util';
import { readCache, writeCache } from '../cache';
import { cachedAvatar, loadAvatar } from '../files';
import { t } from '../i18n';

export function Header({ title, sub, large, right, avatar, onTitle, photo }: {
  title: ReactNode; sub?: ReactNode; large?: boolean; right?: ReactNode;
  avatar?: { id: number; name: string | null }; onTitle?: () => void;
  photo?: boolean;
}) {
  if (large) {
    return (
      <>
        <header className="hdr bar">
          <div className="mini ellipsis" aria-hidden="true">{title}</div>
          {right && <div className="acts">{right}</div>}
        </header>
        <div className={`large-t${right ? ' with-acts' : ''}`}>
          <h1 className="ttl">{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </>
    );
  }
  const body = (
    <>
      {avatar && <Avatar id={avatar.id} name={avatar.name} size={38} photo={photo} />}
      <div className="grow">
        <div className="ttl ellipsis">{title}</div>
        {sub && <div className="sub ellipsis">{sub}</div>}
      </div>
    </>
  );
  return (
    <header className={`hdr${large ? ' large' : ''}`}>
      {onTitle ? <button className="who" onClick={onTitle}>{body}</button> : <div className="who">{body}</div>}
      {right && <div className="acts">{right}</div>}
    </header>
  );
}

export function IconButton({ icon, label, onClick, on, dot }: { icon: IconName; label: string; onClick: () => void; on?: boolean; dot?: boolean }) {
  return (
    <button className={`icon-btn${on ? ' on' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
      {dot && <span className="dot" />}
    </button>
  );
}

export const SectionHeader = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="sec-h"><span>{children}</span>{right}</div>
);
export const SectionFooter = ({ children }: { children: ReactNode }) => <div className="sec-f">{children}</div>;

export function Cell({ icon, color, title, sub, value, chevron, onClick, tone, right, left, disabled, className, checked, label }: {
  icon?: IconName; color?: string; title: ReactNode; sub?: ReactNode; value?: ReactNode; chevron?: boolean;
  onClick?: () => void; tone?: 'danger' | 'accent'; right?: ReactNode; left?: ReactNode; disabled?: boolean; className?: string;
  checked?: boolean; label?: string;
}) {
  const cls = ['cell', onClick && 'tap', (icon || left) && 'ic', tone, className].filter(Boolean).join(' ');
  const inner = (
    <>
      {left}
      {icon && (color
        ? <span className="tile" style={{ ['--c' as string]: color }}><Icon name={icon} /></span>
        : <Icon name={icon} className={tone === 'danger' ? 'red' : ''} />)}
      <div className="grow">
        <div className="t">{title}</div>
        {sub && <div className="s">{sub}</div>}
      </div>
      {value != null && value !== '' && <span className="v ellipsis">{value}</span>}
      {right}
      {chevron && <Icon name="chevronRight" className="chev" strokeWidth={2.2} />}
    </>
  );
  return onClick
    ? <button className={cls} onClick={onClick} disabled={disabled} aria-label={label}
      {...(checked === undefined ? {} : { role: 'switch', 'aria-checked': checked })}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}

/** Сам не кликается: нажатие обрабатывает строка-кнопка, иначе кнопка в кнопке и двойные события. */
export function Switch({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return <span aria-hidden="true" className={`switch${on ? ' on' : ''}${disabled ? ' off' : ''}`} />;
}

export function ToggleCell({ on, onChange, disabled, ...rest }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; icon?: IconName; color?: string; title: ReactNode; sub?: ReactNode }) {
  return <Cell {...rest} disabled={disabled} onClick={() => onChange(!on)} checked={on}
    label={typeof rest.title === 'string' ? rest.title : undefined} right={<Switch on={on} disabled={disabled} />} />;
}

export function Chips<T extends string>({ items, value, onChange, lead, trail }: {
  items: { id: T; label: string; icon?: IconName; n?: number | null }[]; value: T; onChange: (v: T) => void;
  lead?: ReactNode; trail?: ReactNode;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('.chip.on');
    if (el && box.current) {
      const b = box.current, l = el.offsetLeft - 16, r = el.offsetLeft + el.offsetWidth + 16;
      if (l < b.scrollLeft) b.scrollTo({ left: l, behavior: 'smooth' });
      else if (r > b.scrollLeft + b.clientWidth) b.scrollTo({ left: r - b.clientWidth, behavior: 'smooth' });
    }
  }, [value]);
  return (
    <div className="chips" role="tablist" ref={box}>
      {lead}
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} className={`chip${value === it.id ? ' on' : ''}`} onClick={() => onChange(it.id)}>
          {it.icon && <Icon name={it.icon} />}{it.label}{it.n ? <span className="n">{it.n}</span> : null}
        </button>
      ))}
      {trail}
    </div>
  );
}

export function Segmented<T extends string | number>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segm" role="tablist">
      {items.map((it) => (
        <button key={String(it.id)} role="tab" aria-selected={value === it.id} className={value === it.id ? 'on' : ''} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  );
}

export type AvatarStatus = 'del' | 'edit' | 'fire' | 'fav' | null;
const STATUS_ICON: Record<string, IconName> = { del: 'trash', edit: 'pencil', fire: 'flame', fav: 'starFill' };

export function Avatar({ id, name, size = 46, status, photo }: { id: number; name: string | null; size?: number; status?: AvatarStatus; photo?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useInView(ref);
  const [src, setSrc] = useState<string | null>(() => (photo ? cachedAvatar(id) ?? null : null));
  useEffect(() => {
    if (!photo || !seen || src) return;
    let alive = true;
    loadAvatar(id).then((u) => { if (alive && u) setSrc(u); });
    return () => { alive = false; };
  }, [photo, seen, src, id]);
  return (
    <div ref={ref} className="avatar" style={{ ['--sz' as string]: `${size}px`, background: avatarBg(id) }} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : initials(name)}
      {status && <span className={`st ${status}`}><Icon name={STATUS_ICON[status]} strokeWidth={2.6} /></span>}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="empty">
      <div className="em-i"><Icon name={icon} strokeWidth={1.6} /></div>
      <div className="em-t">{title}</div>
      {text && <div className="em-s">{text}</div>}
      {action && <button className="btn tinted small" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

export function ErrorState({ text, onRetry }: { text?: string | null; onRetry?: () => void }) {
  return (
    <div className="empty">
      <div className="em-i err"><Icon name="alert" strokeWidth={1.7} /></div>
      <div className="em-t">{t('common.loadFailed')}</div>
      <div className="em-s">{text || t('common.checkConnection')}</div>
      {onRetry && <button className="btn tinted small" onClick={onRetry}><Icon name="refresh" />{t('common.retry')}</button>}
    </div>
  );
}

export const Spinner = () => <div className="spin-wrap"><div className="spin" /></div>;

export function SkeletonList({ rows = 7, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="sec" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel-row" key={i}>
          {avatar && <div className="skel" style={{ width: 46, height: 46, borderRadius: '50%', flexShrink: 0 }} />}
          <div style={{ flex: 1 }}>
            <div className="skel skel-line" style={{ width: `${40 + (i * 13) % 35}%` }} />
            <div className="skel skel-line" style={{ width: `${62 + (i * 7) % 30}%`, marginTop: 9 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonBubbles() {
  const rows = [62, 40, 75, 30, 55, 68, 45];
  return (
    <div className="thread" aria-busy="true">
      {rows.map((w, i) => (
        <div key={i} className="skel" style={{ width: `${w}%`, height: i % 3 === 2 ? 58 : 38, borderRadius: 17, marginTop: 8, alignSelf: i % 3 === 1 ? 'flex-end' : 'flex-start' }} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ n = 12 }: { n?: number }) {
  return (
    <div className="gallery" aria-busy="true">
      {Array.from({ length: n }).map((_, i) => <div key={i} className="skel" style={{ aspectRatio: '1', borderRadius: 0 }} />)}
    </div>
  );
}

export function useDepsVersion(deps: readonly unknown[]): number {
  const ref = useRef<{ deps: readonly unknown[]; v: number }>({ deps, v: 0 });
  const prev = ref.current.deps;
  if (deps.length !== prev.length || deps.some((d, i) => !Object.is(d, prev[i]))) ref.current = { deps, v: ref.current.v + 1 };
  return ref.current.v;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const gen = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (soft = false) => {
    const my = ++gen.current;
    if (!soft) setLoading(true);
    setError(null);
    try {
      const d = await fnRef.current();
      if (my === gen.current) setData(d);
    } catch (e) {
      if (my === gen.current) setError((e as Error).message);
    } finally {
      if (my === gen.current) setLoading(false);
    }
  }, []);

  const version = useDepsVersion(deps);
  useEffect(() => { run(); }, [run, version]);
  return { data, setData, error, loading, reload: run };
}

interface Page<T> { items: T[]; next: Cursor | null; total?: number | null }

/** Смена deps сбрасывает список; ответ запроса, начатого до сброса, игнорируется. */
export function useInfinite<T>(loader: (cursor: Cursor | null) => Promise<Page<T>>, deps: unknown[], opts: { cacheKey?: string } = {}) {
  const [items, setItems] = useState<T[]>([]);
  const [stale, setStale] = useState(false);
  const cacheKeyRef = useRef(opts.cacheKey);
  cacheKeyRef.current = opts.cacheKey;
  const [next, setNext] = useState<Cursor | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  const busy = useRef(false);
  const nextRef = useRef<Cursor | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const fetchPage = useCallback(async (reset: boolean) => {
    if (!reset && (busy.current || !nextRef.current)) return;
    const my = reset ? ++gen.current : gen.current;
    busy.current = true;
    setError(null);
    const key = cacheKeyRef.current;
    const cached = reset && key ? readCache<Page<T>>(key) : null;
    if (cached) {
      setItems(cached.items); setTotal(cached.total ?? null); setStale(true); setLoading(false);
    } else if (reset) setLoading(true); else setMore(true);
    try {
      const page = await loaderRef.current(reset ? null : nextRef.current);
      if (my !== gen.current) return;
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      nextRef.current = page.next;
      setNext(page.next);
      if (reset) {
        setTotal(page.total ?? null);
        setStale(false);
        if (key) writeCache(key, { items: page.items, next: page.next, total: page.total ?? null });
      }
    } catch (e) {
      if (my === gen.current) setError((e as Error).message || t('ui.error.generic'));
    } finally {
      if (my === gen.current) { busy.current = false; setLoading(false); setMore(false); }
    }
  }, []);

  const version = useDepsVersion(deps);
  useEffect(() => {
    nextRef.current = null;
    setItems([]); setNext(null);
    fetchPage(true);
  }, [fetchPage, version]);

  const refresh = useCallback(async (key: (t: T) => string | number) => {
    if (busy.current) return;
    const my = gen.current;
    try {
      const page = await loaderRef.current(null);
      if (my !== gen.current) return;
      const fresh = new Set(page.items.map(key));
      setItems((prev) => [...page.items, ...prev.filter((x) => !fresh.has(key(x)))]);
      if (page.total != null) setTotal(page.total);
    } catch { /* обновим в следующий раз */ }
  }, []);

  const loadMore = useCallback(() => fetchPage(false), [fetchPage]);
  const sentinel = useSentinel(loadMore, !!next && !loading && !more && !error);
  return { items, setItems, total, loading, more, error, next, stale, sentinel, reload: () => fetchPage(true), loadMore, refresh };
}

export function useOnReturn(active: boolean, fn: () => void) {
  const was = useRef(active);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (active && !was.current) ref.current();
    was.current = active;
  }, [active]);
}

export function useSentinel(cb: () => void, active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) cb(); }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cb, active]);
  return <div ref={ref} style={{ height: 1 }} />;
}

export function useInView(ref: RefObject<Element | null>, margin = '300px'): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, margin]);
  return seen;
}

export function ListTail({ more, error, onRetry }: { more: boolean; error: string | null; onRetry: () => void }) {
  if (error) return <div className="spin-wrap"><button className="btn plain small" onClick={onRetry}><Icon name="refresh" />{t('ui.listTail.retry')}</button></div>;
  if (more) return <Spinner />;
  return null;
}
