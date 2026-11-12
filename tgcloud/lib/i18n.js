// Язык сообщений бота; словари RU и EN в конце файла
import { EndpointError } from 'sdk';

/** @typedef {'ru' | 'en'} Lang */
const ORDER = { ru: ['one', 'few', 'many'], en: ['one', 'other'] };
/** @type {Partial<Record<Lang, Intl.PluralRules>>} */
const rules = {};

/** @param {any} l @returns {Lang} */
export const normLang = (l) => (l === 'en' ? 'en' : 'ru');
/** @param {any} l */
export const localeOf = (l) => (normLang(l) === 'en' ? 'en-GB' : 'ru-RU');
/** @returns {Lang} */
export const langFromCode = (code) => (/^(ru|uk|be|kk)\b/i.test(String(code ?? '')) ? 'ru' : 'en');

/** @param {number} n @param {string} forms «a|b|c» @param {any} lang */
export function pluralForm(n, forms, lang) {
  const l = normLang(lang);
  const list = forms.split('|');
  const r = (rules[l] ??= new Intl.PluralRules(localeOf(l)));
  let cat = r.select(Math.abs(n));
  if (l === 'ru' && cat === 'other') cat = 'many';
  const i = ORDER[l].indexOf(cat);
  return list[i >= 0 ? i : list.length - 1] ?? list[0];
}

/** @param {string} tpl @param {Record<string, any>} params @param {any} lang */
export function format(tpl, params, lang) {
  return tpl.replace(/\{(\w+)(\|[^{}]*)?\}/g, (_m, name, forms) => {
    const v = params[name];
    if (forms) return pluralForm(Number(v ?? 0), forms.slice(1), lang);
    return v == null ? '' : String(v);
  });
}

/** @param {any} lang @param {string} key @param {Record<string, any>} [params] */
export function t(lang, key, params) {
  const l = normLang(lang);
  const tpl = DICTS[l][key] ?? DICTS.ru[key] ?? key;
  return params ? format(tpl, params, l) : tpl;
}

export { DICTS as dictionaries };

/**
 * description — по-русски, ключ и параметры в e.i18n:
 * authed и команды бота пересоберут текст на языке владельца.
 * @param {string} key @param {Record<string, any> | null} [params] @param {string} [code] @param {Record<string, any>} [extra] поля parameters
 */
export function endpointError(key, params, code, extra) {
  const e = /** @type {EndpointError & { i18n?: { key: string, params: Record<string, any> | null } }} */ (
    new EndpointError(t('ru', key, params ?? undefined), { ...(code ? { code } : {}), ...extra }));
  e.i18n = { key, params: params ?? null };
  return e;
}

/** @param {any} e @param {any} lang */
export function localizeError(e, lang) {
  if (!(e instanceof EndpointError) || !/** @type {any} */ (e).i18n) return e;
  const { key, params } = /** @type {any} */ (e).i18n;
  return new EndpointError(t(lang, key, params ?? undefined), e.parameters);
}

/** @param {any} e @param {any} lang */
export const errorText = (e, lang) => String(localizeError(e, lang)?.description ?? e?.description ?? e?.message ?? e);

// ── Словари
// Объявлены после функций: те читают DICTS только при вызове.

