import { endpointError } from '../lib/i18n.js';
import { authed } from '../lib/runtime.js';
import { findById, editsForMessage, albumRows } from '../lib/repo/messages.js';
import { eventView, editView } from '../lib/view.js';

export default authed(async (input, { owner, settings }) => {
  const id = Number(input.id);
  if (!Number.isFinite(id)) throw endpointError('err.noEventId', null, 'BAD_INPUT');
  const row = await findById(owner, id);
  if (!row) throw endpointError('err.eventNotFound', null, 'NOT_FOUND');
  const [editRows, album] = await Promise.all([
    editsForMessage(owner, id),
    row.mediaGroupId ? albumRows(row) : Promise.resolve([row]),
  ]);
  return {
    event: eventView(row, settings.lang),
    edits: editRows.map(editView),
    album: album.length > 1 ? album.map((r) => eventView(r, settings.lang)) : null,
  };
});
