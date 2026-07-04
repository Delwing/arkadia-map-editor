/**
 * The lossless-round-trip sidecar this editor embeds when writing `.dbm`.
 *
 * cMUD's schema can't hold everything a `MudletMap` carries (env palette,
 * fonts, custom lines, exit locks, label colors, …). The serializer stashes
 * those in two places a cMUD client ignores:
 *  - `ArkadiaMetaTbl` — key/value rows for map-level data (see {@link MetaKey});
 *  - `ObjectTbl.Content` — per-room JSON sidecar ({@link RoomSidecar}).
 *
 * The reader switches into exact-round-trip mode when it finds
 * `ArkadiaMetaTbl.writer === 'arkadia-map-editor'`; genuine cMUD files take
 * the heuristic conversion path instead.
 */
import type { MudletMap, MudletColor } from 'mudlet-map-editor';

export const WRITER_ID = 'arkadia-map-editor';
export const FORMAT_VERSION = 1;

/** Mudlet cells → cMUD coordinate units. 128 matches real Arkadia zones. */
export const DEFAULT_CELL_SCALE = 128;

export type MetaKey =
  | 'writer'
  | 'formatVersion'
  | 'cellScale'
  | 'mudletGlobals'
  | 'labelExtras'
  | 'areaExtras';

/** Map-level Mudlet fields with no cMUD home, stored as one JSON meta row. */
export interface MudletGlobals {
  version: number;
  envColors: MudletMap['envColors'];
  mCustomEnvColors: MudletMap['mCustomEnvColors'];
  mUserData: MudletMap['mUserData'];
  mapSymbolFont: MudletMap['mapSymbolFont'];
  mapFontFudgeFactor: number;
  useOnlyMapFont: boolean;
}

/** Per-label extras (colors/flags), keyed by the written `DrawTbl.DrawId`. */
export interface LabelExtra {
  fg: MudletColor;
  bg: MudletColor;
  noScaling: boolean;
  showOnTop: boolean;
  /**
   * Exact fractional position/size in Mudlet cells. `DrawTbl` columns are
   * integers (1/128-cell grid after scaling), so these win on read.
   */
  pos: [number, number, number];
  size: [number, number];
}

/** Per-area extras, keyed by zone/area id. */
export interface AreaExtra {
  gridMode: boolean;
  userData: Record<string, string>;
}

type MudletRoom = MudletMap['rooms'][number];

/**
 * Per-room JSON sidecar stored in `ObjectTbl.Content`. Short keys keep the
 * blob small across 25k+ rooms. Only non-empty members are written.
 */
export interface RoomSidecar {
  /** userData minus the keys that live in cMUD columns (`cmud.description`, `cmud.note.*`). */
  ud?: Record<string, string>;
  cl?: MudletRoom['customLines'];
  cla?: MudletRoom['customLinesArrow'];
  clc?: MudletRoom['customLinesColor'];
  cls?: MudletRoom['customLinesStyle'];
  el?: MudletRoom['exitLocks'];
  sel?: MudletRoom['mSpecialExitLocks'];
  /**
   * Exact door states. `ExitTbl.ExitKindID` also encodes doors for cMUD's
   * benefit but folds open+closed together; this key wins on read.
   */
  d?: MudletRoom['doors'];
}

export function parseJsonMeta<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