const RU = {
  // ── common
  'common.contact': 'Контакт',
  'common.openApp': '📂 Открыть приложение',
  // ── notify: уведомления бота
  'notify.forwarded': '<i>↪️ пересланное</i>',
  'notify.replyTo': '<i>↩️ в ответ на {who}{what}</i>',
  'notify.quote': '«{text}»',
  'notify.messageWord': 'сообщение',
  'notify.album': '🖼 Альбом · {n} {n|файл|файла|файлов}',
  'notify.noText': '[без текста]',
  'notify.empty': '[пусто]',
  'notify.hidden': '<i>Текст скрыт настройками — откройте в приложении</i>',
  'notify.missing': 'ещё {n} {n|сообщение|сообщения|сообщений} без копии — их нет в архиве (пришли до подключения)',

  'notify.deleted.one': '🗑 Удалено сообщение',
  'notify.deleted.many': '🗑 Удалено сообщений: {n}',
  'notify.burst': '🚨 Массовое удаление',
  'notify.more': 'Ещё {n}…',
  'notify.copySaved': 'копия сохранена в архиве',
  'notify.copySavedMissing': 'копия сохранена в архиве · {missing}',
  'notify.deletedN': '🗑 Удалено: {n}',
  'notify.unknown.one': 'этого сообщения нет в архиве — оно пришло до подключения бота или было удалено из архива.',
  'notify.unknown.many': 'этих сообщений нет в архиве — они пришли до подключения бота или были удалены из архива.',
  'notify.notStored': 'содержимое не сохранено',

  'notify.edited.title': '✏️ Сообщение изменено',
  'notify.edited.was': 'Было',
  'notify.edited.now': 'Стало',
  'notify.edited.at': 'изменено {time}',
  'notify.edited.noOriginal': '<i>прежняя версия не сохранена — сообщение пришло до подключения</i>',

  'notify.keyword.title': '🔔 Ключевое слово',
  'notify.keyword.hit': 'Совпало: {words}',

  'notify.oneTime.title': '🔥 Одноразовое сохранено',
  'notify.oneTime.footer': 'оригинал забэкаплен до открытия',

  'notify.connected.title': '✅ Подключено',
  'notify.connected.body': 'Сохраняю удалённые и изменённые сообщения из твоих личных чатов и присылаю уведомления сюда.',
  'notify.connected.li1': 'Ловятся только разрешённые чаты',
  'notify.connected.li2': 'Только с момента подключения',
  'notify.connected.li3': 'Данные видишь только ты',
  'notify.connected.footer': 'Открой приложение, чтобы настроить группу-архив и остальное',

  'notify.disconnected.title': '⛔️ Отключено',
  'notify.disconnected.purge': 'Бот убран из чат-ботов: новые события не сохраняются. По вашей настройке архив удалится через {days} {days|день|дня|дней}, если не подключить бота снова.',
  'notify.disconnected.keep': 'Бот убран из чат-ботов: новые события не сохраняются. Архив остаётся в приложении.',
  'notify.disconnected.footer': 'Подключить снова: {path}',

  'notify.purged.title': '🧹 Архив удалён',
  'notify.purged.body': 'Бот был отключён дольше срока из ваших настроек — все сохранённые сообщения и настройки удалены. Копии файлов в вашей группе-архиве остались.',

  'notify.rename.title': '🪪 Собеседник сменил имя',
  'notify.rename.hid': 'скрыл(а) @{u}',
  'notify.rename.footer': 'прежние имена видны в профиле собеседника',

  'notify.wipe.title': '🧹 Очищен весь чат',
  'notify.wipe.body': 'Собеседник удалил всю переписку «{name}».',
  'notify.wipe.thCount': 'Сообщений',
  'notify.wipe.thSaved': 'В архиве бота',
  'notify.wipe.saved': '✅ сохранено',
  'notify.wipe.file': 'Полный архив переписки (.txt)',
  'notify.wipe.noFile': 'Переписка сохранена — откройте её в приложении.',

  'notify.txt.title': 'Архив чата «{title}» — {n} {n|сообщение|сообщения|сообщений}',
  'notify.txt.edit': '    ✏️ правка: «{old}» → «{new}»',
  'notify.txt.deleted': '    🗑 удалено',
  'notify.txt.truncated': '…архив усечён',
  // ── commands: команды бота
  'cmd.start': 'Приветствие и кнопка приложения',
  'cmd.help': 'Что умеет бот',
  'cmd.app': 'Открыть приложение',
  'cmd.pause': 'Выключить уведомления',
  'cmd.resume': 'Включить уведомления',
  'cmd.mute': 'Заглушить чат (ответом на уведомление)',
  'cmd.unmute': 'Вернуть звук чату',
  'cmd.export': 'Выгрузить архив файлом: /export 7d csv',
  'cmd.stats': 'Сводка: /stats today | 7d | 30d',
  'cmd.settings': 'Текущие настройки',
  'cmd.pin_reset': 'Сбросить забытый PIN-код приложения',
  'cmd.delete_me': 'Удалить все мои данные из бота',
  'cmd.id': 'Мой Telegram id',

  'commands.help.title': 'Команды',
  'commands.help.footer': 'Всё остальное — в приложении: лента, переписки, поиск, статистика',
  'commands.app': 'Архив — в приложении:',
  'commands.id': 'Ваш Telegram id: <code>{id}</code>',
  'commands.pause.done': '⏸ Уведомления выключены. Архив продолжает сохраняться. Включить: /resume',
  'commands.resume.done': '▶️ Уведомления снова включены.',
  'commands.chatN': 'Чат {id}',
  'commands.mute.allMuted': 'Все недавние чаты уже без звука.',
  'commands.mute.none': 'Заглушённых чатов нет.',
  'commands.mute.askMute': 'Какой чат заглушить? Или ответьте командой на уведомление.',
  'commands.mute.askUnmute': 'Какой чат снова со звуком?',
  'commands.mute.already': 'Этот чат уже без звука.',
  'commands.unmute.already': 'У этого чата звук уже включён.',
  'commands.mute.done': '🔕 Чат заглушён — уведомлений по нему не будет.',
  'commands.unmute.done': '🔔 Уведомления по чату снова включены.',

  'commands.stats.today': 'Сегодня',
  'commands.stats.days': 'За {n} {n|день|дня|дней}',
  'commands.stats.new': 'Новых',
  'commands.stats.deleted': 'Удалено',
  'commands.stats.edits': 'Правок',
  'commands.stats.total': 'Всего в архиве: {total} {total|сообщение|сообщения|сообщений} в {chats} {chats|чате|чатах|чатах}',

  'commands.settings.title': '⚙️ Настройки',
  'commands.settings.notifications': 'Уведомления: <b>{state}</b>',
  'commands.settings.quiet': 'Тихие часы: <b>{value}</b>',
  'commands.settings.archive': 'Группа-архив: <b>{value}</b>',
  'commands.settings.keep': 'Хранить: <b>{ret}</b> · пояс <b>{tz}</b>',
  'commands.settings.footer': 'Изменить — в приложении',
  'commands.on': 'включены',
  'commands.off': 'выключены',
  'commands.none': 'нет',
  'commands.retDays': '{n} дн.',
  'commands.retAlways': 'всегда',
  'commands.archiveLinked': 'подключена',
  'commands.archiveLost': 'недоступна',
  'commands.archiveNone': 'не выбрана',

  'commands.pin.title': '🔑 Сбросить PIN?',
  'commands.pin.body': 'Замок приложения останется, но вместо PIN будет биометрия или кнопка «Открыть». Новый PIN можно задать в настройках.',
  'commands.pin.reset': 'Сбросить PIN',

  'commands.erase.title': '⚠️ Удалить все данные?',
  'commands.erase.body': 'Бот сотрёт все сохранённые сообщения, правки, настройки и подключение. Копии файлов в вашей группе-архиве останутся. Отменить нельзя.',
  'commands.erase.confirm': '🗑 Удалить всё',
  // ── export: выгрузка архива
  'export.dir.out': 'исходящее',
  'export.dir.in': 'входящее',
  'export.kind.text': 'текст',
  'export.yes': 'да',
  'export.fwd.user': 'пользователя',
  'export.fwd.hidden': 'скрытого отправителя',
  'export.fwd.chat': 'чата',
  'export.fwd.channel': 'канала',
  'export.mark.deleted': 'удалено',
  'export.mark.oneTime': 'одноразовое',
  'export.mark.favorite': 'избранное',
  'export.mark.forwarded': 'переслано от {who}',
  'export.mark.replyTo': 'в ответ на «{text}»',
  'export.editLine': '«{old}» → «{new}»',
  // Заголовки колонок CSV и HTML-таблицы: список через «|».
  'export.csv.head': 'Дата|Чат|Отправитель|@username|Направление|Тип|Текст|Удалено|Удалено в|Одноразовое|Избранное|Ответ на|Переслано от|Правки|Копия в группе',
  'export.html.th': 'Дата|Чат|Отправитель|Тип|Текст и правки|Пометки',
  'export.html.count': 'Сообщений: <b>{n}</b>. Часовой пояс: <code>{tz}</code>.',
  'export.html.copy': 'копия в группе',
  'export.md.count': 'Сообщений: **{n}**',
  'export.md.me': ' (я)',
  'export.md.copy': 'копия',
  'export.title': 'Архив сообщений',
  'export.titleChat': 'Архив · {name}',
  'export.part': ' · часть {page} из {planned}',
  'export.caption': '📤 {title} · {n} {n|событие|события|событий} · {format}{tail}',
  'export.truncated': 'Выгружены самые свежие {max} из {total} сообщений. Остальное — выгрузкой за более ранний период.',
  // ── admin: оператор
  'cmd.admin': 'Сводка для оператора',
  'cmd.paysupport': 'Вопросы по оплате',
  'admin.title': '🛠 Оператор',
  'admin.owners': 'Владельцев',
  'admin.connections': 'Активных подключений',
  'admin.mirror': 'Копий в очереди / не скопировано',
  'admin.outbox': 'Очередь уведомлений',
  'admin.jobs': 'Фоновых задач',
  'admin.errors24': 'Ошибок за 24 ч',
  'admin.rows': 'Строк в messages',
  'admin.version': 'Версия',
  'admin.noErrors': 'Ошибок нет.',
  'admin.paysupport.title': '⭐ Вопросы по оплате',
  'admin.paysupport.price': 'Подписка Pro — {price} ⭐ за 30 дней, продлевается сама; отменить можно в любой момент в приложении (Настройки → Подписка), оплаченный срок сохраняется. ',
  'admin.paysupport.free': 'Сейчас бот бесплатный. ',
  'admin.paysupport.contact': 'По вопросам оплаты и возврата пишите {contact}.',
  'admin.paysupport.noContact': 'Контакт для вопросов по оплате оператор ещё не указал.',
  // ── plans: тарифы и Stars
  'plans.limit.title': '⭐ Лимит бесплатного тарифа',
  'plans.limit.body': 'Бесплатно архивируются {n} {n|чат|чата|чатов} — новые чаты сверх них не сохраняются. Сохранённое никуда не делось. Pro снимает лимит.',
  'plans.invoice.title': 'Архив Pro',
  'plans.invoice.description': 'Без лимитов: все чаты, любой срок хранения, экспорт в любом формате, файлы чатов, PIN-код.',
  'plans.invoice.label': 'Pro на 30 дней',
  'plans.pre.notSold': 'Подписка сейчас не продаётся.',
  'plans.pre.stale': 'Счёт устарел — откройте «Подписку» в приложении ещё раз.',
  'plans.pre.priceChanged': 'Цена изменилась — откройте «Подписку» в приложении ещё раз.',
  'plans.paid.title': '⭐ Pro активен',
  'plans.paid.body': 'Спасибо! Подписка действует до {until} и продлевается сама. Отменить — в приложении: Настройки → Подписка.',
  // ── bot: прочее в боте
  'bot.connectPath': 'Настройки → Аккаунт → Автоматизация чатов',
  'bot.clamped': '…показана часть — остальное в приложении',

  'kb.openEvent': '📂 Открыть в приложении',
  'kb.openChat': '📂 Открыть чат',
  'kb.favorite': '⭐️ В избранное',
  'kb.unmute': '🔔 Включить звук',
  'kb.mute': '🔕 Заглушить',
  'kb.muteChat': '🔕 Заглушить чат',
  'kb.reply': '↩️ Ответить',
  'kb.fromArchive': '🗑 Из архива',
  'kb.confirmDelete': '✅ Удалить из архива',
  'kb.cancel': 'Отмена',

  'bot.cb.eventNotFound': 'Событие не найдено',
  'bot.cb.favOn': '⭐️ В избранном',
  'bot.cb.favOff': 'Убрано из избранного',
  'bot.cb.muteOn': '🔕 Чат заглушён',
  'bot.cb.muteOff': '🔔 Звук включён',
  'bot.cb.pinKeep': 'PIN не изменён',
  'bot.cb.pinReset': 'PIN сброшен',
  'bot.cb.cancelled': 'Отменено',
  'bot.cb.erased': 'Данные удалены',
  'bot.cb.erasedMsg': 'Готово: удалено сообщений — {removed}. Чтобы бот перестал видеть чаты, уберите его в «{path}».',
  'bot.cb.alreadyDeleted': 'Событие уже удалено',
  'bot.cb.deletedFromArchive': 'Удалено из архива',

  'bot.hint.title': '👁 Архив',
  'bot.hint.body': 'Открой приложение — там лента, чаты, поиск и настройки. Команды — /help.',
  'bot.hint.footer': 'Подключение бота: {path}',

  'bot.cap.deleted': '🗑 удалено',
  'bot.cap.edited': '✏️ изменено',
  'bot.cap.oneTime': '🔥 Одноразовое',
  'bot.chatN': 'Чат {id}',
  'bot.chatLower': 'чат {id}',
  'bot.share.you': 'Вы',
  'bot.share.contact': 'Собеседник',
  'bot.share.deleted': 'удалено',
  'bot.share.noText': 'Сообщение без текста',
  'bot.pickArchive': 'Выбрать группу-архив',

  'bot.jobs.start': '📦 Пришлю все файлы чата «{title}» — {total}. Telegram пускает около 20 сообщений в минуту, поэтому они придут постепенно.',
  'bot.jobs.done': '✅ Готово: прислано файлов — {n}.',

  'insights.ttd.s10': 'до 10 секунд',
  'insights.ttd.m1': 'до минуты',
  'insights.ttd.m10': 'до 10 минут',
  'insights.ttd.h1': 'до часа',
  'insights.ttd.d1': 'до суток',
  'insights.ttd.w1': 'до недели',
  'insights.ttd.over': 'дольше недели',

  'unit.b': 'Б',
  'unit.kb': 'КБ',
  'unit.mb': 'МБ',
  // ── errors: отказы endpoint и уведомление оператору
  'err.unauthorized': 'Не удалось определить пользователя',
  'err.chatNotFound': 'Чат не найден',
  'err.eventNotFound': 'Событие не найдено',
  'err.notFound': 'Не найдено',
  'err.rateLimited': 'Слишком часто — подождите {s} с',
  'err.emptyPeriod': 'За выбранный период ничего нет',
  'err.badRange': 'Начало периода позже конца',
  'err.noFile': 'У события нет файла',
  'err.cantForward': 'Этот тип нельзя переслать',
  'err.fileExpired': 'Файл недоступен (ссылка устарела)',
  'err.pinFormat': 'PIN — от 4 до 6 цифр',
  'err.pinCurrentWrong': 'Текущий PIN неверный',
  'err.pinWrong': 'PIN неверный',
  'err.badAction': 'Неизвестное действие',
  'err.noEventId': 'Нет id события',
  'err.noPhoto': 'Фото нет',
  'err.photoUnavailable': 'Фото недоступно',
  'err.fileNotFound': 'Файл не найден',
  'err.noPreview': 'Для этого типа нет превью',
  'err.fileTooBigView': 'Файл слишком большой для просмотра в приложении',
  'err.removePinFirst': 'Сначала снимите PIN',
  'err.badLock': 'Неизвестный замок',
  'err.badTz': 'Неизвестный часовой пояс',
  'err.badRetention': 'Недопустимый срок хранения',
  'err.badReadMode': 'Неизвестный режим прочтения',
  'err.badQuiet': 'Неверные тихие часы',
  'err.badMirrorLimit': 'Недопустимый лимит размера',
  'err.badAutoLock': 'Недопустимая автоблокировка',
  'err.badPurge': 'Недопустимый срок',
  'err.confirmRequired': 'Нужно подтверждение',
  'err.badPeriod': 'Неизвестный период',
  'err.noReadRight': 'Нет права отмечать прочитанным',
  'err.tgDenied': 'Telegram отказал',
  'err.noMoment': 'Нет момента',
  'err.busy': 'Уже присылаю файлы — дождитесь или отмените',
  'err.noFilesInChat': 'В этом чате нет файлов',
  'err.tooLong': 'Слишком длинно',
  'err.fileBroken': 'Файл повреждён',
  'err.fileEmpty': 'Пустой файл',
  'err.fileOver5': 'Файл больше 5 МБ',
  'err.emptyMessage': 'Пустое сообщение',
  'err.captionTooLong': 'Подпись к файлу — до 1024 символов',
  'err.noReplyRight': 'Нет права отвечать (включи «Чат-боты → разрешить отвечать»)',
  'err.tgRejectedReply': 'Telegram не принял ответ (возможно, прошло больше 24 часов с последнего входящего)',
  'err.badDate': 'Не понял дату',
  'err.notSold': 'Подписка сейчас не продаётся',
  'err.noSubscription': 'Активной подписки нет',
  'err.planRetention': 'На бесплатном тарифе архив хранится до {days} дней',
  'err.planExportFormat': 'На бесплатном тарифе экспорт — только в JSON',
  'err.planExportMedia': 'Выгрузка файлов чата — в Pro',
  'err.planPin': 'PIN-код — в Pro',

  'report.owner': 'Владелец: <code>{id}</code>',
  'report.next': 'Следующее такое же — не раньше чем через час. Все ошибки: /admin.',
  // ── media: типы содержимого
  'media.photo': '📷 Фото',
  'media.live_photo': '📸 Живое фото',
  'media.video': '🎬 Видео',
  'media.animation': '🎞 GIF',
  'media.audio': '🎵 Аудио',
  'media.voice': '🎤 Голосовое',
  'media.video_note': '📹 Кружок',
  'media.document': '📄 Файл',
  'media.sticker': '🩷 Стикер',
  'media.paid_media': '⭐️ Платное медиа',
  'media.story': '📖 История',
  'media.contact': '👤 Контакт',
  'media.location': '📍 Геопозиция',
  'media.venue': '🏷 Место',
  'media.poll': '📊 Опрос',
  'media.dice': '🎲 Кубик',
  'media.checklist': '☑️ Чеклист',
  'media.gift': '🎁 Подарок',
  'media.unique_gift': '🎁 Уникальный подарок',
  'media.game': '🎮 Игра',
  'media.invoice': '🧾 Счёт',
  'media.rich_message': '📰 Rich-сообщение',
};

