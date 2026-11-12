// Схема базы бота (SQLite платформы Telegram Serverless)
// Время — unix-мс (timestamp_ms → Date); FK нет, каскады в коде; drop только через .deprecated()
import { table, integer, text, boolean, json, index, uniqueIndex, primaryKey, sql } from 'sdk/db';

const ms = (name) => integer(name, { mode: 'timestamp_ms' });
const nowMs = sql`(unixepoch() * 1000)`;

export const connections = table('connections', {
  businessConnectionId: text('business_connection_id').primaryKey(),
  ownerUserId: integer('owner_user_id').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  canReply: boolean('can_reply').notNull().default(false),
  canRead: boolean('can_read').notNull().default(false),
  rights: json('rights'),
  createdAt: ms('created_at').notNull().default(nowMs),
  updatedAt: ms('updated_at').notNull().default(nowMs),
}, (t) => ({
  byOwner: index('connections_owner_idx').on(t.ownerUserId),
}));

/** Копия каждого сообщения личных чатов: при удалении Telegram присылает только id. */
export const messages = table('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  businessConnectionId: text('business_connection_id').notNull(),
  ownerUserId: integer('owner_user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  chatName: text('chat_name'),
  messageId: integer('message_id').notNull(),
  senderId: integer('sender_id'),
  senderName: text('sender_name'),
  senderUsername: text('sender_username'),
  isOutgoing: boolean('is_outgoing').notNull().default(false),
  text: text('text'),
  caption: text('caption'),
  entities: json('entities'),
  replyToMessageId: integer('reply_to_message_id'),
  replyToSender: text('reply_to_sender'),
  replyToText: text('reply_to_text'),
  forwardOrigin: json('forward_origin'),
  mediaGroupId: text('media_group_id'),
  mediaType: text('media_type'),
  fileId: text('file_id'),
  fileUniqueId: text('file_unique_id'),
  mimeType: text('mime_type'),
  fileSize: integer('file_size'),
  fileName: text('file_name'),
  thumbFileId: text('thumb_file_id'),
  mediaMeta: json('media_meta'),
  /** none — копировать нечего; pending — ждёт отправки; done; failed — Telegram отказал окончательно. */
  mirrorStatus: text('mirror_status').notNull().default('none'),
  mirrorChatId: integer('mirror_chat_id'),
  mirrorMessageId: integer('mirror_message_id'),
  mirrorThreadId: integer('mirror_thread_id'),
  mirrorAttempts: integer('mirror_attempts').notNull().default(0),
  mirrorRetryAt: ms('mirror_retry_at'),
  mirrorError: text('mirror_error'),
  mirrorFileId: text('mirror_file_id'),
  mirrorThumbFileId: text('mirror_thumb_file_id'),
  mirrorCaptionMessageId: integer('mirror_caption_message_id'),
  mirrorDirty: boolean('mirror_dirty').notNull().default(false),
  /** Захвачено из reply_to_message — так бэкапятся одноразовые медиа: бот сохраняет оригинал по file_id. */
  oneTime: boolean('one_time').notNull().default(false),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: ms('deleted_at'),
  isFavorite: boolean('is_favorite').notNull().default(false),
  editCount: integer('edit_count').notNull().default(0),
  lastEditedAt: ms('last_edited_at'),
  eventAt: ms('event_at'),
  date: ms('date').notNull(),
  createdAt: ms('created_at').notNull().default(nowMs),
  searchText: text('search_text'),
}, (t) => ({
  uniqByKey: uniqueIndex('messages_conn_chat_msg_uq').on(t.businessConnectionId, t.chatId, t.messageId),
  byOwnerCreated: index('messages_owner_created_idx').on(t.ownerUserId, t.createdAt),
  byOwnerChatDate: index('messages_owner_chat_date_idx').on(t.ownerUserId, t.chatId, t.date),
  byOwnerDate: index('messages_owner_date_idx').on(t.ownerUserId, t.date),
  byOwnerEvent: index('messages_owner_event_idx').on(t.ownerUserId, t.eventAt),
  byOwnerDeleted: index('messages_owner_deleted_idx').on(t.ownerUserId, t.isDeleted, t.deletedAt),
  // Частичные индексы под фильтры ленты и очереди. Условия в запросах — литералами (lib/repo/state.js).
  byOwnerFav: index('messages_owner_fav_idx').on(t.ownerUserId, t.date).where(sql`is_favorite = 1`),
  byOwnerEdited: index('messages_owner_edited_idx').on(t.ownerUserId, t.lastEditedAt).where(sql`edit_count > 0`),
  byOwnerOneTime: index('messages_owner_onetime_idx').on(t.ownerUserId, t.date).where(sql`one_time = 1`),
  byOwnerChatDeleted: index('messages_owner_chat_deleted_idx').on(t.ownerUserId, t.chatId, t.deletedAt).where(sql`is_deleted = 1`),
  mirrorDirtyQueue: index('messages_mirror_dirty_idx').on(t.ownerUserId, t.date).where(sql`mirror_dirty = 1`),
  byOwnerMedia: index('messages_owner_media_idx').on(t.ownerUserId, t.mediaType, t.date),
  byAlbum: index('messages_album_idx').on(t.businessConnectionId, t.chatId, t.mediaGroupId),
  mirrorPending: index('messages_mirror_pending_idx').on(t.ownerUserId, t.date).where(sql`mirror_status = 'pending'`),
}));

