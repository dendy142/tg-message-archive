import { authed, maybeOwnerHousekeeping, reporter } from '../lib/runtime.js';
import { settingsView } from '../lib/view.js';
import { connectionsOf, countExcluded, updateSettings, syncLang } from '../lib/repo/state.js';
import { getArchive, drainMirror } from '../lib/archive.js';
import { countPendingMirrors, countFailedMirrors, unreadEvents } from '../lib/repo/messages.js';
import { chatTotals } from '../lib/repo/chats.js';
import { botUsername } from '../lib/links.js';
import { RETENTION_CHOICES } from '../lib/util.js';
import { drainOutbox } from '../lib/events.js';
import { drainJobs, activeJobs } from '../lib/jobs.js';
import { VERSION, COMMIT } from '../lib/version.js';
import { isOperator } from '../lib/admin.js';
import { planView } from '../lib/plans.js';

const DRAIN_BUDGET_MS = 3000;

export default authed(async (_input, { owner, settings, ctx }) => {
  Object.assign(settings, await syncLang(owner, settings, ctx?.initData?.user?.language_code));
  const deadline = Date.now() + DRAIN_BUDGET_MS;
  if (!settings.lastSeenEventsAt) Object.assign(settings, await updateSettings(owner, { lastSeenEventsAt: new Date() }));
  await maybeOwnerHousekeeping(owner).catch(reporter('retention', owner));
  await drainOutbox(owner, 5).catch(reporter('drainOutbox', owner));
  await drainMirror(owner, settings.timezone, new Date(), 10, 20, deadline, settings.lang).catch(reporter('drainMirror', owner));
  if (Date.now() < deadline) await drainJobs(owner, settings.timezone, new Date(), 2, settings.lang).catch(reporter('drainJobs', owner));
  const [conns, archive, totals, pending, failed, username, excluded, unread, jobs] = await Promise.all([
    connectionsOf(owner),
    getArchive(owner),
    chatTotals(owner),
    countPendingMirrors(owner),
    countFailedMirrors(owner),
    botUsername(),
    countExcluded(owner),
    unreadEvents(owner, /** @type {Date} */ (settings.lastSeenEventsAt)),
    activeJobs(owner),
  ]);
  const connected = conns.some((c) => c.isEnabled);
  return {
    user: { id: owner },
    bot: { username },
    connection: { connected, count: conns.filter((c) => c.isEnabled).length, canReply: conns.some((c) => c.isEnabled && c.canReply) },
    archive: archive
      ? { linked: true, chatId: Number(archive.chatId), title: archive.title, status: archive.status, lostReason: archive.lostReason }
      : { linked: false },
    counts: { chats: totals.chats, deleted: totals.deleted, edited: totals.edited, favorite: totals.favorite, pendingMirror: pending, failedMirror: failed, excludedChats: excluded, unreadEvents: unread.total },
    settings: settingsView(settings),
    retentionChoices: RETENTION_CHOICES,
    jobs,
    version: { version: VERSION, commit: COMMIT },
    operator: await isOperator(owner),
    plan: await planView(owner),
    onboarded: !!settings.onboardedAt && connected,
  };
});
