import { useState, type ReactNode } from 'react';
import { call } from '../api';
import { useNav, useLayerActive } from '../nav';
import type { StatsView, InsightsView } from '../types';
import { Icon, mediaColor, mediaIconName, type IconName } from '../components/Icon';
import { Header, Segmented, SectionHeader, SectionFooter, Avatar, ErrorState, Empty, Spinner, useAsync, useOnReturn } from '../components/ui';
import { ActivityChart } from '../components/ActivityChart';
import { Heatmap, BarList, SplitBar, WordCloud } from '../components/Charts';
import { ChatPickerSheet, RangeSheet } from '../components/Sheets';
import { usePersistent } from '../storage';
import { t, type Key } from '../i18n';
import { count, dayKey, fmtDateTime, fmtLongDate, fmtNum, fmtShortDate, fmtSize, fmtSpan, plural, W } from '../util';

type Preset = 7 | 30 | 90 | 365;
const PRESETS: { value: Preset; label: Key }[] = [
  { value: 7, label: 'stats.range.days7' }, { value: 30, label: 'stats.range.days30' }, { value: 90, label: 'stats.range.days90' }, { value: 365, label: 'stats.range.year' },
];
const TYPE_NAME: Record<string, Key> = {
  text: 'stats.type.text', photo: 'stats.type.photo', video: 'stats.type.video', voice: 'stats.type.voice', audio: 'stats.type.audio',
  sticker: 'stats.type.sticker', document: 'stats.type.document', other: 'stats.type.other',
};
/** Подписи корзин «как быстро удаляют» приходят с сервера по-русски — сопоставляем с ключами словаря. */
const TTD_LABEL: Record<string, Key> = {
  'до 10 секунд': 'stats.ttd.b10s', 'до минуты': 'stats.ttd.b1m', 'до 10 минут': 'stats.ttd.b10m', 'до часа': 'stats.ttd.b1h',
  'до суток': 'stats.ttd.b1d', 'до недели': 'stats.ttd.b1w', 'дольше недели': 'stats.ttd.bMore',
};
const ttdLabel = (l: string) => (TTD_LABEL[l] ? t(TTD_LABEL[l]) : l);
const TYPE_ICON: Record<string, string | null> = { text: null, photo: 'photo', video: 'video', voice: 'voice', audio: 'audio', sticker: 'sticker', document: 'document', other: 'contact' };

function delta(cur: number, prev: number): string {
  if (!prev) return cur ? t('stats.delta.new') : t('stats.delta.none');
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d === 0) return t('stats.delta.same');
  return `${d > 0 ? '↑' : '↓'} ${Math.abs(d)}%`;
}

