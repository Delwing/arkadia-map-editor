/**
 * Direction bridging tables between the Mudlet room model and cMUD's DirTbl.
 *
 * Three keying schemes meet here:
 *  - Mudlet room fields / SHORT codes (`doors`, `exitWeights` keys) / numeric
 *    stub codes (1-12, also used by `exitLocks`/`stubs`);
 *  - cMUD `DirTbl` ids 1-10 (north..down, as found in real `.dbm` files);
 *    `ExitTbl.DirType` stores `DirId - 1`. cMUD has no `in`/`out` direction —
 *    those travel as named exits (`ExitTbl.Name`) with `DirType = -1`.
 */
import type { MudletMap } from 'mudlet-map-editor';

export type MudletRoomType = MudletMap['rooms'][number];

export interface DirSpec {
  /** Mudlet room field holding the exit target id. */
  field: keyof MudletRoomType &
    ('north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest' | 'up' | 'down' | 'in' | 'out');
  /** SHORT code used as key in `doors` / `exitWeights` / `customLines`. */
  short: string;
  /** Numeric dir code used by `stubs` / `exitLocks` (renderer convention). */
  stubCode: number;
  /** cMUD DirTbl id, or null for in/out (no cMUD equivalent). */
  cmudDirId: number | null;
  /** cMUD DirTbl id of the reverse direction (null when cmudDirId is null). */
  cmudRevDirId: number | null;
}

export const DIRS: DirSpec[] = [
  { field: 'north',     short: 'n',    stubCode: 1,  cmudDirId: 1,    cmudRevDirId: 5 },
  { field: 'northeast', short: 'ne',   stubCode: 2,  cmudDirId: 2,    cmudRevDirId: 6 },
  { field: 'northwest', short: 'nw',   stubCode: 3,  cmudDirId: 8,    cmudRevDirId: 4 },
  { field: 'east',      short: 'e',    stubCode: 4,  cmudDirId: 3,    cmudRevDirId: 7 },
  { field: 'west',      short: 'w',    stubCode: 5,  cmudDirId: 7,    cmudRevDirId: 3 },
  { field: 'south',     short: 's',    stubCode: 6,  cmudDirId: 5,    cmudRevDirId: 1 },
  { field: 'southeast', short: 'se',   stubCode: 7,  cmudDirId: 4,    cmudRevDirId: 8 },
  { field: 'southwest', short: 'sw',   stubCode: 8,  cmudDirId: 6,    cmudRevDirId: 2 },
  { field: 'up',        short: 'up',   stubCode: 9,  cmudDirId: 9,    cmudRevDirId: 10 },
  { field: 'down',      short: 'down', stubCode: 10, cmudDirId: 10,   cmudRevDirId: 9 },
  { field: 'in',        short: 'in',   stubCode: 11, cmudDirId: null, cmudRevDirId: null },
  { field: 'out',       short: 'out',  stubCode: 12, cmudDirId: null, cmudRevDirId: null },
];

export const DIR_BY_FIELD = new Map(DIRS.map((d) => [d.field as string, d]));
export const DIR_BY_STUB_CODE = new Map(DIRS.map((d) => [d.stubCode, d]));
export const DIR_BY_CMUD_ID = new Map(
  DIRS.filter((d) => d.cmudDirId !== null).map((d) => [d.cmudDirId as number, d]),
);

/**
 * Mudlet cardinal exit slot keys, indexed by normalised direction name.
 * Accepts both cMUD DirTbl spellings ("north", "ne") and full names.
 */
export const CARDINAL_SLOTS: Record<string, DirSpec['field']> = {
  n: 'north',
  north: 'north',
  ne: 'northeast',
  northeast: 'northeast',
  e: 'east',
  east: 'east',
  se: 'southeast',
  southeast: 'southeast',
  s: 'south',
  south: 'south',
  sw: 'southwest',
  southwest: 'southwest',
  w: 'west',
  west: 'west',
  nw: 'northwest',
  northwest: 'northwest',
  u: 'up',
  up: 'up',
  d: 'down',
  down: 'down',
  in: 'in',
  out: 'out',
};

/**
 * The 10 DirTbl rows this editor writes — byte-for-byte the rows found in
 * real Arkadia `.dbm` files (DirRef is the hotkey ASCII code; Dx/Dy/Dz are
 * percentages of the zone scale, north = -Y in cMUD screen space).
 */
export const CMUD_DIR_ROWS = [
  { DirId: 1,  DirName: 'north', DirRef: 110, RevId: 5,  Dx: 0,    Dy: -200, Dz: 0 },
  { DirId: 2,  DirName: 'ne',    DirRef: 106, RevId: 6,  Dx: 200,  Dy: -200, Dz: 0 },
  { DirId: 3,  DirName: 'east',  DirRef: 101, RevId: 7,  Dx: 200,  Dy: 0,    Dz: 0 },
  { DirId: 4,  DirName: 'se',    DirRef: 108, RevId: 8,  Dx: 200,  Dy: 200,  Dz: 0 },
  { DirId: 5,  DirName: 'south', DirRef: 115, RevId: 1,  Dx: 0,    Dy: 200,  Dz: 0 },
  { DirId: 6,  DirName: 'sw',    DirRef: 107, RevId: 2,  Dx: -200, Dy: 200,  Dz: 0 },
  { DirId: 7,  DirName: 'west',  DirRef: 119, RevId: 3,  Dx: -200, Dy: 0,    Dz: 0 },
  { DirId: 8,  DirName: 'nw',    DirRef: 104, RevId: 4,  Dx: -200, Dy: -200, Dz: 0 },
  { DirId: 9,  DirName: 'up',    DirRef: 117, RevId: 10, Dx: 0,    Dy: 0,    Dz: 100 },
  { DirId: 10, DirName: 'down',  DirRef: 100, RevId: 9,  Dx: 0,    Dy: 0,    Dz: -100 },
];