export const edits = table('edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messagePk: integer('message_pk').notNull(),
  ownerUserId: integer('owner_user_id').notNull(),
  oldText: text('old_text'),
  newText: text('new_text'),
  oldEntities: json('old_entities'),
  newEntities: json('new_entities'),
  oldMedia: json('old_media'),
  editedAt: ms('edited_at').notNull().default(nowMs),
}, (t) => ({
  byMsg: index('edits_msg_idx').on(t.messagePk),
  byOwnerPk: index('edits_owner_pk_idx').on(t.ownerUserId, t.messagePk),
  byOwnerEdited: index('edits_owner_edited_idx').on(t.ownerUserId, t.editedAt),
}));

export const settings = table('settings', {
  ownerUserId: integer('owner_user_id').primaryKey(),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  notifyOwn: boolean('notify_own').notNull().default(true),
  timezone: text('timezone').notNull().default('UTC'),
  /** Откуда пояс: auto — с устройства, обновляется сам; manual — выбран руками; null — ещё не задан (ведёт себя как manual). */
  tzSource: text('tz_source'),
  lang: text('lang').notNull().default('ru'),
  /** auto — по language_code Telegram (обновляется сам); manual — выбран в Настройках. */
  langSource: text('lang_source'),
  /** null — хранить вечно; иначе события старше N дней чистятся (избранное — никогда). */
  retentionDays: integer('retention_days'),
  keywords: json('keywords'),
  /** Отметка прочтения от имени аккаунта: off — не трогать, all — всё, chats — выбранные чаты. */
  readMode: text('read_mode').notNull().default('off'),
  lockEnabled: boolean('lock_enabled').notNull().default(false),
  /** Тихие часы { from: 'HH:MM', to: 'HH:MM' } в поясе пользователя: уведомления приходят без звука. */
  quietHours: json('quiet_hours'),
  /** Какие уведомления слать: { deleted, edited, oneTime, keywords, wipe, rename } (нет ключа — да). */
  notifyTypes: json('notify_types'),
  hidePreview: boolean('hide_preview').notNull().default(false),
  keywordWholeWord: boolean('keyword_whole_word').notNull().default(false),
  keywordExclude: json('keyword_exclude'),
  keywordLoud: boolean('keyword_loud').notNull().default(true),
  mirrorTypes: json('mirror_types'),
  mirrorMaxMb: integer('mirror_max_mb'),
  /** Вид замка: off | biometric | pin. null — вид не выбран, решает lockEnabled. */
  lockMode: text('lock_mode'),
  pinHash: text('pin_hash'),
  pinSalt: text('pin_salt'),
  pinFailed: integer('pin_failed').notNull().default(0),
  pinLockedUntil: ms('pin_locked_until'),
  autoLockMin: integer('auto_lock_min'),
  onboardedAt: ms('onboarded_at'),
  disconnectedAt: ms('disconnected_at'),
  purgeAfterDisconnectDays: integer('purge_after_disconnect_days'),
  planNoticeAt: ms('plan_notice_at'),
  /** Владелец заблокировал бота (403) — уведомления не шлём до следующего /start. */
  notificationsBlocked: boolean('notifications_blocked').notNull().default(false),
  lastSeenEventsAt: ms('last_seen_events_at'),
  ftsBuilt: boolean('fts_built').notNull().default(false),
  /** Таблица daily_stats владельца собрана; смена пояса сбрасывает флаг — пересборка. */
  statsBuilt: boolean('stats_built').notNull().default(false),
  chatsBuilt: boolean('chats_built').notNull().default(false),
  /** Последняя уборка владельца (срок хранения) — не чаще раза в 6 часов. */
  housekeptAt: ms('housekept_at'),
  updatedAt: ms('updated_at').notNull().default(nowMs),
});