export function Stats({ chatId, chatName }: { chatId?: number; chatName?: string | null }) {
  const nav = useNav();
  const active = useLayerActive();
  const [preset, setPreset] = usePersistent<Preset>('stats.preset', 30, (v): v is Preset => PRESETS.some((p) => p.value === v));
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [chat, setChat] = useState<{ chatId: number; chatName: string | null } | null>(chatId != null ? { chatId, chatName: chatName ?? null } : null);
  const [sheet, setSheet] = useState<null | 'chat' | 'range'>(null);
  const [heat, setHeat] = useState<'deleted' | 'edited'>('deleted');

  const query = { ...(range ?? { days: preset }), ...(chat ? { chatId: chat.chatId } : {}) };
  const key = JSON.stringify(query);
  const st = useAsync(() => call<StatsView>('stats', query), [key]);
  const ins = useAsync(() => call<InsightsView>('insights', query), [key]);

  useOnReturn(active, () => { st.reload(true); ins.reload(true); });

  const periodLabel = range ? `${fmtShortDate(range.from)} — ${fmtShortDate(range.to)}` : t(PRESETS.find((p) => p.value === preset)!.label);
  const pickPeriod = async () => {
    const v = await nav.choose<Preset | 'custom'>({
      title: t('stats.period.title'),
      selected: range ? 'custom' : preset,
      options: [...PRESETS.map((p) => ({ value: p.value as Preset | 'custom', label: t(p.label) })), { value: 'custom', label: t('stats.period.custom'), icon: 'calendar' }],
    });
    if (v === 'custom') setSheet('range');
    else if (v != null) { setRange(null); setPreset(v); }
  };
  const openChat = (id: number, name: string | null) => nav.push({ name: 'chat', chatId: id, chatName: name });
  const isTab = chatId == null;

  const header = isTab
    ? <Header large title={t('stats.title')} sub={st.data ? t('stats.tabSub', { chats: count(st.data.totals.chats, W.chat), msgs: count(st.data.totals.total, W.msg) }) : undefined} />
    : <Header title={t('stats.title')} sub={chat?.chatName ?? undefined} avatar={chat ? { id: chat.chatId, name: chat.chatName } : undefined} />;

  const filters = (
    <div className="chips">
      {isTab && (
        <button className={`chip${chat ? ' outline' : ''}`} onClick={() => setSheet('chat')}>
          <Icon name={chat ? 'user' : 'users'} /><span className="ellipsis" style={{ maxWidth: 150 }}>{chat?.chatName ?? t('stats.allChats')}</span><Icon name="chevronDown" />
        </button>
      )}
      <button className={`chip${range ? ' outline' : ''}`} onClick={pickPeriod}><Icon name="calendar" />{periodLabel}<Icon name="chevronDown" /></button>
      {(st.loading || ins.loading) && st.data && <span className="spin" style={{ width: 16, height: 16, borderWidth: 2, alignSelf: 'center' }} />}
    </div>
  );
  const sheets = (
    <>
      <ChatPickerSheet open={sheet === 'chat'} onClose={() => setSheet(null)} value={chat?.chatId ?? null} onPick={(c) => { setChat(c); setSheet(null); }} />
      <RangeSheet open={sheet === 'range'} onClose={() => setSheet(null)} value={range} onPick={(r) => { setRange(r); setSheet(null); }} />
    </>
  );

  const s = st.data;
  if (!s) {
    return <>{header}{filters}{st.error ? <ErrorState text={st.error} onRetry={() => st.reload()} /> : <Spinner />}{sheets}</>;
  }
  if (s.totals.total === 0) {
    return <>{header}{filters}<Empty icon="chart" title={t('stats.empty.title')} text={t('stats.empty.text')} />{sheets}</>;
  }
  const d = s.days;
  const i = ins.data;

  return (
    <>
      {header}
      {filters}

      <div className="kpis">
        <Kpi icon="trash" color="var(--red)" n={s.period.deleted} label={t('stats.kpi.deleted')} note={delta(s.period.deleted, s.prev.deleted)}
          onClick={chat ? () => openChat(chat.chatId, chat.chatName) : () => nav.setTab('feed', { feedKind: 'deleted' })} />
        <Kpi icon="pencil" color="var(--orange)" n={s.period.edited} label={t('stats.kpi.edits')} note={delta(s.period.edited, s.prev.edited)}
          onClick={chat ? () => openChat(chat.chatId, chat.chatName) : () => nav.setTab('feed', { feedKind: 'edited' })} />
        <Kpi icon="chat" color="var(--blue)" n={s.period.captured} label={t('stats.kpi.messages')} note={delta(s.period.captured, s.prev.captured)}
          onClick={chat ? () => openChat(chat.chatId, chat.chatName) : () => nav.setTab('chats')} />
        <Kpi icon="starFill" color="var(--gold)" n={s.totals.favorite} label={t('stats.kpi.favorites')} note={t('stats.kpi.allTime')}
          onClick={() => nav.setTab('feed', { feedKind: 'favorite' })} />
      </div>
      <SectionFooter>{t('stats.compareFooter', { prev: d === 1 ? t('stats.prevOneDay') : `${fmtNum(d)} ${plural(d, W.daysInstr)}`, total: count(s.totals.total, W.msg), deleted: fmtNum(s.totals.deleted) })}</SectionFooter>

      <SectionHeader>{t('stats.activity')}</SectionHeader>
      <div className="sec"><ActivityChart data={s.activity} prev={s.prevActivity} /></div>

      {!i ? (ins.error ? <ErrorState text={ins.error} onRetry={() => ins.reload()} /> : <InsightsSkeleton />) : <>
        {i.night.total > 0 && <>
          <SectionHeader>{t('stats.when.title')}</SectionHeader>
          <div className="sec card-pad">
            <Segmented items={[{ id: 'deleted', label: t('stats.when.deletions') }, { id: 'edited', label: t('stats.when.edits') }]} value={heat} onChange={setHeat} />
            <Heatmap grid={i.heatmap[heat]} color={heat === 'deleted' ? 'var(--red)' : 'var(--orange)'}
              unit={t(heat === 'deleted' ? 'stats.w.deletion' : 'stats.w.edit')} />
          </div>
          <SectionFooter>
            {t(i.night.share >= 0.3 ? 'stats.night.high' : 'stats.night.normal', { pct: Math.round(i.night.share * 100) })}
          </SectionFooter>
        </>}

        {i.ttd.total > 0 && <>
          <SectionHeader>{t('stats.ttd.title')}</SectionHeader>
          <div className="sec card-pad">
            <div className="big-num"><b className="tnum">{fmtSpan(i.ttd.median)}</b><span>{t('stats.ttd.median')}</span></div>
            <BarList color="var(--red)" items={i.ttd.buckets.map((b) => ({ key: b.label, label: ttdLabel(b.label), value: b.count }))} />
          </div>
          <SectionFooter>{t('stats.ttd.footer')}</SectionFooter>
        </>}

        {i.wipes.length > 0 && <>
          <SectionHeader>{t('stats.wipes.title')}</SectionHeader>
          <div className="sec">
            {i.wipes.slice(0, 8).map((w) => (
              <button key={`${w.chatId}:${w.at}`} className="cell tap av" onClick={() => nav.push({ name: 'chat', chatId: w.chatId, chatName: w.chatName, jumpTo: dayKey(w.at), focusId: w.firstId })}>
                <Avatar id={w.chatId} name={w.chatName} size={40} />
                <div className="grow"><div className="t ellipsis">{w.chatName ?? t('stats.chatN', { id: w.chatId })}</div><div className="s">{fmtDateTime(w.at)}</div></div>
                <span className="count">{w.count}</span>
                <Icon name="chevronRight" className="chev" />
              </button>
            ))}
          </div>
          <SectionFooter>{t('stats.wipes.footer')}</SectionFooter>
        </>}

        {!chat && s.topChats.length > 0 && <>
          <SectionHeader>{t('stats.topChats.title')}</SectionHeader>
          <div className="sec">
            {s.topChats.slice(0, 6).map((c) => (
              <PersonRow key={c.chatId} id={c.chatId} name={c.chatName} value={fmtNum(c.deleted)} share={c.deleted / Math.max(1, s.topChats[0].deleted)} color="var(--red)" onClick={() => openChat(c.chatId, c.chatName)} />
            ))}
          </div>
        </>}

        {!chat && i.regret.length > 0 && <>
          <SectionHeader>{t('stats.regret.title')}</SectionHeader>
          <div className="sec">
            {i.regret.map((c) => (
              <PersonRow key={c.chatId} id={c.chatId} name={c.chatName} value={`${Math.round(c.share * 100)}%`} sub={t('stats.regret.sub', { deleted: fmtNum(c.deleted), total: count(c.incoming, W.msg) })}
                share={c.share} color="var(--red)" onClick={() => openChat(c.chatId, c.chatName)} />
            ))}
          </div>
          <SectionFooter>{t('stats.regret.footer')}</SectionFooter>
        </>}

        {(i.editors.length > 0 || i.rewritten.length > 0) && <>
          <SectionHeader>{t(chat ? 'stats.editors.titleChat' : 'stats.editors.title')}</SectionHeader>
          {!chat && i.editors.length > 0 && (
            <div className="sec">
              {i.editors.slice(0, 6).map((c) => (
                <PersonRow key={c.chatId} id={c.chatId} name={c.chatName} value={fmtNum(c.edits)} sub={t('stats.editors.sub', { msgs: count(c.messages, W.msg) })}
                  share={c.edits / Math.max(1, i.editors[0].edits)} color="var(--orange)" onClick={() => openChat(c.chatId, c.chatName)} />
              ))}
            </div>
          )}
          {i.rewritten.length > 0 && <>
            <div className="sub-h">{t('stats.editors.rewritten')}</div>
            <div className="sec">
              {i.rewritten.map((m) => (
                <button key={m.id} className="cell tap" onClick={() => nav.push({ name: 'event', id: m.id })}>
                  <div className="grow">
                    <div className="t clamp2">{m.text ?? t('stats.noText')}</div>
                    <div className="s">{m.chatName ?? t('stats.chatN', { id: m.chatId })}</div>
                  </div>
                  <span className="tag edit"><Icon name="pencil" />×{m.editCount}</span>
                </button>
              ))}
            </div>
          </>}
        </>}

        {i.balance.chats.length > 0 && <>
          <SectionHeader>{t('stats.balance.title')}</SectionHeader>
          <div className="sec card-pad">
            <div className="reply-sum">
              <div><b className="tnum">{fmtSpan(i.balance.theirReply)}</b><span>{t('stats.balance.theirs')}</span></div>
              <div><b className="tnum">{fmtSpan(i.balance.myReply)}</b><span>{t('stats.balance.mine')}</span></div>
            </div>
            <div className="legend-row"><span><i className="sw" style={{ background: 'var(--blue)' }} />{t('stats.balance.contact')}</span><span><i className="sw" style={{ background: 'var(--aqua)' }} />{t('stats.balance.you')}</span></div>
          </div>
          <div className="sec" style={{ marginTop: 10 }}>
            {i.balance.chats.slice(0, chat ? 1 : 6).map((c) => (
              <button key={c.chatId} className="cell tap av" onClick={() => openChat(c.chatId, c.chatName)}>
                <Avatar id={c.chatId} name={c.chatName} size={40} />
                <div className="grow">
                  <div className="bal-top"><span className="t ellipsis">{c.chatName ?? t('stats.chatN', { id: c.chatId })}</span><span className="s tnum">{fmtNum(c.incoming)} · {fmtNum(c.outgoing)}</span></div>
                  <SplitBar a={c.incoming} b={c.outgoing} />
                  <div className="s">{t('stats.balance.reply', { their: fmtSpan(c.theirReply), mine: fmtSpan(c.myReply) })}</div>
                </div>
              </button>
            ))}
          </div>
          <SectionFooter>{t('stats.balance.footer')}</SectionFooter>
        </>}

        {i.deletedByType.some((x) => x.deleted > 0) && <>
          <SectionHeader>{t('stats.byType.title')}</SectionHeader>
          <div className="sec">
            {i.deletedByType.filter((x) => x.total > 0).map((x) => {
              const share = x.deleted / x.total;
              const mt = TYPE_ICON[x.type];
              return (
                <div key={x.type} className="cell ic">
                  <span className="tile" style={{ ['--c' as string]: mt ? mediaColor(mt) : '#8e8e93' }}><Icon name={mt ? mediaIconName(mt) : 'chat'} /></span>
                  <div className="grow">
                    <div className="bal-top"><span className="t">{TYPE_NAME[x.type] ? t(TYPE_NAME[x.type]) : x.type}</span><span className="s tnum">{t('stats.byType.row', { pct: Math.round(share * 100), deleted: fmtNum(x.deleted), total: fmtNum(x.total) })}</span></div>
                    <div className="meter"><i style={{ width: `${share * 100}%`, ['--c' as string]: 'var(--red)' }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
          <SectionFooter>{t('stats.byType.footer')}</SectionFooter>
        </>}

        {i.words.length > 0 && <>
          <SectionHeader>{t('stats.words.title')}</SectionHeader>
          <div className="sec card-pad"><WordCloud words={i.words} onPick={(w) => nav.push({ name: 'search', q: w })} /></div>
          <SectionFooter>{t('stats.words.footer')}</SectionFooter>
        </>}

        <Records r={i.records} onEvent={(id) => nav.push({ name: 'event', id })} onChat={openChat} />

        {(i.media.files > 0 || i.media.savedMedia > 0) && <>
          <SectionHeader>{t('stats.media.title')}</SectionHeader>
          <div className="kpis">
            <Fact icon="mic" color={mediaColor('voice')} value={fmtSpan(i.media.voiceSec * 1000)} label={t('stats.media.voice')} />
            <Fact icon="video" color={mediaColor('video')} value={fmtSpan(i.media.videoSec * 1000)} label={t('stats.media.video')} />
            <Fact icon="file" color={mediaColor('document')} value={fmtSize(i.media.bytes)} label={t('stats.media.inFiles', { files: `${fmtNum(i.media.files)} ${plural(i.media.files, W.filesPrep)}` })} />
            <Fact icon="shield" color="var(--green)" value={fmtNum(i.media.savedMedia)} label={i.media.mirrored ? t('stats.media.savedMirrored', { mirrored: fmtNum(i.media.mirrored) }) : t('stats.media.saved')} />
          </div>
        </>}

        {i.truncated && <SectionFooter>{t('stats.truncated')}</SectionFooter>}
      </>}
      {sheets}
    </>
  );
}

function Kpi({ icon, color, n, label, note, onClick }: { icon: IconName; color: string; n: number; label: string; note: string; onClick: () => void }) {
  return (
    <button className="kpi" onClick={onClick}>
      <span className="k-top">
        <span className="tile" style={{ ['--c' as string]: color }}><Icon name={icon} /></span>
        <span className="k-d">{note}</span>
      </span>
      <span className="k-n tnum">{fmtNum(n)}</span>
      <span className="k-l">{label}</span>
    </button>
  );
}

const Fact = ({ icon, color, value, label }: { icon: IconName; color: string; value: ReactNode; label: string }) => (
  <div className="kpi static">
    <span className="tile" style={{ ['--c' as string]: color }}><Icon name={icon} /></span>
    <span className="k-n tnum" style={{ fontSize: 22 }}>{value}</span>
    <span className="k-l">{label}</span>
  </div>
);

function PersonRow({ id, name, value, sub, share, color, onClick }: { id: number; name: string | null; value: string; sub?: string; share: number; color: string; onClick: () => void }) {
  return (
    <button className="cell tap av" onClick={onClick}>
      <Avatar id={id} name={name} size={40} />
      <div className="grow">
        <div className="bal-top"><span className="t ellipsis">{name ?? t('stats.chatN', { id })}</span><span className="v tnum">{value}</span></div>
        <div className="meter"><i style={{ width: `${Math.max(2, share * 100)}%`, ['--c' as string]: color }} /></div>
        {sub && <div className="s">{sub}</div>}
      </div>
    </button>
  );
}

function Records({ r, onEvent, onChat }: { r: InsightsView['records']; onEvent: (id: number) => void; onChat: (id: number, name: string | null) => void }) {
  const cards = [
    r.busiestDay && { key: 'day', icon: 'chart' as IconName, color: 'var(--blue)', value: count(r.busiestDay.count, W.msg), label: t('stats.records.busiestDay', { date: fmtLongDate(r.busiestDay.date).toLowerCase() }) },
    r.longestStreak && { key: 'streak', icon: 'flame' as IconName, color: 'var(--fire)', value: t('stats.records.streakValue', { days: count(r.longestStreak.days, W.day) }), label: t('stats.records.streak', { name: r.longestStreak.chatName ?? t('stats.contactFallback') }), onClick: () => onChat(r.longestStreak!.chatId, r.longestStreak!.chatName) },
    r.biggestBurst && { key: 'burst', icon: 'trash' as IconName, color: 'var(--red)', value: count(r.biggestBurst.count, W.msg), label: t('stats.records.burst', { name: r.biggestBurst.chatName ?? t('stats.contactFallback') }), onClick: () => onEvent(r.biggestBurst!.firstId) },
    r.longestDeleted && { key: 'long', icon: 'file' as IconName, color: '#5856d6', value: `${fmtNum(r.longestDeleted.length)} ${plural(r.longestDeleted.length, W.char)}`, label: t('stats.records.longest', { name: r.longestDeleted.chatName ?? t('stats.contactFallback') }), onClick: () => onEvent(r.longestDeleted!.id) },
  ].filter(Boolean) as { key: string; icon: IconName; color: string; value: string; label: string; onClick?: () => void }[];
  if (!cards.length) return null;
  return (
    <>
      <SectionHeader>{t('stats.records.title')}</SectionHeader>
      <div className="kpis">
        {cards.map((c) => (
          <button key={c.key} className={`kpi${c.onClick ? '' : ' static'}`} onClick={c.onClick} disabled={!c.onClick}>
            <span className="tile" style={{ ['--c' as string]: c.color }}><Icon name={c.icon} /></span>
            <span className="k-n tnum" style={{ fontSize: 20 }}>{c.value}</span>
            <span className="k-l">{c.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function InsightsSkeleton() {
  return (
    <div aria-busy="true" style={{ padding: '22px 16px 0' }}>
      {[180, 140, 220].map((h, i) => <div key={i} className="skel" style={{ height: h, borderRadius: 12, marginBottom: 16 }} />)}
    </div>
  );
}
