import type { Translation } from '../ru';
import type { deleteChat as ru } from '../ru/deleteChat';

export const deleteChat: Translation<typeof ru> = {
  'deleteChat.title': 'Delete the whole chat',
  'deleteChat.message': 'All messages, edits, files, stats and settings of this chat will disappear from the app. Nothing changes for the other person in Telegram.',
  'deleteChat.appOnly': 'Delete from the app',
  'deleteChat.appOnlyHint': 'file copies in the archive group stay',
  'deleteChat.withArchive': 'Also delete copies in the archive group',
  'deleteChat.withArchiveHint': 'together with the contact’s topic',
  'deleteChat.confirm': 'Delete the whole chat with “{name}”: {msgs}, edits, stats and chat settings?',
  'deleteChat.confirmNoName': 'Delete the whole chat with this contact: {msgs}, edits, stats and chat settings?',
  'deleteChat.confirmTail': 'This can’t be undone. New messages from this contact will be saved again.',
  'deleteChat.confirmArchive': 'The contact’s topic in the archive group will be deleted with all file copies. This can’t be undone.',
  'deleteChat.done': 'Chat deleted: {msgs}',
  'deleteChat.doneWithArchive': 'Chat and group copies deleted: {msgs}',
  'deleteChat.archiveKept': 'The chat was deleted from the app, but the topic in the archive group couldn’t be deleted — most likely the bot lacks the “Delete messages” right. Delete the topic in the group manually.',
};