export const chats = table('chats', {
  ownerUserId: integer('owner_user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  name: text('name'),
  senderId: integer('sender_id'),
  senderName: text('sender_name'),
  senderUsername: text('sender_username'),
  total: integer('total').notNull().default(0),
  incoming: integer('incoming').notNull().default(0),
  deleted: integer('deleted').notNull().default(0),
  edited: integer('edited').notNull().default(0),
  media: integer('media').notNull().default(0),
  favorite: integer('favorite').notNull().default(0),
  oneTime: integer('one_time').notNull().default(0),
  firstAt: ms('first_at'),
  lastAt: ms('last_at'),
  lastEventAt: ms('last_event_at'),
  lastIncomingAt: ms('last_incoming_at'),
  photoFileId: text('photo_file_id'),
  photoCheckedAt: ms('photo_checked_at'),
  updatedAt: ms('updated_at').notNull().default(nowMs),
}, (t) => ({
  pk: primaryKey({ columns: [t.ownerUserId, t.chatId] }),
  byOwnerLast: index('chats_owner_last_idx').on(t.ownerUserId, t.lastAt),
}));

export const dailyStats = table('daily_stats', {
  ownerUserId: integer('owner_user_id').notNull(),
  /** YYYY-MM-DD в поясе владельца. */
  day: text('day').notNull(),
  chatId: integer('chat_id').notNull(),
  captured: integer('captured').notNull().default(0),
  incoming: integer('incoming').notNull().default(0),
  media: integer('media').notNull().default(0),
  oneTime: integer('one_time').notNull().default(0),
  voiceSec: integer('voice_sec').notNull().default(0),
  videoSec: integer('video_sec').notNull().default(0),
  bytes: integer('bytes').notNull().default(0),
  files: integer('files').notNull().default(0),
  inDeletedOfDay: integer('in_deleted_of_day').notNull().default(0),
  /** Входящие по типам: { photo: n, photo_d: удалено, … }. */
  byType: json('by_type'),
  deleted: integer('deleted').notNull().default(0),
  inDeleted: integer('in_deleted').notNull().default(0),
  deletedMedia: integer('deleted_media').notNull().default(0),
  deletedMirrored: integer('deleted_mirrored').notNull().default(0),
  /** Удаления входящих по часам (24) и по времени от отправки до удаления (корзины TTD_BUCKETS). */
  hoursDeleted: json('hours_deleted'),
  ttd: json('ttd'),
  edited: integer('edited').notNull().default(0),
  inEdited: integer('in_edited').notNull().default(0),
  inEditedMsgs: integer('in_edited_msgs').notNull().default(0),
  hoursEdited: json('hours_edited'),
  updatedAt: ms('updated_at').notNull().default(nowMs),
}, (t) => ({
  pk: primaryKey({ columns: [t.ownerUserId, t.day, t.chatId] }),
  byOwnerChatDay: index('daily_owner_chat_day_idx').on(t.ownerUserId, t.chatId, t.day),
}));

export const chatPrefs = table('chat_prefs', {
  ownerUserId: integer('owner_user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  muted: boolean('muted').notNull().default(false),
  autoRead: boolean('auto_read').notNull().default(false),
  excluded: boolean('excluded').notNull().default(false),
  excludedByPlan: boolean('excluded_by_plan').notNull().default(false),
  updatedAt: ms('updated_at').notNull().default(nowMs),
}, (t) => ({ pk: primaryKey({ columns: [t.ownerUserId, t.chatId] }) }));

export const notifBatches = table('notif_batches', {
  ownerUserId: integer('owner_user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  kind: text('kind').notNull(),
  messageId: integer('message_id').notNull(),
  count: integer('count').notNull().default(0),
  startedAt: ms('started_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.ownerUserId, t.chatId, t.kind] }) }));

export const processedUpdates = table('processed_updates', {
  updateId: integer('update_id').primaryKey(),
  createdAt: ms('created_at').notNull(),
}, (t) => ({ byCreated: index('processed_updates_created_idx').on(t.createdAt) }));

export const archives = table('archives', {
  ownerUserId: integer('owner_user_id').primaryKey(),
  chatId: integer('chat_id').notNull(),
  title: text('title'),
  /** active — пишем; lost — бота убрали/лишили прав, копии копятся в очереди. */
  status: text('status').notNull().default('active'),
  lostReason: text('lost_reason'),
  /** Telegram ограничил частоту (429) — до этого момента в группу не пишем. */
  retryAt: ms('retry_at'),
  linkedAt: ms('linked_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
}, (t) => ({ byChat: uniqueIndex('archives_chat_uq').on(t.chatId) }));

export const archiveTopics = table('archive_topics', {
  ownerUserId: integer('owner_user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  archiveChatId: integer('archive_chat_id').notNull(),
  threadId: integer('thread_id').notNull(),
  name: text('name'),
  createdAt: ms('created_at').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.ownerUserId, t.chatId] }) }));

/**
 * Очередь исходящих уведомлений: то, что Telegram не принял из-за 429, 5xx или сети,
 * доставляется позже строго по порядку (FIFO по id в рамках владельца).
 */
export const outbox = table('outbox', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerUserId: integer('owner_user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  /** Готовый экран (html, клавиатура, без звука) или способ пересобрать его (rebuild) — файлы не сериализуются. */
  payload: json('payload').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAt: ms('next_at').notNull(),
  lastError: text('last_error'),
  createdAt: ms('created_at').notNull(),
}, (t) => ({ byOwner: index('outbox_owner_idx').on(t.ownerUserId, t.id) }));

export const jobs = table('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerUserId: integer('owner_user_id').notNull(),
  kind: text('kind').notNull(),
  params: json('params'),
  cursor: json('cursor'),
  done: integer('done').notNull().default(0),
  total: integer('total').notNull().default(0),
  /** active | done | cancelled | failed */
  status: text('status').notNull().default('active'),
  nextAt: ms('next_at').notNull(),
  error: text('error'),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
}, (t) => ({ byOwnerStatus: index('jobs_owner_status_idx').on(t.ownerUserId, t.status) }));

export const rateLimits = table('rate_limits', {
  ownerUserId: integer('owner_user_id').notNull(),
  bucket: text('bucket').notNull(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.ownerUserId, t.bucket] }) }));

export const appMeta = table('app_meta', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: ms('updated_at').notNull().default(nowMs),
});

/**
 * Одна запись в минуту на signature (= where + начало message); оператору — не чаще раза в час.
 * Хранится 14 дней.
 */
export const errors = table('errors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: ms('at').notNull(),
  where: text('where').notNull(),
  message: text('message'),
  stack: text('stack'),
  ownerUserId: integer('owner_user_id'),
  signature: text('signature').notNull(),
  notified: boolean('notified').notNull().default(false),
}, (t) => ({
  bySignature: index('errors_signature_idx').on(t.signature, t.at),
  byAt: index('errors_at_idx').on(t.at),
}));

export const subscriptions = table('subscriptions', {
  ownerUserId: integer('owner_user_id').primaryKey(),
  plan: text('plan').notNull().default('pro'),
  /** trial | active | cancelled (оплачено до expiresAt, без продления) | expired */
  status: text('status').notNull(),
  expiresAt: ms('expires_at'),
  chargeId: text('charge_id'),
  isRecurring: boolean('is_recurring').notNull().default(false),
  updatedAt: ms('updated_at').notNull(),
});