const EN = {
  // ── common
  'common.contact': 'Contact',
  'common.openApp': '📂 Open the app',
  // ── notify: bot notifications
  'notify.forwarded': '<i>↪️ forwarded</i>',
  'notify.replyTo': '<i>↩️ in reply to {who}{what}</i>',
  'notify.quote': '“{text}”',
  'notify.messageWord': 'a message',
  'notify.album': '🖼 Album · {n} {n|file|files}',
  'notify.noText': '[no text]',
  'notify.empty': '[empty]',
  'notify.hidden': '<i>Text is hidden by your settings — open it in the app</i>',
  'notify.missing': '{n} more {n|message|messages} without a copy — not in the archive (sent before the bot was connected)',

  'notify.deleted.one': '🗑 Message deleted',
  'notify.deleted.many': '🗑 Messages deleted: {n}',
  'notify.burst': '🚨 Mass deletion',
  'notify.more': '{n} more…',
  'notify.copySaved': 'a copy is saved in the archive',
  'notify.copySavedMissing': 'a copy is saved in the archive · {missing}',
  'notify.deletedN': '🗑 Deleted: {n}',
  'notify.unknown.one': 'this message is not in the archive — it was sent before the bot was connected or was deleted from the archive.',
  'notify.unknown.many': 'these messages are not in the archive — they were sent before the bot was connected or were deleted from the archive.',
  'notify.notStored': 'content not saved',

  'notify.edited.title': '✏️ Message edited',
  'notify.edited.was': 'Before',
  'notify.edited.now': 'After',
  'notify.edited.at': 'edited {time}',
  'notify.edited.noOriginal': '<i>the previous version is not saved — the message was sent before the bot was connected</i>',

  'notify.keyword.title': '🔔 Keyword',
  'notify.keyword.hit': 'Matched: {words}',

  'notify.oneTime.title': '🔥 View-once media saved',
  'notify.oneTime.footer': 'the original was backed up before it was opened',

  'notify.connected.title': '✅ Connected',
  'notify.connected.body': 'I save deleted and edited messages from your private chats and send notifications here.',
  'notify.connected.li1': 'Only the chats you allow are captured',
  'notify.connected.li2': 'Only from the moment of connection',
  'notify.connected.li3': 'Only you can see your data',
  'notify.connected.footer': 'Open the app to set up the archive group and more',

  'notify.disconnected.title': '⛔️ Disconnected',
  'notify.disconnected.purge': 'The bot was removed from chatbots: new events are not saved. According to your settings the archive will be deleted in {days} {days|day|days} unless you connect the bot again.',
  'notify.disconnected.keep': 'The bot was removed from chatbots: new events are not saved. The archive stays in the app.',
  'notify.disconnected.footer': 'Connect again: {path}',

  'notify.purged.title': '🧹 Archive deleted',
  'notify.purged.body': 'The bot stayed disconnected longer than the period in your settings — all saved messages and settings have been deleted. File copies in your archive group remain.',

  'notify.rename.title': '🪪 Your contact changed their name',
  'notify.rename.hid': 'hid @{u}',
  'notify.rename.footer': "the previous names are visible in the contact's profile",

  'notify.wipe.title': '🧹 Entire chat cleared',
  'notify.wipe.body': 'Your contact deleted the whole conversation “{name}”.',
  'notify.wipe.thCount': 'Messages',
  'notify.wipe.thSaved': 'In the bot archive',
  'notify.wipe.saved': '✅ saved',
  'notify.wipe.file': 'Full conversation archive (.txt)',
  'notify.wipe.noFile': 'The conversation is saved — open it in the app.',

  'notify.txt.title': 'Chat archive “{title}” — {n} {n|message|messages}',
  'notify.txt.edit': '    ✏️ edit: “{old}” → “{new}”',
  'notify.txt.deleted': '    🗑 deleted',
  'notify.txt.truncated': '…archive truncated',
  // ── commands: bot commands
  'cmd.start': 'Welcome and the app button',
  'cmd.help': 'What the bot can do',
  'cmd.app': 'Open the app',
  'cmd.pause': 'Turn notifications off',
  'cmd.resume': 'Turn notifications on',
  'cmd.mute': 'Mute a chat (reply to a notification)',
  'cmd.unmute': 'Unmute a chat',
  'cmd.export': 'Export the archive as a file: /export 7d csv',
  'cmd.stats': 'Summary: /stats today | 7d | 30d',
  'cmd.settings': 'Current settings',
  'cmd.pin_reset': 'Reset a forgotten app PIN',
  'cmd.delete_me': 'Delete all my data from the bot',
  'cmd.id': 'My Telegram id',

  'commands.help.title': 'Commands',
  'commands.help.footer': 'Everything else is in the app: feed, conversations, search, statistics',
  'commands.app': 'The archive is in the app:',
  'commands.id': 'Your Telegram id: <code>{id}</code>',
  'commands.pause.done': '⏸ Notifications are off. The archive keeps saving. Turn them back on: /resume',
  'commands.resume.done': '▶️ Notifications are on again.',
  'commands.chatN': 'Chat {id}',
  'commands.mute.allMuted': 'All recent chats are already muted.',
  'commands.mute.none': 'There are no muted chats.',
  'commands.mute.askMute': 'Which chat to mute? Or reply to a notification with the command.',
  'commands.mute.askUnmute': 'Which chat should get its sound back?',
  'commands.mute.already': 'This chat is already muted.',
  'commands.unmute.already': 'This chat already has sound.',
  'commands.mute.done': '🔕 Chat muted — no notifications from it.',
  'commands.unmute.done': '🔔 Notifications for this chat are on again.',

  'commands.stats.today': 'Today',
  'commands.stats.days': 'Last {n} {n|day|days}',
  'commands.stats.new': 'New',
  'commands.stats.deleted': 'Deleted',
  'commands.stats.edits': 'Edits',
  'commands.stats.total': 'In the archive: {total} {total|message|messages} in {chats} {chats|chat|chats}',

  'commands.settings.title': '⚙️ Settings',
  'commands.settings.notifications': 'Notifications: <b>{state}</b>',
  'commands.settings.quiet': 'Quiet hours: <b>{value}</b>',
  'commands.settings.archive': 'Archive group: <b>{value}</b>',
  'commands.settings.keep': 'Keep: <b>{ret}</b> · time zone <b>{tz}</b>',
  'commands.settings.footer': 'Change them in the app',
  'commands.on': 'on',
  'commands.off': 'off',
  'commands.none': 'none',
  'commands.retDays': '{n} days',
  'commands.retAlways': 'forever',
  'commands.archiveLinked': 'connected',
  'commands.archiveLost': 'unavailable',
  'commands.archiveNone': 'not selected',

  'commands.pin.title': '🔑 Reset the PIN?',
  'commands.pin.body': 'The app lock stays, but instead of a PIN it will use biometrics or an “Open” button. You can set a new PIN in settings.',
  'commands.pin.reset': 'Reset PIN',

  'commands.erase.title': '⚠️ Delete all data?',
  'commands.erase.body': 'The bot will erase all saved messages, edits, settings and the connection. File copies in your archive group will stay. This cannot be undone.',
  'commands.erase.confirm': '🗑 Delete everything',
  // ── export: archive export
  'export.dir.out': 'outgoing',
  'export.dir.in': 'incoming',
  'export.kind.text': 'text',
  'export.yes': 'yes',
  'export.fwd.user': 'a user',
  'export.fwd.hidden': 'a hidden sender',
  'export.fwd.chat': 'a chat',
  'export.fwd.channel': 'a channel',
  'export.mark.deleted': 'deleted',
  'export.mark.oneTime': 'view-once',
  'export.mark.favorite': 'favorite',
  'export.mark.forwarded': 'forwarded from {who}',
  'export.mark.replyTo': 'in reply to “{text}”',
  'export.editLine': '“{old}” → “{new}”',
  // Column headings of the CSV and the HTML table: a list separated by "|".
  'export.csv.head': 'Date|Chat|Sender|@username|Direction|Type|Text|Deleted|Deleted at|View-once|Favorite|Reply to|Forwarded from|Edits|Copy in group',
  'export.html.th': 'Date|Chat|Sender|Type|Text and edits|Marks',
  'export.html.count': 'Messages: <b>{n}</b>. Time zone: <code>{tz}</code>.',
  'export.html.copy': 'copy in group',
  'export.md.count': 'Messages: **{n}**',
  'export.md.me': ' (me)',
  'export.md.copy': 'copy',
  'export.title': 'Message archive',
  'export.titleChat': 'Archive · {name}',
  'export.part': ' · part {page} of {planned}',
  'export.caption': '📤 {title} · {n} {n|event|events} · {format}{tail}',
  'export.truncated': 'Exported the latest {max} of {total} messages. For the rest, export an earlier period.',
  // ── admin: operator
  'cmd.admin': 'Operator summary',
  'cmd.paysupport': 'Payment questions',
  'admin.title': '🛠 Operator',
  'admin.owners': 'Owners',
  'admin.connections': 'Active connections',
  'admin.mirror': 'Copies queued / not copied',
  'admin.outbox': 'Notification queue',
  'admin.jobs': 'Background jobs',
  'admin.errors24': 'Errors in 24 h',
  'admin.rows': 'Rows in messages',
  'admin.version': 'Version',
  'admin.noErrors': 'No errors.',
  'admin.paysupport.title': '⭐ Payment questions',
  'admin.paysupport.price': 'Pro subscription — {price} ⭐ per 30 days, renews automatically; you can cancel at any time in the app (Settings → Subscription) and the paid period stays. ',
  'admin.paysupport.free': 'The bot is free right now. ',
  'admin.paysupport.contact': 'For payment and refund questions, write to {contact}.',
  'admin.paysupport.noContact': 'The operator has not provided a payment support contact yet.',
  // ── plans: plans and Stars
  'plans.limit.title': '⭐ Free plan limit reached',
  'plans.limit.body': 'The free plan archives {n} {n|chat|chats} — new chats beyond that are not saved. Everything already saved is still there. Pro removes the limit.',
  'plans.invoice.title': 'Archive Pro',
  'plans.invoice.description': 'No limits: all chats, any retention period, export in any format, chat files, PIN code.',
  'plans.invoice.label': 'Pro for 30 days',
  'plans.pre.notSold': 'The subscription is not on sale right now.',
  'plans.pre.stale': 'This invoice is out of date — open “Subscription” in the app again.',
  'plans.pre.priceChanged': 'The price has changed — open “Subscription” in the app again.',
  'plans.paid.title': '⭐ Pro is active',
  'plans.paid.body': 'Thank you! Your subscription is valid until {until} and renews automatically. To cancel, go to the app: Settings → Subscription.',
  // ── bot: other bot texts
  'bot.connectPath': 'Settings → Account → Chat Automation',
  'bot.clamped': '…showing part of it — the rest is in the app',

  'kb.openEvent': '📂 Open in the app',
  'kb.openChat': '📂 Open chat',
  'kb.favorite': '⭐️ Favorite',
  'kb.unmute': '🔔 Unmute',
  'kb.mute': '🔕 Mute',
  'kb.muteChat': '🔕 Mute chat',
  'kb.reply': '↩️ Reply',
  'kb.fromArchive': '🗑 Delete from archive',
  'kb.confirmDelete': '✅ Delete from archive',
  'kb.cancel': 'Cancel',

  'bot.cb.eventNotFound': 'Event not found',
  'bot.cb.favOn': '⭐️ Added to favorites',
  'bot.cb.favOff': 'Removed from favorites',
  'bot.cb.muteOn': '🔕 Chat muted',
  'bot.cb.muteOff': '🔔 Sound is on',
  'bot.cb.pinKeep': 'PIN unchanged',
  'bot.cb.pinReset': 'PIN reset',
  'bot.cb.cancelled': 'Cancelled',
  'bot.cb.erased': 'Data deleted',
  'bot.cb.erasedMsg': 'Done: messages deleted — {removed}. To stop the bot from seeing your chats, remove it in “{path}”.',
  'bot.cb.alreadyDeleted': 'The event is already deleted',
  'bot.cb.deletedFromArchive': 'Deleted from the archive',

  'bot.hint.title': '👁 Archive',
  'bot.hint.body': 'Open the app — it has the feed, chats, search and settings. Commands — /help.',
  'bot.hint.footer': 'Connecting the bot: {path}',

  'bot.cap.deleted': '🗑 deleted',
  'bot.cap.edited': '✏️ edited',
  'bot.cap.oneTime': '🔥 View-once',
  'bot.chatN': 'Chat {id}',
  'bot.chatLower': 'chat {id}',
  'bot.share.you': 'You',
  'bot.share.contact': 'Contact',
  'bot.share.deleted': 'deleted',
  'bot.share.noText': 'Message without text',
  'bot.pickArchive': 'Choose the archive group',

  'bot.jobs.start': '📦 I will send all files from the chat “{title}” — {total}. Telegram allows about 20 messages per minute, so they will arrive gradually.',
  'bot.jobs.done': '✅ Done: files sent — {n}.',

  'insights.ttd.s10': 'under 10 seconds',
  'insights.ttd.m1': 'under a minute',
  'insights.ttd.m10': 'under 10 minutes',
  'insights.ttd.h1': 'under an hour',
  'insights.ttd.d1': 'under a day',
  'insights.ttd.w1': 'under a week',
  'insights.ttd.over': 'over a week',

  'unit.b': 'B',
  'unit.kb': 'KB',
  'unit.mb': 'MB',
  // ── errors: endpoint refusals and operator notice
  'err.unauthorized': 'Could not identify the user',
  'err.chatNotFound': 'Chat not found',
  'err.eventNotFound': 'Event not found',
  'err.notFound': 'Not found',
  'err.rateLimited': 'Too many requests — wait {s} s',
  'err.emptyPeriod': 'Nothing found for the selected period',
  'err.badRange': 'The period starts after it ends',
  'err.noFile': 'This event has no file',
  'err.cantForward': "This type can't be forwarded",
  'err.fileExpired': 'The file is unavailable (the link has expired)',
  'err.pinFormat': 'The PIN must be 4 to 6 digits',
  'err.pinCurrentWrong': 'The current PIN is incorrect',
  'err.pinWrong': 'Incorrect PIN',
  'err.badAction': 'Unknown action',
  'err.noEventId': 'Missing event id',
  'err.noPhoto': 'No photo',
  'err.photoUnavailable': 'The photo is unavailable',
  'err.fileNotFound': 'File not found',
  'err.noPreview': 'This type has no preview',
  'err.fileTooBigView': 'The file is too large to view in the app',
  'err.removePinFirst': 'Remove the PIN first',
  'err.badLock': 'Unknown lock mode',
  'err.badTz': 'Unknown time zone',
  'err.badRetention': 'Invalid retention period',
  'err.badReadMode': 'Unknown read mode',
  'err.badQuiet': 'Invalid quiet hours',
  'err.badMirrorLimit': 'Invalid size limit',
  'err.badAutoLock': 'Invalid auto-lock',
  'err.badPurge': 'Invalid period',
  'err.confirmRequired': 'Confirmation required',
  'err.badPeriod': 'Unknown period',
  'err.noReadRight': 'No permission to mark messages as read',
  'err.tgDenied': 'Telegram refused',
  'err.noMoment': 'Missing timestamp',
  'err.busy': 'Already sending files — wait or cancel',
  'err.noFilesInChat': 'There are no files in this chat',
  'err.tooLong': 'Too long',
  'err.fileBroken': 'The file is corrupted',
  'err.fileEmpty': 'The file is empty',
  'err.fileOver5': 'The file is larger than 5 MB',
  'err.emptyMessage': 'Empty message',
  'err.captionTooLong': 'The caption can be up to 1024 characters',
  'err.noReplyRight': 'No permission to reply (turn on “Chatbots → allow replies”)',
  'err.tgRejectedReply': 'Telegram did not accept the reply (it may have been more than 24 hours since the last incoming message)',
  'err.badDate': "Couldn't understand the date",
  'err.notSold': 'The subscription is not on sale right now',
  'err.noSubscription': 'There is no active subscription',
  'err.planRetention': 'On the free plan the archive is kept for up to {days} days',
  'err.planExportFormat': 'On the free plan, export is JSON only',
  'err.planExportMedia': 'Exporting chat files is a Pro feature',
  'err.planPin': 'PIN code is a Pro feature',

  'report.owner': 'Owner: <code>{id}</code>',
  'report.next': 'The next identical one — no sooner than in an hour. All errors: /admin.',
  // ── media: content types
  'media.photo': '📷 Photo',
  'media.live_photo': '📸 Live photo',
  'media.video': '🎬 Video',
  'media.animation': '🎞 GIF',
  'media.audio': '🎵 Audio',
  'media.voice': '🎤 Voice message',
  'media.video_note': '📹 Video message',
  'media.document': '📄 File',
  'media.sticker': '🩷 Sticker',
  'media.paid_media': '⭐️ Paid media',
  'media.story': '📖 Story',
  'media.contact': '👤 Contact',
  'media.location': '📍 Location',
  'media.venue': '🏷 Venue',
  'media.poll': '📊 Poll',
  'media.dice': '🎲 Dice',
  'media.checklist': '☑️ Checklist',
  'media.gift': '🎁 Gift',
  'media.unique_gift': '🎁 Unique gift',
  'media.game': '🎮 Game',
  'media.invoice': '🧾 Invoice',
  'media.rich_message': '📰 Rich message',
};

/** @type {Record<Lang, Record<string, string>>} */
const DICTS = { ru: RU, en: EN };
