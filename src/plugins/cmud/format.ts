/**
 * The `MapFormat` codec registered with the editor: cMUD `.dbm` ⇄ `MudletMap`.
 *
 * Environment-neutral (no Vite-specific imports) so Node scripts/tests can
 * exercise the full parse/serialize round trip; the plugin entry (index.ts)
 * wires the browser WASM location before this is first used.
 */
import type { MapFormat } from 'mudlet-map-editor';
import { openDatabase } from './sqlite';
import { parseCmudMap } from './parser';
import { cmudToMudletMap } from './cmud-to-mudlet';
import { writeMudletMapToDbm } from './writer';

export const CMUD_DBM_FORMAT_ID = 'cmud-dbm';

export const cmudDbmFormat: MapFormat = {
  id: CMUD_DBM_FORMAT_ID,
  label: 'cMUD map (.dbm)',
  extensions: ['.dbm'],
  async parse(bytes) {
    const handle = await openDatabase(new Uint8Array(bytes));
    try {
      return cmudToMudletMap(parseCmudMap(handle.query));
    } finally {
      handle.close();
    }
  },
  serialize(map) {
    return writeMudletMapToDbm(map);
  },
};
