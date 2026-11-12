export interface DiffPart { op: 'eq' | 'del' | 'ins'; text: string }

export interface EditView {
  id: number;
  oldText: string | null;
  newText: string | null;
  oldHtml: string | null;
  newHtml: string | null;
  diff: DiffPart[];
  mediaReplaced: boolean;
  editedAt: number | null;
}

export interface EventView {
  id: number;
  chatId: number;
  chatName: string | null;
  senderId: number | null;
  senderName: string | null;
  isOutgoing: boolean;
  status: 'deleted' | 'edited' | 'plain';
  isDeleted: boolean;
  isFavorite: boolean;
  oneTime: boolean;
  editCount: number;
  text: string | null;
  caption?: string | null;
  html: string | null;
  mediaType: string | null;
  mediaLabel: string | null;
  fileSize: number | null;
  fileName: string | null;
  hasThumb: boolean;
  previewable: boolean;
  mediaMeta: Record<string, unknown> | null;
  albumCount: number;
  reply: { sender: string | null; text: string | null } | null;
  forwardOrigin: Record<string, unknown> | null;
  date: number | null;
  eventAt: number | null;
  deletedAt: number | null;
  lastEditedAt: number | null;
  mirror: { chatId: number; threadId: number | null; messageId: number } | null;
  edits?: EditView[];
}

export interface Cursor { k: number; id: number }

export interface ChatView {
  chatId: number;
  chatName: string | null;
  total: number;
  incoming: number;
  deleted: number;
  edited: number;
  media: number;
  lastAt: number | null;
  lastEventAt: number | null;
  muted: boolean;
  autoRead: boolean;
  excluded?: boolean;
  unread?: number;
  hasPhoto?: boolean;
}

export type NotifyType = 'deleted' | 'deletedUnknown' | 'edited' | 'oneTime' | 'keywords' | 'wipe' | 'rename';
export type MirrorGroup = 'photo' | 'video' | 'voice' | 'document';

export interface SettingsView {
  notificationsEnabled: boolean;
  notifyOwn: boolean;
  timezone: string;
  /** auto — с устройства; manual — выбран руками; null — ещё не задан. */
  tzSource: 'auto' | 'manual' | null;
  /** Язык интерфейса и бота; auto — по Telegram, manual — выбран в Настройках. */
  lang: 'ru' | 'en';
  langSource: 'auto' | 'manual';
  retentionDays: number | null;
  keywords: string[];
  readMode: 'off' | 'all' | 'chats';
  lockEnabled: boolean;
  lockMode: 'off' | 'biometric' | 'pin';
  hasPin: boolean;
  onboardedAt: number | null;
  lastSeenEventsAt: number | null;
  quietHours: { from: string; to: string } | null;
  notifyTypes: Record<NotifyType, boolean>;
  hidePreview: boolean;
  keywordWholeWord: boolean;
  keywordExclude: string[];
  keywordLoud: boolean;
  mirrorTypes: MirrorGroup[];
  mirrorMaxMb: number | null;
  autoLockMin: number | null;
  /** Удалить архив через N дней после отключения бота (null — не удалять). */
  purgeAfterDisconnectDays: number | null;
}

export interface Bootstrap {
  user: { id: number };
  bot: { username: string };
  connection: { connected: boolean; count: number; canReply: boolean };
  archive: { linked: boolean; chatId?: number; title?: string | null; status?: string; lostReason?: string | null };
  counts: { chats: number; deleted: number; edited: number; favorite: number; pendingMirror: number; failedMirror?: number; excludedChats?: number; unreadEvents?: number };
  settings: SettingsView;
  retentionChoices: (number | null)[];
  onboarded: boolean;
  jobs?: JobView[];
  version?: { version: string; commit: string };
  operator?: boolean;
  /** Подписка Stars; null — монетизация выключена, всё доступно. */
  plan?: PlanView | null;
}

export interface PlanView {
  plan: 'pro' | 'free'; status: 'trial' | 'active' | 'cancelled' | 'expired' | string; expiresAt: number | null;
  enabled: boolean; isRecurring: boolean; priceStars: number | null; trialDays: number;
  limits: { chats: number; retentionDays: number; exportFormats: string[]; exportMedia: boolean; pin: boolean } | null;
}

export interface OperatorView {
  stats: { owners: number; activeConnections: number; pendingMirror: number; failedMirror: number; outboxDepth: number; activeJobs: number; errors24h: number; messageRows: number; version: { version: string; commit: string; builtAt: string | null } };
  errors: { id: number; at: number; where: string; message: string | null; stack: string | null; ownerUserId: number | null }[];
}

export interface JobView { id: number; kind: 'media_export'; params: { chatId: number; group: string; deletedOnly: boolean }; done: number; total: number; status: string; error: string | null }

export interface DayStat { date: string; captured: number; deleted: number; edited: number }
export interface PeriodSums { captured: number; deleted: number; edited: number }

export interface StatsView {
  totals: { total: number; deleted: number; edited: number; favorite: number; media: number; incoming: number; chats: number };
  period: PeriodSums;
  prev: PeriodSums;
  activity: DayStat[];
  prevActivity: DayStat[];
  topChats: { chatId: number; chatName: string | null; deleted: number }[];
  media: { type: string; count: number; label: string }[];
  days: number;
  range: { from: number; to: number; prevFrom: number };
  chatId: number | null;
}

export interface Burst { chatId: number; chatName: string | null; at: number; count: number; firstId: number }

export interface InsightsView {
  days: number;
  heatmap: { deleted: number[][]; edited: number[][] };
  night: { night: number; total: number; share: number };
  ttd: { median: number | null; total: number; buckets: { label: string; count: number }[] };
  wipes: Burst[];
  regret: { chatId: number; chatName: string | null; incoming: number; deleted: number; share: number }[];
  editors: { chatId: number; chatName: string | null; edits: number; messages: number }[];
  rewritten: { id: number; chatId: number; chatName: string | null; editCount: number; text: string | null }[];
  balance: {
    chats: { chatId: number; chatName: string | null; incoming: number; outgoing: number; myReply: number | null; theirReply: number | null }[];
    myReply: number | null;
    theirReply: number | null;
  };
  words: { word: string; count: number }[];
  deletedByType: { type: string; total: number; deleted: number }[];
  records: {
    busiestDay: { date: string; count: number } | null;
    longestDeleted: { id: number; chatId: number; chatName: string | null; length: number; preview: string } | null;
    biggestBurst: Burst | null;
    longestStreak: { chatId: number; chatName: string | null; days: number; from: string; to: string } | null;
  };
  media: { voiceSec: number; videoSec: number; bytes: number; files: number; savedMedia: number; mirrored: number };
  truncated: boolean;
}
