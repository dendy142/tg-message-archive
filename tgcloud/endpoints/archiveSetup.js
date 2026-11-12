// Кнопка выбора/создания группы-архива (requestChat)
import { api } from 'sdk';
import { authed } from '../lib/runtime.js';
import { t } from '../lib/i18n.js';
import { getArchive } from '../lib/archive.js';

/**
 * Права, которые просим у бота в группе-архиве: вести темы и отправлять в них файлы, удалять
 * тему собеседника вместе с копиями, когда владелец удаляет переписку (deleteForumTopic).
 */
const BOT_RIGHTS = {
  is_anonymous: false, can_manage_chat: true, can_delete_messages: true, can_manage_video_chats: false,
  can_restrict_members: false, can_promote_members: false, can_change_info: false, can_invite_users: true,
  can_post_messages: false, can_edit_messages: false, can_pin_messages: false, can_manage_topics: true,
};
const USER_RIGHTS = { ...BOT_RIGHTS, can_promote_members: true, can_restrict_members: true, can_delete_messages: true };

export default authed(async (input, { owner, settings }) => {
  if (input?.status) {
    const a = await getArchive(owner);
    return { archive: a ? { linked: true, chatId: Number(a.chatId), title: a.title, status: a.status, lostReason: a.lostReason } : { linked: false } };
  }
  const requestId = Math.floor(Math.random() * 2_000_000_000) + 1;
  const prepared = await api.savePreparedKeyboardButton({
    user_id: owner,
    button: {
      text: t(settings.lang, 'bot.pickArchive'),
      request_chat: {
        request_id: requestId,
        chat_is_channel: false,
        chat_is_forum: true,
        bot_is_member: true,
        request_title: true,
        bot_administrator_rights: BOT_RIGHTS,
        user_administrator_rights: USER_RIGHTS,
      },
    },
  });
  return { preparedId: prepared.id, requestId };
});
