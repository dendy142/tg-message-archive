import { authed, requireOwnChat } from '../lib/runtime.js';
import { db } from 'sdk';
import { and, eq, isNotNull, sql } from 'sdk/db';
import { messages } from '../schema.js';
import { getChat } from '../lib/repo/chats.js';
import { refreshAvatar } from '../lib/links.js';
import { chatPref } from '../lib/repo/state.js';

async function history(owner, chatId, col) {
  const rows = await db.select({ v: col, last: sql`max(${messages.date})` }).from(messages)
    .where(and(eq(messages.ownerUserId, owner), eq(messages.chatId, chatId), eq(messages.isOutgoing, false), isNotNull(col)))
    .groupBy(col).orderBy(sql`max(${messages.date}) desc`).limit(10).all();
  return rows.map((x) => x.v).filter(Boolean);
}

export default authed(async (input, { owner }) => {
  const chatId = await requireOwnChat(owner, input.chatId);
  await refreshAvatar(owner, chatId).catch(() => null);
  const [c, names, usernames, pref] = await Promise.all([
    getChat(owner, chatId),
    history(owner, chatId, messages.senderName),
    history(owner, chatId, messages.senderUsername),
    chatPref(owner, chatId),
  ]);
  const ms = (v) => (v == null ? null : new Date(v).getTime());
  return {
    chatId, chatName: c?.name ?? null,
    senderId: c?.senderId == null ? null : Number(c.senderId),
    username: c?.senderUsername ?? null,
    total: c?.total ?? 0, incoming: c?.incoming ?? 0, deleted: c?.deleted ?? 0, edited: c?.edited ?? 0, media: c?.media ?? 0,
    firstAt: ms(c?.firstAt), lastAt: ms(c?.lastAt),
    names, usernames,
    hasPhoto: !!c?.photoFileId,
    muted: !!pref?.muted, autoRead: !!pref?.autoRead, excluded: !!pref?.excluded,
  };
});
