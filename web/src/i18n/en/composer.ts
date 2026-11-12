import type { Translation } from '../ru';
import type { composer as ru } from '../ru/composer';

export const composer: Translation<typeof ru> = {
  'composer.tooLarge': 'The file is over 5 MB — it can’t be sent from the app',
  'composer.attach.title': 'Attach',
  'composer.attach.device': 'File from device',
  'composer.attach.deviceHint': 'Photo, video or document up to 5 MB',
  'composer.attach.archive': 'From this chat’s archive',
  'composer.attach.archiveHint': 'No size limit — sent through Telegram',
  'composer.sent': 'Message sent',
  'composer.closed': 'Can’t reply: this contact hasn’t written in over 24 hours. Telegram only lets a bot reply within a day.',
  'composer.closedUntil': 'Can’t reply: this contact hasn’t written in over 24 hours (the window closed {date}). Telegram only lets a bot reply within a day.',
  'composer.you': 'You',
  'composer.noQuote': 'Remove quote',
  'composer.fromArchive': 'from archive',
  'composer.removeFile': 'Remove file',
  'composer.attachFile': 'Attach file',
  'composer.captionPlaceholder': 'Caption…',
  'composer.placeholder': 'Reply as yourself…',
  'composer.send': 'Send',
  'composer.picker.title': 'File from archive',
  'composer.picker.empty': 'This chat’s archive has no files.',
};
