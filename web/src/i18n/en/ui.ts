import type { Translation } from '../ru';
import type { ui as ru } from '../ru/ui';

export const ui: Translation<typeof ru> = {
  'ui.error.generic': 'Error',
  'ui.listTail.retry': 'Couldn’t load — retry',
  'ui.event.contact': 'Contact',
  'ui.event.you': 'You: ',
  'ui.archiveBanner.notSet': 'No archive group selected: without it, photos and videos are only available through Telegram links and may disappear.',
  'ui.archiveBanner.pickAgain': 'Choose again',
  'ui.archiveBanner.pick': 'Choose a group',
  'ui.archiveBanner.later': 'Later',
  'ui.diff.empty': 'empty',
};
