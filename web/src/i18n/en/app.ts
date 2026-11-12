import type { Translation } from '../ru';
import type { app as ru } from '../ru/app';

export const app: Translation<typeof ru> = {
  'app.tab.feed': 'Feed',
  'app.tab.chats': 'Chats',
  'app.tab.media': 'Media',
  'app.tab.stats': 'Stats',
  'app.tab.settings': 'Settings',
  'app.openFailed': 'Couldn’t open the archive',
  'app.openFromTelegram': 'Open the app from Telegram — via the menu button or the bot’s profile.',
  'app.error.openInTelegram': 'Open the app inside Telegram',
  'app.error.timeout': 'The server didn’t respond — check your connection',
};
