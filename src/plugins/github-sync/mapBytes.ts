import { markMapSaved, mudletDatFormat, store } from 'mudlet-map-editor';

/**
 * Serialize the open map as Mudlet `.dat`, ready to upload.
 *
 * Called immediately before an upload rather than staged ahead of time, so what
 * lands in the PR is the map as it stands and never an older snapshot.
 *
 * Deliberately not `getMapBytes()`, which serializes in whatever format the
 * save split-button used last: one export to cMUD makes `.dbm` the active
 * format, and the upload would then push a SQLite database under the name
 * `map_master3.dat`. The PR target is always a Mudlet `.dat`, so pin it here.
 *
 * Returns null when no map is open.
 */
export async function serializeMapForUpload(): Promise<Uint8Array | null> {
  const map = store.getState().map;
  return map ? await mudletDatFormat.serialize(map) : null;
}

/**
 * Clear the toolbar's dirty marker once the map has been pushed to the PR —
 * the point at which the edits actually left the browser. Nothing earlier in
 * the flow persists anything, so nothing earlier clears it.
 */
export function markUploaded(): void {
  markMapSaved();
}
