import { api, BotApiError } from 'sdk';
import { endpointError } from '../lib/i18n.js';
import { authed, requireOwnChat, rateLimit, reporter } from '../lib/runtime.js';
import {
  toggleFavorite, deleteById, deleteChatHistory, chatHistoryCounts, lastIncoming, wipeOwnerArchive, retryFailedMirrors,
} from '../lib/repo/messages.js';
import { toggleMute, setChatPref, connectionsOf, updateSettings } from '../lib/repo/state.js';
import { startMediaExport, cancelJob, drainJobs, eraseChat } from '../lib/jobs.js';
import { requirePro, cancelSubscription } from '../lib/plans.js';
import { hasChatTopic } from '../lib/archive.js';

const DELETE_PERIODS = new Set(['today', '3d', 'all']);

export default authed(async (input, { owner, settings }) => {
  const type = input.type;
  switch (type) {
    case 'favorite': {
      const fav = await toggleFavorite(owner, Number(input.id));
      if (fav === null) throw endpointError('err.eventNotFound', null, 'NOT_FOUND');
      return { favorite: fav };
    }
    case 'mute': {
      const chatId = await requireOwnChat(owner, input.chatId);
      return { muted: await toggleMute(owner, chatId) };
    }
    case 'autoRead': {
      const chatId = await requireOwnChat(owner, input.chatId);
      const pref = await setChatPref(owner, chatId, { autoRead: !!input.value });
      return { autoRead: !!pref?.autoRead };
    }
    case 'exclude': {
      const chatId = await requireOwnChat(owner, input.chatId);
      const pref = await setChatPref(owner, chatId, { excluded: !!input.value });
      return { excluded: !!pref?.excluded };
    }
    case 'wipeAll': {
      if (input.confirm !== 'DELETE_ALL') throw endpointError('err.confirmRequired', null, 'CONFIRM_REQUIRED');
      return { removed: await wipeOwnerArchive(owner) };
    }
    case 'deleteEvent': {
      const ok = await deleteById(owner, Number(input.id));
      if (!ok) throw endpointError('err.eventNotFound', null, 'NOT_FOUND');
      return { deleted: true };
    }
    case 'chatDeleteCounts': {
      const chatId = await requireOwnChat(owner, input.chatId);
      const [counts, archiveTopic] = await Promise.all([chatHistoryCounts(owner, chatId, settings.timezone), hasChatTopic(owner, chatId)]);
      return { counts, archiveTopic };
    }
    case 'deleteChatHistory': {
      const chatId = await requireOwnChat(owner, input.chatId);
      if (!DELETE_PERIODS.has(input.period)) throw endpointError('err.badPeriod', null, 'BAD_PERIOD');
      const n = await deleteChatHistory(owner, chatId, input.period, settings.timezone);
      return { removed: n };
    }
    case 'deleteChat': {
      const chatId = await requireOwnChat(owner, input.chatId);
      if (input.confirm !== 'DELETE_CHAT') throw endpointError('err.confirmRequired', null, 'CONFIRM_REQUIRED');
      return eraseChat(owner, chatId, { archive: !!input.archive });
    }
    case 'markRead': {
      const chatId = await requireOwnChat(owner, input.chatId);
      const last = await lastIncoming(owner, chatId);
      if (!last) return { read: false };
      // Отмечать можно только через то подключение, которому принадлежит чат.
      const conn = (await connectionsOf(owner)).find((c) => c.businessConnectionId === last.businessConnectionId);
      if (!conn?.isEnabled || !conn.canRead) throw endpointError('err.noReadRight', null, 'NO_RIGHT');
      try {
        await api.readBusinessMessage({ business_connection_id: last.businessConnectionId, chat_id: chatId, message_id: Number(last.messageId) });
        return { read: true };
      } catch (e) {
        if (e instanceof BotApiError) throw endpointError('err.tgDenied', null, 'TG', { description: e.description });
        throw e;
      }
    }
    case 'seen': {
      const upTo = Number(input.upTo);
      if (!Number.isFinite(upTo) || upTo <= 0) throw endpointError('err.noMoment', null, 'BAD_INPUT');
      const prev = settings.lastSeenEventsAt ? new Date(settings.lastSeenEventsAt).getTime() : 0;
      // Часы Telegram (edit_date) могут слегка убегать вперёд — допускаем 5 минут, не больше.
      const next = Math.max(prev, Math.min(upTo, Date.now() + 5 * 60_000));
      if (next > prev) await updateSettings(owner, { lastSeenEventsAt: new Date(next) });
      return { lastSeenEventsAt: next };
    }
    case 'exportMedia': {
      const chatId = await requireOwnChat(owner, input.chatId);
      await requirePro.exportMedia(owner);
      await rateLimit(owner, 'exportMedia');
      const r = await startMediaExport(owner, { chatId, group: input.group, deletedOnly: !!input.deletedOnly });
      if (r.error === 'BUSY') throw endpointError('err.busy', null, 'BUSY');
      if (r.error === 'EMPTY') throw endpointError('err.noFilesInChat', null, 'EMPTY');
      await drainJobs(owner, settings.timezone, new Date(), 2, settings.lang).catch(reporter('drainJobs', owner));
      return r;
    }
    case 'cancelSubscription':
      return { plan: await cancelSubscription(owner) };
    case 'cancelJob':
      return { cancelled: await cancelJob(owner, Number(input.id)) };
    case 'retryMirror':
      return { queued: await retryFailedMirrors(owner) };
    default:
      throw endpointError('err.badAction', null, 'BAD_ACTION');
  }
});
