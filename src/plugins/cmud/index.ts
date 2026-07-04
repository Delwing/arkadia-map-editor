/**
 * cMUD `.dbm` map format plugin.
 *
 * Registers a read/write codec for cMUD's SQLite map database with the
 * editor's format registry: `.dbm` files become loadable via the file picker
 * and drag-and-drop, and the save split-button gains a "cMUD map (.dbm)"
 * entry. See format.ts / writer.ts / cmud-to-mudlet.ts for the codec itself.
 *
 * cMUD maps free-place rooms between grid lines; the codec snaps them to the
 * Mudlet cell grid with per-zone phase estimation + jitter clustering (see
 * cmud-to-mudlet.ts) so hand-nudged rooms land in consistent columns/rows.
 * Labels and exit-line nudges stay fractional. As a safety net, the built-in
 * .dat format (int32 coordinates — Buffer.writeInt32 silently truncates
 * floats) is wrapped to round any fractional room coordinates.
 */
import type { EditorPlugin, MapFormat, MudletMap } from 'mudlet-map-editor';
import { MUDLET_DAT_FORMAT_ID } from 'mudlet-map-editor';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { configureSqlJs } from './sqlite';
import { cmudDbmFormat } from './format';

configureSqlJs(() => wasmUrl);

/** Clone the map with room coordinates rounded to whole Mudlet cells. */
function roundRoomCoords(map: MudletMap): MudletMap {
  let changed = false;
  const rooms: MudletMap['rooms'] = {};
  for (const [id, room] of Object.entries(map.rooms)) {
    if (Number.isInteger(room.x) && Number.isInteger(room.y) && Number.isInteger(room.z)) {
      rooms[Number(id)] = room;
    } else {
      changed = true;
      rooms[Number(id)] = {
        ...room,
        x: Math.round(room.x),
        y: Math.round(room.y),
        z: Math.round(room.z),
      };
    }
  }
  return changed ? { ...map, rooms } : map;
}

/** Wrap an integer-coordinate format so fractional cMUD positions round instead of truncating. */
function withIntCoords(format: MapFormat): MapFormat {
  if (format.id !== MUDLET_DAT_FORMAT_ID) return format;
  return {
    ...format,
    serialize: (map) => format.serialize(roundRoomCoords(map)),
  };
}

const plugin: EditorPlugin = {
  id: 'cmud',
  mapFormats(formats) {
    return [...formats.map(withIntCoords), cmudDbmFormat];
  },
};

export default plugin;
