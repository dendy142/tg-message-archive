import type { Translation } from '../ru';
import type { search as ru } from '../ru/search';

export const search: Translation<typeof ru> = {
  'search.title': 'Search',
  'search.titleInChat': 'Search in chat',
  'search.placeholder': 'Text, name or file name',
  'search.clear': 'Clear',
  'search.kind.all': 'All messages',
  'search.kind.deleted': 'Deleted',
  'search.kind.edited': 'Edited',
  'search.kind.favorite': 'Favorites',
  'search.recent': 'Recent',
  'search.hint.title': 'Search the archive',
  'search.hint.text': 'Searches message text, file captions, contact names and file names.',
  'search.none.title': 'Nothing found',
  'search.none.tryOther': 'Try another word or the beginning of one.',
  'search.none.tryAll': 'Try searching all messages.',
  'search.everywhere': 'Search everywhere',
  'search.found': 'Found: {results}',
  'search.results': 'Results',
};
