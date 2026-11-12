import { useState } from 'react';
import { call, ApiError } from '../api';
import { useNav } from '../nav';
import { emit } from '../bus';
import { confirm, copyText, haptic, openTgLink, tg } from '../telegram';
import type { StatsView, InsightsView } from '../types';
import { Header, Avatar, Cell, ToggleCell, SectionHeader, SectionFooter, ErrorState, Spinner, useAsync } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { ExportSheet } from '../components/Sheets';
import { deleteChatFlow } from '../deleteChat';
import { ActivityChart } from '../components/ActivityChart';
import { Heatmap } from '../components/Charts';
import { t } from '../i18n';
import { count, fmtDateTime, fmtNum, fmtSpan, W } from '../util';

interface Resp {
  chatId: number; chatName: string | null; senderId: number | null;
  total: number; incoming: number; deleted: number; edited: number; media: number;
  firstAt: number | null; lastAt: number | null; names: string[]; muted: boolean; autoRead: boolean; excluded?: boolean;
  username?: string | null; usernames?: string[]; hasPhoto?: boolean;
}

export function Contact({ chatId }: { chatId: number }) {
  const nav = useNav();
  const { data: c, setData, error, reload } = useAsync(() => call<Resp>('contact', { chatId }), [chatId]);
  const [exportOpen, setExportOpen] = useState(false);
  const st = useAsync(() => call<StatsView>('stats', { chatId, days: 90 }), [chatId]);
  const ins = useAsync(() => call<InsightsView>('insights', { chatId, days: 90 }), [chatId]);

  if (!c) {
    return <><Header title={t('contact.title')} />{error ? <ErrorState text={error} onRetry={() => reload()} /> : <Spinner />}</>;
  }
  const name = c.chatName ?? t('contact.chatN', { id: c.chatId });
  const delShare = c.incoming ? Math.round((c.deleted / c.incoming) * 100) : 0;
  const userId = c.senderId ?? (c.chatId > 0 ? c.chatId : null);
  const readMode = nav.boot.settings.readMode;

  const toggleMute = async () => {
    try {
      const r = await call<{ muted: boolean }>('action', { type: 'mute', chatId });
      setData({ ...c, muted: r.muted }); emit({ type: 'muted', chatId, value: r.muted }); haptic('select');
    } catch (e) { nav.toast((e as ApiError).message, 'err'); }
  };
  const setAutoRead = async (v: boolean) => {
    setData({ ...c, autoRead: v });
    try {
      const r = await call<{ autoRead: boolean }>('action', { type: 'autoRead', chatId, value: v });
      setData({ ...c, autoRead: r.autoRead }); haptic('select');
    } catch (e) { setData({ ...c, autoRead: !v }); nav.toast((e as ApiError).message, 'err'); }
  };
  const setExcluded = async (v: boolean) => {
    if (v && !(await confirm(t('contact.exclude.confirm')))) return;
    setData({ ...c, excluded: v });
    try {
      const r = await call<{ excluded: boolean }>('action', { type: 'exclude', chatId, value: v });
      setData({ ...c, excluded: r.excluded }); haptic('select');
      nav.toast(t(r.excluded ? 'contact.exclude.on' : 'contact.exclude.off'));
      nav.reloadBoot().catch(() => {});
    } catch (e) { setData({ ...c, excluded: !v }); nav.toast((e as ApiError).message, 'err'); }
  };
  const deleteChat = () => { deleteChatFlow(nav, chatId, c.chatName); };
  const copyId = async () => {
    if (userId == null) return;
    if (await copyText(String(userId))) { haptic('success'); nav.toast(t('contact.idCopied'), 'ok'); }
  };

  // По @username — обычная ссылка t.me; без него — tg://user?id (работает не во всех клиентах).
  const openInTelegram = () => {
    if (c.username) { openTgLink(`https://t.me/${c.username}`); return; }
    try { if (tg?.openLink) tg.openLink(`tg://user?id=${userId}`); else window.open(`tg://user?id=${userId}`, '_blank'); }
    catch { copyId(); }
  };

  const act = (icon: IconName, label: string, onClick: () => void) => (
    <button className="h-act" onClick={onClick}><Icon name={icon} />{label}</button>
  );

  return (
    <>
      <Header title={t('contact.title')} />
      <div className="hero">
        <Avatar id={c.chatId} name={c.chatName} size={92} photo={c.hasPhoto} />
        <div className="h-n">{name}</div>
        <div className="h-s">{c.lastAt ? t('contact.lastMessage', { date: fmtDateTime(c.lastAt) }) : t('contact.noMessages')}</div>
        <div className="h-acts">
          {act('chat', t('contact.act.chat'), () => nav.push({ name: 'chat', chatId, chatName: c.chatName }))}
          {act('image', t('contact.act.media'), () => nav.push({ name: 'media', chatId, chatName: c.chatName }))}
          {act(c.muted ? 'bell' : 'bellOff', t(c.muted ? 'contact.act.unmute' : 'contact.act.mute'), toggleMute)}
          {act('share', t('contact.act.export'), () => setExportOpen(true))}
        </div>
      </div>

      <div className="kpis">
        <Stat n={c.total} label={t('contact.stat.messages')} />
        <Stat n={c.media} label={t('contact.stat.withFiles')} />
        <Stat n={c.deleted} label={t('contact.stat.deleted')} color="var(--red-ink)" />
        <Stat n={c.edited} label={t('contact.stat.edited')} color="var(--orange-ink)" />
      </div>

      <SectionHeader>{t('contact.deletesIncoming')}</SectionHeader>
      <div className="sec">
        <div className="cell">
          <div className="grow">
            <div className="t"><b className="tnum">{delShare}%</b> <span className="hint">{t('contact.deletesIncomingNote', { msgs: count(c.deleted, W.msg), total: fmtNum(c.incoming) })}</span></div>
            <div className="meter"><i style={{ width: `${delShare}%`, ['--c' as string]: 'var(--red)' }} /></div>
          </div>
        </div>
      </div>

      {st.data && st.data.activity.some((d) => d.captured + d.deleted + d.edited > 0) && <>
        <SectionHeader right={<button className="link-btn" onClick={() => nav.push({ name: 'stats', chatId, chatName: c.chatName })}>{t('contact.allStats')}</button>}>{t('contact.activity')}</SectionHeader>
        <div className="sec"><ActivityChart data={st.data.activity} compact /></div>
      </>}
      {ins.data && ins.data.night.total > 0 && <>
        <SectionHeader>{t('contact.whenDeletes')}</SectionHeader>
        <div className="sec card-pad">
          <Heatmap grid={ins.data.heatmap.deleted} color="var(--red)" unit={t('contact.w.deletion')} />
        </div>
      </>}
      {ins.data && (ins.data.ttd.total > 0 || ins.data.balance.chats.length > 0) && (
        <div className="kpis" style={{ marginTop: 16 }}>
          {ins.data.ttd.total > 0 && <Fact value={fmtSpan(ins.data.ttd.median)} label={t('contact.fact.ttd')} />}
          {ins.data.balance.theirReply != null && <Fact value={fmtSpan(ins.data.balance.theirReply)} label={t('contact.fact.theirs')} />}
          {ins.data.balance.myReply != null && <Fact value={fmtSpan(ins.data.balance.myReply)} label={t('contact.fact.mine')} />}
          {ins.data.night.total > 0 && <Fact value={`${Math.round(ins.data.night.share * 100)}%`} label={t('contact.fact.night')} />}
        </div>
      )}

      <SectionHeader>{t('contact.info')}</SectionHeader>
      <div className="sec">
        {(c.username || userId != null) && (
          <Cell icon="external" title={t('contact.openInTelegram')} tone="accent" sub={c.username ? `@${c.username}` : undefined} onClick={openInTelegram} />
        )}
        {userId != null && <Cell title={t('contact.telegramId')} value={<span className="tnum">{userId}</span>} onClick={copyId} right={<Icon name="copy" className="hint" />} />}
        <Cell title={t('contact.firstMessage')} value={fmtDateTime(c.firstAt)} />
        <Cell title={t('contact.lastMessageTitle')} value={fmtDateTime(c.lastAt)} />
      </div>

      {(c.usernames?.length ?? 0) > 1 && <>
        <SectionHeader>{t('contact.usernames')}</SectionHeader>
        <div className="sec">{c.usernames!.map((u, i) => <Cell key={u} title={`@${u}`} value={i === 0 ? t('contact.current') : undefined} />)}</div>
      </>}

      {c.names.length > 1 && <>
        <SectionHeader>{t('contact.names')}</SectionHeader>
        <div className="sec">{c.names.map((n, i) => <Cell key={n} title={n} value={i === 0 ? t('contact.current') : undefined} />)}</div>
        <SectionFooter>{t('contact.names.footer')}</SectionFooter>
      </>}

      <SectionHeader>{t('contact.thisChat')}</SectionHeader>
      <div className="sec">
        <ToggleCell icon="bell" color="#ff3b30" title={t('contact.notifications')} on={!c.muted} onChange={() => toggleMute()} />
        <ToggleCell icon="checks" color="#30b0c7" title={t('contact.markRead')} on={c.autoRead} onChange={setAutoRead} disabled={readMode !== 'chats'} />
        <ToggleCell icon="eye" color="#8e8e93" title={t('contact.excludeChat')} on={!!c.excluded} onChange={setExcluded} />
      </div>
      <SectionFooter>
        {t(readMode === 'chats' ? 'contact.readMode.chats' : readMode === 'all' ? 'contact.readMode.all' : 'contact.readMode.off')}
      </SectionFooter>

      <div className="sec" style={{ marginTop: 24 }}>
        <Cell icon="trash" title={t('contact.deleteChat')} tone="danger" onClick={deleteChat} />
      </div>
      <SectionFooter>{t('contact.deleteChat.footer')}</SectionFooter>

      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} chatId={chatId} chatName={c.chatName} />
    </>
  );
}

const Fact = ({ value, label }: { value: string; label: string }) => (
  <div className="kpi static"><span className="k-n tnum" style={{ fontSize: 22 }}>{value}</span><span className="k-l">{label}</span></div>
);

const Stat = ({ n, label, color }: { n: number; label: string; color?: string }) => (
  <div className="kpi static"><span className="k-n tnum" style={{ color }}>{fmtNum(n)}</span><span className="k-l">{label}</span></div>
);
