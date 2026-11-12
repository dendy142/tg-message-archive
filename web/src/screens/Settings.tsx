import { useState } from 'react';
import { call, ApiError } from '../api';
import { useNav } from '../nav';
import { emit } from '../bus';
import { confirm, haptic, openTgLink } from '../telegram';
import type { SettingsView } from '../types';
import { Header, Cell, ToggleCell, SectionHeader, SectionFooter } from '../components/ui';
import { Icon } from '../components/Icon';
import { TimezoneSheet, ExportSheet } from '../components/Sheets';
import { NotifyTypesSheet, QuietHoursSheet, KeywordsSheet, MirrorSheet, ExcludedSheet, PinSheet, OperatorSheet, NOTIFY_ITEMS, MIRROR_ITEMS } from '../components/SettingsSheets';
import { useArchiveLink, reasonText } from '../archive';
import { PlanSection } from '../components/PlanSection';
import { setTimezone, tzCity, tzOffsetLabel, count, deviceTimezone, W } from '../util';
import { isSnoozed, snooze } from '../storage';
import { clearCache } from '../cache';
import { t, type Key } from '../i18n';

type Ret = 'forever' | '365' | '90' | '30';
const RET: { value: Ret; label: Key; days: number | null }[] = [
  { value: 'forever', label: 'settings.ret.forever', days: null },
  { value: '365', label: 'settings.ret.y1', days: 365 },
  { value: '90', label: 'settings.ret.d90', days: 90 },
  { value: '30', label: 'settings.ret.d30', days: 30 },
];
const READ: { value: SettingsView['readMode']; label: Key; hint: Key }[] = [
  { value: 'off', label: 'settings.read.off', hint: 'settings.read.offHint' },
  { value: 'all', label: 'settings.read.all', hint: 'settings.read.allHint' },
  { value: 'chats', label: 'settings.read.chats', hint: 'settings.read.chatsHint' },
];
const retOf = (d: number | null): Ret => (d == null ? 'forever' : (String(d) as Ret));
const AUTO_LOCK: { value: string; min: number | null; label: Key }[] = [
  { value: 'start', min: null, label: 'settings.autoLock.start' },
  { value: '0', min: 0, label: 'settings.autoLock.now' },
  { value: '1', min: 1, label: 'settings.autoLock.m1' },
  { value: '5', min: 5, label: 'settings.autoLock.m5' },
  { value: '15', min: 15, label: 'settings.autoLock.m15' },
  { value: '60', min: 60, label: 'settings.autoLock.h1' },
];
const LANGS = ['ru', 'en'] as const;
type SheetId = 'keywords' | 'tz' | 'export' | 'types' | 'quiet' | 'mirror' | 'excluded' | 'operator';

