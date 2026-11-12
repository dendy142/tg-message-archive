import { useState, type ReactNode } from 'react';
import { call, ApiError } from '../api';
import { copyText, haptic } from '../telegram';
import { useNav } from '../nav';
import { useArchiveLink, reasonText } from '../archive';
import { Icon, type IconName } from '../components/Icon';
import { SectionHeader, SectionFooter } from '../components/ui';
import { t, type Key } from '../i18n';

const FEATURES: { icon: IconName; color: string; title: Key; text: Key }[] = [
  { icon: 'trash', color: 'var(--red)', title: 'onboarding.feat.deleted', text: 'onboarding.feat.deletedText' },
  { icon: 'pencil', color: 'var(--orange)', title: 'onboarding.feat.edits', text: 'onboarding.feat.editsText' },
  { icon: 'flame', color: 'var(--fire)', title: 'onboarding.feat.oneTime', text: 'onboarding.feat.oneTimeText' },
];

const withNode = (key: Key, param: string, node: ReactNode) => {
  const [before, after = ''] = t(key, { [param]: '\u0001' }).split('\u0001');
  return <>{before}{node}{after}</>;
};

export function Onboarding() {
  const nav = useNav();
  const { boot, reloadBoot } = nav;
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const link = useArchiveLink();
  const connected = boot.connection.connected;
  const archive = boot.archive;
  const archiveOk = archive.linked && archive.status === 'active';
  const lost = archive.linked && archive.status === 'lost';
  const bot = `@${boot.bot.username}`;

  // Состояние берём из свежего ответа, а не из старого boot: иначе «не вижу подключения»
  // показывалось бы и после успешного подключения.
  const check = async () => {
    setChecking(true); setCheckMsg(null);
    try {
      const b = await reloadBoot();
      if (b.connection.connected) { haptic('success'); return; }
      haptic('warning');
      setCheckMsg(t('onboarding.step1.notYet'));
    } catch (e) {
      setCheckMsg((e as ApiError).message);
    } finally { setChecking(false); }
  };

  const copyBot = async () => { if (await copyText(bot)) { haptic('success'); nav.toast(t('onboarding.botCopied'), 'ok'); } };

  const finish = async () => {
    setFinishing(true);
    try { await call('settings', { markOnboarded: true }); await reloadBoot(); haptic('success'); }
    catch (e) { nav.toast((e as ApiError).message, 'err'); setFinishing(false); }
  };

  return (
    <div className="onb">
      <div className="hero" style={{ paddingTop: 'calc(var(--safe-t) + 28px)' }}>
        <div className="logo"><Icon name="archive" strokeWidth={1.7} /></div>
        <h1 className="h1">{t('onboarding.title')}</h1>
        <p className="lead">{t('onboarding.lead')}</p>
      </div>

      <div className="card">
        {FEATURES.map((f) => (
          <div key={f.title} className="feat">
            <span className="tile" style={{ ['--c' as string]: f.color }}><Icon name={f.icon} /></span>
            <div><b>{t(f.title)}</b><span>{t(f.text)}</span></div>
          </div>
        ))}
      </div>

      <SectionHeader>{t('onboarding.connection')}</SectionHeader>
      <div className="sec">
        <div className="step">
          <span className={`num${connected ? ' done' : ''}`}>{connected ? <Icon name="check" strokeWidth={3} /> : 1}</span>
          <div className="grow">
            <div className="st-t">{t('onboarding.step1.title')}</div>
            {connected ? (
              <div className="st-b">{boot.connection.canReply ? t('onboarding.step1.doneReply') : t('onboarding.step1.done')}</div>
            ) : <>
              <div className="st-b">
                {withNode('onboarding.step1.how', 'path', <b>{t('onboarding.connectPath')}</b>)}
              </div>
              <button className="pill-copy" onClick={copyBot}><Icon name="copy" />{bot}</button>
              {checkMsg && <div className="note warn" style={{ marginTop: 12 }}><Icon name="info" />{checkMsg}</div>}
              <button className="btn tinted" disabled={checking} onClick={check}>
                {checking ? <span className="spin" /> : <Icon name="refresh" />}
                {checking ? t('onboarding.step1.checking') : t('onboarding.step1.check')}
              </button>
            </>}
          </div>
        </div>

        <div className={`step${connected ? '' : ' off'}`}>
          <span className={`num${archiveOk ? ' done' : connected ? '' : ' off'}`}>{archiveOk ? <Icon name="check" strokeWidth={3} /> : 2}</span>
          <div className="grow">
            <div className="st-t">{t('onboarding.step2.title')}</div>
            <div className="st-b">
              {archiveOk
                ? withNode('onboarding.step2.linked', 'title', <b>{t('onboarding.quoted', { text: archive.title ?? t('onboarding.step2.fallbackTitle') })}</b>)
                : t('onboarding.step2.about')}
            </div>
            {lost && !link.busy && <div className="note warn" style={{ marginTop: 12 }}><Icon name="alert" />{reasonText(archive.lostReason)}</div>}
            {link.status && <div className="status-line">{link.busy && <span className="spin" />}{link.status}</div>}
            {connected && !archiveOk && (
              <button className="btn" disabled={link.busy} onClick={() => link.start()}>
                {link.busy ? <span className="spin" style={{ borderTopColor: 'var(--accent-text)' }} /> : <Icon name="users" />}
                {lost ? t('onboarding.step2.rechoose') : t('onboarding.step2.choose')}
              </button>
            )}
            {connected && !archiveOk && (
              <>
                <button className="btn plain" disabled={finishing || link.busy} onClick={finish}>{finishing ? t('onboarding.opening') : t('onboarding.skip')}</button>
                <div className="st-b hint" style={{ marginTop: 6 }}>
                  {t('onboarding.skipHint')}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {connected && archiveOk && (
        <div className="pad" style={{ marginTop: 20 }}>
          <button className="btn" disabled={finishing} onClick={finish}>{finishing ? t('onboarding.opening') : t('onboarding.open')}</button>
        </div>
      )}
      <SectionFooter>{t('onboarding.footer')}</SectionFooter>
    </div>
  );
}
