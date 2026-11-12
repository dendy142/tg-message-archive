import type { Translation } from '../ru';
import type { chats as ru } from '../ru/chats';

export const chats: Translation<typeof ru> = {
  'chats.title': 'Chats',
  'chats.sub': '{chats} in archive',
  'chats.chatN': 'Chat {id}',
  'chats.searchPlaceholder': 'Search by name',
  'chats.clear': 'Clear',
  'chats.empty.title': 'No chats yet',
  'chats.empty.text': 'A chat appears after the first message in a conversation you’ve allowed the bot to access.',
  'chats.notFound.title': 'Nothing found',
  'chats.notFound.text': 'No chats with “{q}” in the name.',
  'chats.newEvents': 'New events: {n}',
  'chats.deleted': 'Deleted: {n}',
};
