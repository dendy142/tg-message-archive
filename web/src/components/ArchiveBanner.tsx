import { useState } from 'react';
import { useNav } from '../nav';
import { useArchiveLink, reasonText } from '../archive';
import { isSnoozed, snooze } from '../storage';
import { Icon } from './Icon';
import { t } from '../i18n';

const KEY = 'banner.archive.snoozedUntil';
const WEEK = 7 * 86_400_000;

export function ArchiveBanner() {
  const nav = useNav();
  const link = useArchiveLink();
  const a = nav.boot.archive;
  const [hidden, setHidden] = useState(() => isSnoozed(KEY));
  const lost = a.linked && a.status === 'lost';
  if (a.linked && !lost) return null;
  if (!lost && hidden) return null;
  return (
    <div className="pad" style={{ marginBottom: 12 }}>
      <div className={`note${lost ? ' warn' : ''} banner`}>
        <Icon name={lost ? 'alert' : 'archive'} />
        <div className="grow">
          <div>{lost ? reasonText(a.lostReason) : t('ui.archiveBanner.notSet')}</div>
          {link.status && <div className="hint" style={{ marginTop: 4 }}>{link.status}</div>}
          <div className="banner-acts">
            <button className="link-btn" disabled={link.busy} onClick={() => link.start()}>{lost ? t('ui.archiveBanner.pickAgain') : t('ui.archiveBanner.pick')}</button>
            {!lost && <button className="link-btn hint" onClick={() => { snooze(KEY, WEEK); setHidden(true); }}>{t('ui.archiveBanner.later')}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