export function Settings() {
  const nav = useNav();
  const [s, setS] = useState<SettingsView>(nav.boot.settings);
  const [sheet, setSheet] = useState<null | SheetId>(null);
  const link = useArchiveLink();
  const archive = nav.boot.archive;
  const conn = nav.boot.connection;

  const save = async (patch: Partial<SettingsView> & Record<string, unknown>): Promise<boolean> => {
    const prev = s;
    setS({ ...s, ...patch });
    haptic('select');
    try {
      const r = await call<{ settings: SettingsView }>('settings', patch);
      setS(r.settings);
      setTimezone(r.settings.timezone);
      nav.reloadBoot().catch(() => {});
      return true;
    } catch (e) {
      setS(prev);
      haptic('error');
      nav.toast((e as ApiError).message, 'err');
      return false;
    }
  };

  const pickRetention = async () => {
    const v = await nav.choose({
      title: t('settings.ret.title'),
      message: t('settings.ret.message'),
      selected: retOf(s.retentionDays),
      options: RET.map((r) => ({ value: r.value, label: t(r.label) })),
    });
    if (!v) return;
    const next = RET.find((r) => r.value === v)!.days;
    if (next === s.retentionDays) return;
    const shorter = next != null && (s.retentionDays == null || next < s.retentionDays);
    if (shorter && !(await confirm(t('settings.ret.confirm', { n: next })))) return;
    if (await save({ retentionDays: next })) nav.toast(next == null ? t('settings.ret.toastForever') : t('settings.ret.toastSet', { label: t(RET.find((r) => r.days === next)!.label) }), 'ok');
  };

  const pickLang = async () => {
    const v = await nav.choose<'ru' | 'en'>({
      title: t('common.language'),
      message: t('settings.lang.message'),
      selected: s.lang,
      options: LANGS.map((l) => ({ value: l, label: t(`settings.lang.${l}`) })),
    });
    if (!v || v === s.lang) return;
    try {
      await call('settings', { lang: v });
      location.reload();
    } catch (e) {
      haptic('error');
      nav.toast((e as ApiError).message, 'err');
    }
  };

  const pickRead = async () => {
    const v = await nav.choose({
      title: t('settings.read.title'),
      message: t('settings.read.message'),
      selected: s.readMode,
      options: READ.map((r) => ({ value: r.value, label: t(r.label), hint: t(r.hint) })),
    });
    if (v && v !== s.readMode) await save({ readMode: v });
  };

  const archiveMenu = async () => {
    const v = await nav.choose({
      title: archive.title ?? t('settings.archive.groupDefault'),
      options: [
        ...(archive.linked && archive.chatId ? [{ value: 'open', label: t('settings.archive.open'), icon: 'external' as const }] : []),
        { value: 'change', label: archive.linked ? t('settings.archive.change') : t('settings.archive.choose'), icon: 'refresh' as const },
      ],
    });
    if (v === 'open' && archive.chatId) openTgLink(`https://t.me/c/${String(archive.chatId).replace(/^-100/, '')}`);
    if (v === 'change') await link.start();
  };

  const [pinSheet, setPinSheet] = useState<null | { purpose: 'set' | 'clear'; clearTo?: 'off' | 'biometric' }>(null);
  const pickLock = async () => {
    const v = await nav.choose<'off' | 'biometric' | 'pin'>({
      title: t('settings.lock.title'),
      message: t('settings.lock.message'),
      selected: s.lockMode,
      options: [
        { value: 'off', label: t('settings.lock.off') },
        { value: 'biometric', label: t('settings.lock.biometric'), hint: t('settings.lock.biometricHint') },
        { value: 'pin', label: t('settings.lock.pin'), hint: t('settings.lock.pinHint') },
      ],
    });
    if (!v || v === s.lockMode) return;
    if (v === 'pin') { setPinSheet({ purpose: 'set' }); return; }
    if (s.lockMode === 'pin') { setPinSheet({ purpose: 'clear', clearTo: v }); return; }
    await save({ lockMode: v } as Partial<SettingsView>);
  };

  const pickAutoLock = async () => {
    const v = await nav.choose({
      title: t('settings.autoLock.title'),
      message: t('settings.autoLock.message'),
      selected: AUTO_LOCK.find((a) => a.min === s.autoLockMin)?.value ?? 'start',
      options: AUTO_LOCK.map((a) => ({ value: a.value, label: t(a.label) })),
    });
    if (v) await save({ autoLockMin: AUTO_LOCK.find((a) => a.value === v)!.min });
  };

  const pickPurge = async () => {
    const opts: { value: string; days: number | null; label: string }[] = [
      { value: 'never', days: null, label: t('settings.purge.never') }, { value: '7', days: 7, label: t('settings.purge.d7') },
      { value: '30', days: 30, label: t('settings.purge.d30') }, { value: '90', days: 90, label: t('settings.purge.d90') },
    ];
    const v = await nav.choose({
      title: t('settings.purge.title'),
      message: t('settings.purge.message'),
      selected: opts.find((o) => o.days === s.purgeAfterDisconnectDays)?.value ?? 'never',
      options: opts.map((o) => ({ value: o.value, label: o.label })),
    });
    if (v) await save({ purgeAfterDisconnectDays: opts.find((o) => o.value === v)!.days });
  };

  const wipeAll = async () => {
    const v = await nav.choose({
      title: t('settings.wipe.title'),
      message: t('settings.wipe.message'),
      options: [
        { value: 'export', label: t('settings.wipe.exportFirst'), icon: 'share' },
        { value: 'wipe', label: t('settings.wipe.noExport'), icon: 'trash', tone: 'danger' },
      ],
    });
    if (v === 'export') { setSheet('export'); return; }
    if (v !== 'wipe' || !(await confirm(t('settings.wipe.confirm')))) return;
    try {
      const r = await call<{ removed: number }>('action', { type: 'wipeAll', confirm: 'DELETE_ALL' });
      haptic('warning');
      emit({ type: 'wiped' });
      clearCache();
      nav.toast(t('settings.wipe.done', { count: count(r.removed, W.msg) }), 'ok');
      nav.reloadBoot().catch(() => {});
    } catch (e) { nav.toast((e as ApiError).message, 'err'); }
  };

  const failedMirror = nav.boot.counts.failedMirror ?? 0;
  const retryMirror = async () => {
    try {
      const r = await call<{ queued: number }>('action', { type: 'retryMirror' });
      haptic('success');
      nav.toast(r.queued ? t('settings.mirror.requeued', { count: count(r.queued, W.file) }) : t('settings.mirror.gone'), r.queued ? 'ok' : undefined);
      nav.reloadBoot().catch(() => {});
    } catch (e) { nav.toast((e as ApiError).message, 'err'); }
  };

  const jobs = nav.boot.jobs ?? [];
  const cancelJob = async (id: number) => {
    if (!(await confirm(t('settings.job.stopConfirm')))) return;
    try {
      await call('action', { type: 'cancelJob', id });
      nav.toast(t('settings.job.stopped'), 'ok');
      nav.reloadBoot().catch(() => {});
    } catch (e) { nav.toast((e as ApiError).message, 'err'); }
  };

  const typesOn = NOTIFY_ITEMS.filter((n) => s.notifyTypes[n.id]).length;
  const mirrorOn = MIRROR_ITEMS.filter((m) => s.mirrorTypes.includes(m.id));
  const excluded = nav.boot.counts.excludedChats ?? 0;
  const ret = RET.find((r) => r.days === s.retentionDays) ?? RET[0];
  const archiveOk = archive.linked && archive.status === 'active';

  return (
    <>
      <Header large title={t('settings.title')} />
      <TimezoneHint s={s} onSwitch={(tz) => save({ timezone: tz, tzSource: 'auto' })} />

      <SectionHeader>{t('settings.conn.header')}</SectionHeader>
      <div className="sec">
        <Cell icon="bot" color={conn.connected ? 'var(--green)' : 'var(--red)'} title={conn.connected ? t('settings.conn.on') : t('settings.conn.off')}
          sub={conn.connected ? (conn.canReply ? t('settings.conn.canReply') : t('settings.conn.noReply')) : t('settings.conn.notSaving')} />
        <Cell icon="archive" color={archiveOk ? '#5856d6' : 'var(--red)'} title={t('settings.conn.archiveGroup')}
          sub={link.busy ? t('settings.conn.waiting') : link.status ?? (!archive.linked ? t('settings.conn.notChosen') : archiveOk ? archive.title ?? t('settings.conn.linked') : reasonText(archive.lostReason))}
          onClick={link.busy ? undefined : archiveMenu} chevron={!link.busy} />
        {nav.boot.counts.pendingMirror > 0 && (
          <Cell icon="clock" color="#8e8e93" title={t('settings.conn.queue')} value={count(nav.boot.counts.pendingMirror, W.file)} />
        )}
        {failedMirror > 0 && (
          <Cell icon="alert" color="var(--red)" title={t('settings.conn.failed')} sub={t('settings.conn.failedHint')}
            value={count(failedMirror, W.file)} onClick={retryMirror} chevron />
        )}
        {jobs.map((j) => (
          <Cell key={j.id} icon="download" color="#34c759" title={t('settings.job.title')} sub={t('settings.job.hint')}
            value={t('settings.job.progress', { done: j.done, total: j.total })} onClick={() => cancelJob(j.id)} />
        ))}
      </div>
      {nav.boot.counts.pendingMirror > 0 && <SectionFooter>{t('settings.conn.queueFooter')}</SectionFooter>}

      <PlanSection />

      <SectionHeader>{t('settings.notify.header')}</SectionHeader>
      <div className="sec">
        <ToggleCell icon="bell" color="#ff3b30" title={t('settings.notify.enabled')} on={s.notificationsEnabled} onChange={(v) => save({ notificationsEnabled: v })} />
        <Cell icon="inbox" color="#ff2d55" title={t('settings.notify.what')} value={typesOn === NOTIFY_ITEMS.length ? t('settings.notify.all') : t('settings.notify.xOfY', { n: typesOn, total: NOTIFY_ITEMS.length })}
          onClick={() => setSheet('types')} chevron disabled={!s.notificationsEnabled} />
        <ToggleCell icon="user" color="#ff9500" title={t('settings.notify.own')}
          on={s.notifyOwn} disabled={!s.notificationsEnabled} onChange={(v) => save({ notifyOwn: v })} />
        <Cell icon="moon" color="#5856d6" title={t('settings.notify.quiet')} value={s.quietHours ? `${s.quietHours.from}–${s.quietHours.to}` : t('common.off')}
          onClick={() => setSheet('quiet')} chevron disabled={!s.notificationsEnabled} />
        <ToggleCell icon="eyeOff" color="#8e8e93" title={t('settings.notify.hide')} sub={t('settings.notify.hideHint')}
          on={s.hidePreview} disabled={!s.notificationsEnabled} onChange={(v) => save({ hidePreview: v })} />
        <Cell icon="tag" color="#34c759" title={t('settings.notify.keywords')} value={s.keywords.length ? count(s.keywords.length, W.word) : t('settings.notify.none')}
          sub={s.keywords.length ? s.keywords.slice(0, 4).join(', ') + (s.keywords.length > 4 ? '…' : '') : undefined}
          onClick={() => setSheet('keywords')} chevron />
      </div>
      <SectionFooter>{t('settings.notify.footer')}</SectionFooter>

      <SectionHeader>{t('settings.archiveSection.header')}</SectionHeader>
      <div className="sec">
        <Cell icon="globe" color="#007aff" title={t('settings.archiveSection.timezone')} value={`${tzCity(s.timezone)}, ${tzOffsetLabel(s.timezone)}`} onClick={() => setSheet('tz')} chevron />
        <Cell icon="chat" color="#ff9500" title={t('common.language')} value={t('common.languageName')} onClick={pickLang} chevron />
        <Cell icon="hourglass" color="#5ac8fa" title={t('settings.ret.title')} value={t(ret.label)} onClick={pickRetention} chevron />
        <Cell icon="archive" color="#af52de" title={t('settings.archiveSection.copies')} onClick={() => setSheet('mirror')} chevron
          value={mirrorOn.length === MIRROR_ITEMS.length ? (s.mirrorMaxMb ? t('settings.archiveSection.upTo', { n: s.mirrorMaxMb }) : t('settings.archiveSection.allFiles')) : mirrorOn.length ? t('settings.notify.xOfY', { n: mirrorOn.length, total: MIRROR_ITEMS.length }) : t('settings.archiveSection.nothing')} />
        <Cell icon="share" color="#5856d6" title={t('settings.archiveSection.export')} sub={t('settings.archiveSection.exportHint')} onClick={() => setSheet('export')} chevron />
      </div>

      <SectionHeader>{t('settings.privacy.header')}</SectionHeader>
      <div className="sec">
        <Cell icon="checks" color="#30b0c7" title={t('settings.read.title')} value={t(READ.find((r) => r.value === s.readMode)?.label ?? READ[0].label)} onClick={pickRead} chevron />
        <Cell icon="hourglass" color="#ff3b30" title={t('settings.purge.row')} value={s.purgeAfterDisconnectDays ? t('settings.purge.rowValue', { n: s.purgeAfterDisconnectDays }) : t('settings.purge.keep')}
          onClick={pickPurge} chevron />
        <Cell icon="chatOff" color="#636366" title={t('settings.privacy.excluded')} value={excluded ? count(excluded, W.chat) : t('settings.notify.none')} onClick={() => setSheet('excluded')} chevron />
        <Cell icon="lock" color="#8e8e93" title={t('settings.lock.title')} chevron onClick={pickLock}
          value={s.lockMode === 'pin' ? t('settings.lock.pin') : s.lockMode === 'biometric' ? t('settings.lock.biometricValue') : t('common.off')} />
        {s.lockMode === 'pin' && <Cell icon="fingerprint" color="#8e8e93" title={t('settings.lock.changePin')} chevron onClick={() => setPinSheet({ purpose: 'set' })} />}
        {s.lockEnabled && (
          <Cell icon="timer" color="#8e8e93" title={t('settings.autoLock.title')} value={t(AUTO_LOCK.find((a) => a.min === s.autoLockMin)?.label ?? 'settings.autoLock.start')}
            onClick={pickAutoLock} chevron />
        )}
      </div>
      <SectionFooter>
        <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Icon name="shield" className="hint" />
          <span>{t('settings.privacy.footer')}</span>
        </span>
      </SectionFooter>
      <div className="sec" style={{ marginTop: 24 }}>
        <Cell icon="trash" title={t('settings.wipe.title')} tone="danger" onClick={wipeAll} />
      </div>
      <SectionFooter>{t('settings.wipe.footer')}</SectionFooter>
      {nav.boot.operator && (
        <>
          <SectionHeader>{t('settings.operator.header')}</SectionHeader>
          <div className="sec">
            <Cell icon="shield" color="#8e8e93" title={t('settings.operator.title')} sub={t('settings.operator.hint')} onClick={() => setSheet('operator')} chevron />
          </div>
        </>
      )}
      <div className="app-foot">@{nav.boot.bot.username} · v{nav.boot.version?.version ?? __APP_VERSION__} ({nav.boot.version?.commit ?? __APP_COMMIT__})</div>

      <NotifyTypesSheet open={sheet === 'types'} onClose={() => setSheet(null)} s={s} save={save} />
      <QuietHoursSheet open={sheet === 'quiet'} onClose={() => setSheet(null)} s={s}
        save={async (p) => { const ok = await save(p); if (ok) nav.toast(p.quietHours ? t('settings.notify.quietToast', { from: p.quietHours.from, to: p.quietHours.to }) : t('settings.notify.quietOffToast'), 'ok'); return ok; }} />
      <KeywordsSheet open={sheet === 'keywords'} onClose={() => setSheet(null)} s={s}
        save={async (p) => { const ok = await save(p); if (ok) nav.toast(t('settings.notify.keywordsSaved'), 'ok'); return ok; }} />
      <MirrorSheet open={sheet === 'mirror'} onClose={() => setSheet(null)} s={s} save={save} />
      <ExcludedSheet open={sheet === 'excluded'} onClose={() => setSheet(null)} />
      <TimezoneSheet open={sheet === 'tz'} onClose={() => setSheet(null)} value={s.timezone}
        onPick={(tz, source) => { setSheet(null); if (tz !== s.timezone || source !== s.tzSource) save({ timezone: tz, tzSource: source }); }} />
      <ExportSheet open={sheet === 'export'} onClose={() => setSheet(null)} />
      {nav.boot.operator && <OperatorSheet open={sheet === 'operator'} onClose={() => setSheet(null)} />}
      <PinSheet open={!!pinSheet} onClose={() => setPinSheet(null)} hasPin={s.hasPin} purpose={pinSheet?.purpose ?? 'set'} clearTo={pinSheet?.clearTo}
        onDone={(next) => { setS(next); nav.reloadBoot().catch(() => {}); }} />
    </>
  );
}

const TZ_HINT_KEY = 'hint.tz.snoozedUntil';

function TimezoneHint({ s, onSwitch }: { s: SettingsView; onSwitch: (tz: string) => void }) {
  const [hidden, setHidden] = useState(() => isSnoozed(TZ_HINT_KEY));
  const device = deviceTimezone();
  if (hidden || !device || device === s.timezone || s.tzSource === 'auto') return null;
  return (
    <div className="pad" style={{ marginBottom: 8 }}>
      <div className="note banner">
        <Icon name="globe" />
        <div className="grow">
          <div>{t('settings.tzHint.text', { device: `${tzCity(device)}, ${tzOffsetLabel(device)}`, archive: tzCity(s.timezone) })}</div>
          <div className="banner-acts">
            <button className="link-btn" onClick={() => onSwitch(device)}>{t('settings.tzHint.switch')}</button>
            <button className="link-btn hint" onClick={() => { snooze(TZ_HINT_KEY, 30 * 86_400_000); setHidden(true); }}>{t('settings.tzHint.later')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
