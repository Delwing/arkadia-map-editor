/**
 * Native cMUD map model.
 *
 * Vendored from the (unpublished) cmud adapter branch of
 * node-mudlet-map-binary-reader and extended with the extra `ObjectTbl` /
 * `ExitTbl` columns this editor round-trips through (cost, enabled, userStr,
 * userInt, content, distance) plus the `ArkadiaMetaTbl` sidecar written by our
 * serializer.
 *
 * Mirrors cMUD's `.dbm` (SQLite) schema concepts as-is: percentage-based
 * direction vectors, paired-row exits, zones with their own scale, arbitrary
 * user-defined directions. No Mudlet-specific fields leak in here.
 */

/** Top-level cMUD map: zones, rooms, and the paired-row exit table. */
export interface CmudMap {
  zones: Record<number, CmudZone>;
  rooms: Record<number, CmudRoom>;
  exits: CmudExit[];
  directions: Record<number, CmudDirection>;
  notes: CmudNote[];
  styles: Record<number, CmudStyle>;
  labels: CmudLabel[];
  /**
   * Key/value rows from `ArkadiaMetaTbl` when the file was written by this
   * editor. Absent (empty) for genuine cMUD files — its presence switches the
   * adapter into lossless round-trip mode.
   */
  meta: Record<string, string>;
  /** Columns seen in the source tables that we didn't map — for diagnostics. */
  unknownColumns: Record<string, string[]>;
}

/** A cMUD zone. `defSize`/`defSizeY` scale direction percentage vectors. */
export interface CmudZone {
  id: number;
  name: string;
  defSize: number;
  defSizeY: number;
}

/** A cMUD room. Coordinates are in zone-scale units (may be fractional). */
export interface CmudRoom {
  id: number;
  zoneId: number;
  name: string;
  description: string;
  x: number;
  y: number;
  z: number;
  styleId?: number;
  kindId?: number;
  flags: number;
  /**
   * Per-room color override in cMUD's BGR integer format (`0x00BBGGRR`).
   * When absent, cMUD falls back to the style/kind palette. `0x1FFFFFFF`
   * (536870911) is cMUD's sentinel for "no color — inherit".
   */
  color?: number;
  /** `ObjectTbl.Cost` — cMUD speedwalk cost; we round-trip Mudlet `weight` here. */
  cost?: number;
  /** `ObjectTbl.Enabled` — cMUD excludes disabled rooms from speedwalks; maps to Mudlet `isLocked`. */
  enabled?: boolean;
  /** `ObjectTbl.UserStr` — free-form user string; we round-trip Mudlet `symbol` here. */
  userStr?: string;
  /** `ObjectTbl.UserInt` — free-form user int; we round-trip the Mudlet environment id here. */
  userInt?: number;
  /** `ObjectTbl.Content` — room content text; we round-trip extra Mudlet `userData` as JSON here. */
  content?: string;
}

/**
 * A single paired-row exit. In cMUD each logical link is two rows (one per
 * direction); `exitIdTo` points at the partner row.
 *
 * Unexplored exits: `exitIdTo === -1`, `toId === fromId`, `dirToType` names
 * the "None" direction. Unpaired rows with a real target (`exitIdTo === -1`,
 * `toId !== fromId`) are cMUD's one-way exits.
 */
export interface CmudExit {
  exitId: number;
  exitIdTo: number;
  fromId: number;
  toId: number;
  dirType: number;
  dirToType: number;
  exitKindId?: number;
  /**
   * Optional exit label — cMUD uses `ExitTbl.Name` to store special-exit names
   * ("enter cave", "climb rope") when there is no canonical direction.
   */
  name?: string;
  /**
   * `ExitTbl.Flags` bitfield. Bit 0 (`1`) is typically "tested/verified".
   * Bit 1 (`2`) marks the exit as "render as a short stub, don't draw the
   * connecting line" — used when the target room is positioned too far away
   * to draw cleanly, or the user wants the pair visually disconnected.
   */
  flags?: number;
  /** `ExitTbl.Distance` — cMUD path cost; we round-trip Mudlet exit weights here. */
  distance?: number;
  /**
   * `ExitTbl.X0..Z1` — cMUD's nudged exit-line endpoints, as offsets in zone
   * units from the source (`0`) and target (`1`) rooms. Only present when any
   * component is non-zero; the adapter converts them to Mudlet custom lines.
   */
  line?: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
}

/** A direction entry from DirTbl. `dx`/`dy`/`dz` are percentages of zone scale. */
export interface CmudDirection {
  id: number;
  name: string;
  dx: number;
  dy: number;
  dz: number;
  revId: number;
}

/** A note attached to a room. Adapter folds these into Mudlet userData. */
export interface CmudNote {
  objectId: number;
  category: string;
  text: string;
}

/**
 * A free-floating text label placed on the map (cMUD's `DrawTbl`).
 *
 * Positioned in the zone's native coord system. `dx`/`dy` are an optional
 * explicit render size; when both are 0 cMUD auto-sizes to the text.
 */
export interface CmudLabel {
  id: number;
  zoneId: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  text: string;
  hint?: string;
  styleId?: number;
  flags: number;
}

/** A style entry. Colors are 0-255 RGB. */
export interface CmudStyle {
  id: number;
  fg?: { r: number; g: number; b: number };
  bg?: { r: number; g: number; b: number };
  font?: string;
}
