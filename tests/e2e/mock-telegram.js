(function () {
  const F = window.__FIXTURES;
  const now = Date.now();
  const ago = (m) => (m == null ? null : now - m * 60_000);
  const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const esc = (t) => (t == null ? null : String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

  const event = (e) => ({
    chatId: 555, chatName: null, senderId: null, senderName: null, isOutgoing: false, status: 'plain', isDeleted: false,
    isFavorite: false, oneTime: false, editCount: 0, text: null, caption: null, mediaType: null, mediaLabel: null,
    fileSize: null, fileName: null, hasThumb: false, previewable: false, mediaMeta: null, albumCount: 1, reply: null,
    forwardOrigin: null, deletedAt: ago(e.deletedAgoMin), lastEditedAt: ago(e.lastEditedAgoMin), mirror: null,
    ...e, html: e.html ?? esc(e.text ?? e.caption), date: ago(e.agoMin), eventAt: ago(e.eventAgoMin ?? e.agoMin),
    edits: (e.edits ?? []).map((x) => ({ ...x, editedAt: ago(x.editedAgoMin) })),
  });
  const events = F.events.map(event);

  const history = [];
  for (let i = 0; i < 120; i++) {
    history.push(event({ id: 1000 + i, chatId: 555, senderName: i % 2 ? 'Вы' : 'Иван Петров', isOutgoing: i % 2 === 1, text: `Сообщение №${i + 1}`, agoMin: 400 - i * 2 }));
  }
  history.push(...events.filter((e) => e.chatId === 555));
  history.sort((a, b) => a.date - b.date || a.id - b.id);

  const state = { boot: structuredClone(F.bootstrap), settings: structuredClone(F.bootstrap.settings), deletedChats: new Set() };
  const liveChats = () => F.chats.filter((c) => !state.deletedChats.has(c.chatId));
  if (F.onboarded) { state.boot.onboarded = true; state.settings.onboardedAt = now; }
  window.__calls = [];

  const filters = { deleted: (e) => e.isDeleted, edited: (e) => e.editCount > 0, media: (e) => !!e.mediaType, favorite: (e) => e.isFavorite };
  const ENDPOINTS = {
    bootstrap: () => ({ ...state.boot, settings: state.settings }),
    settings: (i) => {
      if (i.markOnboarded) { state.boot.onboarded = true; state.settings.onboardedAt = now; }
      for (const [k, v] of Object.entries(i)) if (k in state.settings) state.settings[k] = v;
      return { settings: state.settings };
    },
    feed: (i) => {
      const list = events.filter((e) => i.kind === 'deleted' ? e.isDeleted : i.kind === 'edited' ? e.editCount > 0 : true);
      return i.since ? { items: [], next: null, live: true } : { items: list, next: null, total: list.length };
    },
    event: (i) => {
      const e = events.find((x) => x.id === i.id) ?? history.find((x) => x.id === i.id);
      if (!e) throw { message: 'Событие не найдено', type: 'ENDPOINT_ERROR', parameters: { code: 'NOT_FOUND' } };
      return { event: e, edits: e.edits ?? [], album: null };
    },
    chats: () => ({ items: liveChats().map((c) => ({ ...c, lastAt: ago(c.lastAgoMin), lastEventAt: ago(c.lastAgoMin) })), total: liveChats().length, offset: 0, limit: 50 }),
    chatHistory: (i) => {
      const chat = F.chats.find((c) => c.chatId === i.chatId);
      let list = (i.chatId === 555 ? history : events.filter((e) => e.chatId === i.chatId)).filter(filters[i.filter] ?? (() => true));
      const limit = i.limit ?? 50;
      let page, hasOlder;
      if (i.before) {
        const idx = list.findIndex((e) => e.id === i.before.id);
        page = list.slice(Math.max(0, idx - limit), idx);
        hasOlder = idx - limit > 0;
      } else {
        page = list.slice(-limit);
        hasOlder = list.length > limit;
      }
      return { chatId: i.chatId, chatName: chat?.chatName ?? null, muted: false, autoRead: false, replyWindowOpen: true, replyWindowUntil: null, items: page, hasOlder, hasNewer: false };
    },
    file: () => ({ dataUrl: PIXEL, mime: 'image/png' }),
    stats: () => ({ activity: [] }),
    insights: () => ({ night: { total: 0, share: 0 }, ttd: { total: 0, median: 0 }, balance: { chats: [], theirReply: null, myReply: null }, heatmap: { deleted: [] } }),
    contact: (i) => {
      const c = F.chats.find((x) => x.chatId === i.chatId);
      return {
        chatId: i.chatId, chatName: c?.chatName ?? null, senderId: i.chatId, total: c?.total ?? 0, incoming: c?.incoming ?? 0,
        deleted: c?.deleted ?? 0, edited: c?.edited ?? 0, media: c?.media ?? 0, firstAt: ago(500), lastAt: ago(c?.lastAgoMin),
        names: [c?.chatName].filter(Boolean), usernames: [], username: null, hasPhoto: false, muted: false, autoRead: false, excluded: false,
      };
    },
    action: (i) => {
      const c = F.chats.find((x) => x.chatId === i.chatId);
      if (i.type === 'chatDeleteCounts') return { counts: { today: 2, last3d: 10, all: c?.total ?? 0 }, archiveTopic: i.chatId === 555 };
      if (i.type === 'deleteChat') { state.deletedChats.add(i.chatId); return { removed: c?.total ?? 0, archive: i.archive ? 'deleted' : 'none' }; }
      return { ok: true };
    },
  };

  const noop = () => {};
  window.Telegram = {
    WebApp: {
      initData: 'query_id=e2e&user=%7B%22id%22%3A7%7D', initDataUnsafe: { user: { id: 7, first_name: 'Тест', language_code: F.lang === 'en' ? 'en' : 'ru' } },
      colorScheme: 'light', themeParams: {}, viewportStableHeight: 800, isExpanded: true, version: '9.1', platform: 'tdesktop',
      BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
      HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
      // BiometricManager нет — как в Telegram Desktop.
      Serverless: {
        call(name, input, cb) {
          if (typeof input === 'function') { cb = input; input = {}; }
          window.__calls.push({ name, input: input ?? {} });
          setTimeout(() => {
            try {
              const fn = ENDPOINTS[name];
              cb(null, fn ? fn(input ?? {}) : {});
            } catch (err) { cb(err); }
          }, 30);
        },
      },
      isVersionAtLeast: () => true,
      ready: noop, expand: noop, close: noop, disableVerticalSwipes: noop,
      showAlert: (_m, cb) => cb && cb(),
      showConfirm: (_m, cb) => cb(true),
      showPopup: (_p, cb) => cb && cb('ok'),
      openLink: noop, openTelegramLink: noop,
      onEvent: noop, offEvent: noop, setHeaderColor: noop, setBackgroundColor: noop, setBottomBarColor: noop,
    },
  };
})();
