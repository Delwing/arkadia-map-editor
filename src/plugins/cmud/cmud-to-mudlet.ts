/**
 * Converts a native `CmudMap` into a `MudletMap`.
 *
 * Two paths:
 *  - **Foreign files** (genuine cMUD `.dbm`): the heuristic conversion
 *    vendored from node-mudlet-map-binary-reader's cmud adapter branch —
 *    data-driven zone scales, style/color → env synthesis, notes folded into
 *    `userData`, unexplored/unpaired exits become stubs.
 *  - **Editor-authored files** (written by {@link ../writer}): exact inverse
 *    of the writer using the `ArkadiaMetaTbl` sidecar — fixed cell scale,
 *    env ids from `UserInt`, symbols from `UserStr`, weights from `Cost`,
 *    doors from exit kinds, custom lines/locks from the `Content` JSON.
 *
 * Deviation from the reference adapter: special-exit names keep their
 * original case (Mudlet special exits are literal commands).
 */
import type { MudletMap, MudletColor } from 'mudlet-map-editor';
import type {
  CmudDirection,
  CmudExit,
  CmudLabel,
  CmudMap,
  CmudNote,
  CmudRoom,
  CmudStyle,
  CmudZone,
} from './cmud-types';
import { CARDINAL_SLOTS, DIR_BY_FIELD } from './directions';
import {
  WRITER_ID,
  DEFAULT_CELL_SCALE,
  parseJsonMeta,
  type MudletGlobals,
  type LabelExtra,
  type AreaExtra,
  type RoomSidecar,
} from './meta';

type MudletRoom = MudletMap['rooms'][number];
type MudletArea = MudletMap['areas'][number];
type MudletLabel = MudletMap['labels'][number][number];

export function cmudToMudletMap(cmud: CmudMap): MudletMap {
  return cmud.meta['writer'] === WRITER_ID
    ? convertEditorAuthored(cmud)
    : convertForeign(cmud);
}

// ---------------------------------------------------------------------------
// Foreign path (heuristic, vendored from the reference adapter)
// ---------------------------------------------------------------------------

function convertForeign(cmud: CmudMap): MudletMap {
  const rooms: Record<number, MudletRoom> = {};
  const fallbackScale = deriveFallbackScale(cmud.directions);
  const zoneScales = computeZoneScales(
    cmud.rooms,
    cmud.exits,
    cmud.directions,
    cmud.zones,
    fallbackScale,
  );
  const positions = placeRoomsByExits(cmud, zoneScales, fallbackScale);

  for (const room of Object.values(cmud.rooms)) {
    const pos = positions.get(room.id)!;
    // Y flips on read so the adapter pair composes to identity.
    rooms[room.id] = buildRoom(room, pos.x, -pos.y);
  }

  applyExits(rooms, cmud.exits, cmud.directions, cmud.rooms, zoneScales, fallbackScale);
  applyNotes(rooms, cmud.notes);

  const { envColors, roomEnv } = buildEnvironments(cmud.rooms, cmud.styles);
  for (const [idStr, envId] of Object.entries(roomEnv)) {
    const r = rooms[Number(idStr)];
    if (r) r.environment = envId;
  }

  const areas = buildAreas(rooms, cmud.zones);
  const areaNames = buildAreaNames(cmud.zones, areas);

  const labels = buildForeignLabels(cmud.labels, zoneScales, fallbackScale, cmud.rooms, positions);

  return {
    version: 20,
    envColors: {},
    areaNames,
    mCustomEnvColors: envColors,
    mpRoomDbHashToRoomId: {},
    mUserData: {},
    mapSymbolFont: DEFAULT_FONT(),
    mapFontFudgeFactor: 1.0,
    useOnlyMapFont: false,
    areas,
    mRoomIdHash: {},
    labels,
    rooms,
  };
}

/**
 * Per-zone coordinate scale computed from the observed cardinal-exit strides.
 *
 * For each zone we collect |Δx| / |Δy| between east/west / north/south
 * exit-connected rooms, then:
 *   1. Identify the "dominant" strides (≥ 10% of the mode count).
 *   2. Use `min(dominant) / 2` as the zone scale.
 *
 * This makes every dominant stride round to **2 Mudlet cells**, even when a
 * zone mixes e.g. a 256-step main grid with a 240-step sub-region. With a
 * fixed `defSize` scale the minority stride rounds to 1 or 2 inconsistently;
 * the data-driven value avoids that. Zones with no usable exit data fall back
 * to `defSize` (or the global east.dx).
 */
function computeZoneScales(
  rooms: Record<number, CmudRoom>,
  exits: CmudExit[],
  directions: Record<number, CmudDirection>,
  zones: Record<number, CmudZone>,
  fallback: number,
): Record<number, number> {
  const stepCounts: Record<number, Map<number, number>> = {};
  for (const exit of exits) {
    const from = rooms[exit.fromId];
    const to = rooms[exit.toId];
    if (!from || !to || from.zoneId !== to.zoneId) continue;
    const dir = exit.dirType >= 0 ? directions[exit.dirType + 1] : undefined;
    const name = dir?.name.toLowerCase() ?? '';
    let delta = 0;
    if (name === 'east' || name === 'west') delta = Math.abs(to.x - from.x);
    else if (name === 'north' || name === 'south') delta = Math.abs(to.y - from.y);
    if (!delta) continue;
    if (!stepCounts[from.zoneId]) stepCounts[from.zoneId] = new Map();
    const m = stepCounts[from.zoneId];
    m.set(delta, (m.get(delta) || 0) + 1);
  }

  const scales: Record<number, number> = {};
  const zoneIds = new Set<number>([
    ...Object.keys(zones).map(Number),
    ...Object.keys(stepCounts).map(Number),
  ]);
  for (const zoneId of zoneIds) {
    const zone = zones[zoneId];
    const defSize = zone && zone.defSize > 0 ? zone.defSize : 0;
    const counts = stepCounts[zoneId];
    if (!counts || counts.size === 0) {
      scales[zoneId] = defSize || fallback;
      continue;
    }
    const sorted = [...counts].sort((a, b) => b[1] - a[1]);
    const modeCount = sorted[0][1];
    const threshold = Math.max(1, modeCount * 0.1);
    const dominant = sorted.filter(([, c]) => c >= threshold).map(([s]) => s);
    scales[zoneId] = Math.max(1, Math.floor(Math.min(...dominant) / 2));
  }
  return scales;
}

/** Global fallback scale derived from the east direction vector, if any. */
function deriveFallbackScale(dirs: Record<number, CmudDirection>): number {
  for (const d of Object.values(dirs)) {
    if (d.name.toLowerCase() === 'east' && d.dx > 0) return d.dx;
  }
  return 200;
}

// ---------------------------------------------------------------------------
// Grid snapping (foreign path)
//
// cMUD free-places rooms, so naive per-room `round(x / scale)` misplaces rooms
// whenever a grid sits near the rounding boundary (Skellige columns live at
// x ≡ 63 mod 128, Imperium rows at y ≡ 60 mod 120 — exactly .5 cells): rooms
// 2 units apart split into different columns, and adjacent rows randomly land
// 1 or 3 cells apart instead of 2. Global coordinate statistics proved too
// brittle (jitter rows chain-merge into real rows and drag them around), so
// placement is relative to *exit-connected neighbours* instead — the exit
// deltas are the reliable signal (a 2-cell link is 256±4 units; rounding a
// single small delta is robust where rounding an absolute position is not).
//
// Long edges are the one exception: coordinates are path-consistent in
// continuous space (593 = 283 + 310) but not after rounding (round(4.63)=5 ≠
// round(2.2)+round(2.42)=4), so a long jump must never override the chain of
// short hops covering the same span. Hence:
//   1. per zone, grow a shortest-edge-first spanning tree (Prim) from a
//      high-degree anchor, placing each room at `neighbour + round(delta /
//      scale)` — every room is placed through its most-adjacent chain;
//   2. a few relaxation passes settle every room at the median position its
//      short-edge neighbours imply, absorbing unlucky tree paths;
//   3. rooms without exits place relative to the nearest positioned room.
// ---------------------------------------------------------------------------

interface CellPos {
  x: number;
  y: number;
}

/** Room placements in cmud-cell space (y not yet flipped), keyed by room id. */
function placeRoomsByExits(
  cmud: CmudMap,
  zoneScales: Record<number, number>,
  fallbackScale: number,
): Map<number, CellPos> {
  const positions = new Map<number, CellPos>();
  const byZone = new Map<number, CmudRoom[]>();
  for (const room of Object.values(cmud.rooms)) {
    let list = byZone.get(room.zoneId);
    if (!list) byZone.set(room.zoneId, (list = []));
    list.push(room);
  }

  // Same-zone adjacency; each exit contributes both directions.
  const adjacency = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    let list = adjacency.get(a);
    if (!list) adjacency.set(a, (list = []));
    list.push(b);
  };
  for (const exit of cmud.exits) {
    if (exit.fromId === exit.toId) continue;
    const a = cmud.rooms[exit.fromId];
    const b = cmud.rooms[exit.toId];
    if (!a || !b || a.zoneId !== b.zoneId) continue;
    link(a.id, b.id);
    link(b.id, a.id);
  }

  for (const [zoneId, zoneRooms] of byZone) {
    const scale = zoneScales[zoneId] ?? fallbackScale;
    placeZone(zoneRooms, cmud.rooms, adjacency, scale, positions);
  }
  return positions;
}

/** The cell a neighbour's position implies for a room, given their true offset. */
function impliedPos(
  room: CmudRoom,
  neighbor: CmudRoom,
  neighborPos: CellPos,
  scale: number,
): CellPos {
  return {
    x: neighborPos.x + Math.round((room.x - neighbor.x) / scale),
    y: neighborPos.y + Math.round((room.y - neighbor.y) / scale),
  };
}

/** Lower median of a small integer list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Squared cmud-unit distance between two exit-connected rooms. */
function edgeLength2(a: CmudRoom, b: CmudRoom): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** Binary min-heap of (length², from, to) edge triples for the Prim growth. */
class MinHeap {
  private keys: number[] = [];
  private froms: number[] = [];
  private tos: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, from: number, to: number): void {
    const { keys, froms, tos } = this;
    let i = keys.length;
    keys.push(key);
    froms.push(from);
    tos.push(to);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [from: number, to: number] {
    const { keys, froms, tos } = this;
    const result: [number, number] = [froms[0], tos[0]];
    const last = keys.length - 1;
    this.swap(0, last);
    keys.pop();
    froms.pop();
    tos.pop();
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < keys.length && keys[left] < keys[smallest]) smallest = left;
      if (right < keys.length && keys[right] < keys[smallest]) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return result;
  }

  private swap(a: number, b: number): void {
    const { keys, froms, tos } = this;
    [keys[a], keys[b]] = [keys[b], keys[a]];
    [froms[a], froms[b]] = [froms[b], froms[a]];
    [tos[a], tos[b]] = [tos[b], tos[a]];
  }
}

function placeZone(
  zoneRooms: CmudRoom[],
  allRooms: Record<number, CmudRoom>,
  adjacency: Map<number, number[]>,
  scale: number,
  positions: Map<number, CellPos>,
): void {
  const ids = zoneRooms.map((r) => r.id).sort((a, b) => a - b);
  const placed = new Set<number>();
  // Edges longer than this play no part in placement decisions unless a room
  // has nothing shorter — their rounding error can exceed half a cell.
  const shortEdge2 = (3 * scale) ** 2;

  // 1. Grow each connected component shortest-edge-first (Prim) from its
  //    highest-degree room, anchored at that room's absolute cell so the zone
  //    stays roughly where cMUD put it.
  for (const seedId of ids) {
    if (placed.has(seedId) || !(adjacency.get(seedId)?.length)) continue;
    // Find the highest-degree room of this component first.
    const component: number[] = [];
    const seen = new Set<number>([seedId]);
    let queue = [seedId];
    while (queue.length) {
      const next: number[] = [];
      for (const id of queue) {
        component.push(id);
        for (const nb of adjacency.get(id) ?? []) {
          if (!seen.has(nb)) {
            seen.add(nb);
            next.push(nb);
          }
        }
      }
      queue = next;
    }
    let anchor = component[0];
    for (const id of component) {
      if ((adjacency.get(id)?.length ?? 0) > (adjacency.get(anchor)?.length ?? 0)) anchor = id;
    }
    const anchorRoom = allRooms[anchor];
    positions.set(anchor, {
      x: Math.round(anchorRoom.x / scale),
      y: Math.round(anchorRoom.y / scale),
    });
    placed.add(anchor);

    // Prim's growth: always attach the closest unplaced room next, so every
    // room's position comes through its chain of nearest neighbours and a
    // long jump edge is only used when it's the sole connection.
    const heap = new MinHeap();
    const pushEdges = (id: number) => {
      for (const nb of adjacency.get(id) ?? []) {
        if (!placed.has(nb)) heap.push(edgeLength2(allRooms[id], allRooms[nb]), id, nb);
      }
    };
    pushEdges(anchor);
    while (heap.size) {
      const [from, to] = heap.pop();
      if (placed.has(to)) continue;
      positions.set(to, impliedPos(allRooms[to], allRooms[from], positions.get(from)!, scale));
      placed.add(to);
      pushEdges(to);
    }

    // 2. Relaxation: settle each room at the median of what its short-edge
    //    neighbours imply, so an unlucky tree path can't misplace it against
    //    the majority evidence. The anchor stays fixed.
    for (let pass = 0; pass < 3; pass++) {
      let moved = 0;
      for (const id of component) {
        if (id === anchor) continue;
        const neighbors = adjacency.get(id)!;
        if (neighbors.length < 2) continue;
        const room = allRooms[id];
        const short = neighbors.filter((nb) => edgeLength2(room, allRooms[nb]) <= shortEdge2);
        const votes = short.length >= 2 ? short : neighbors;
        const xs: number[] = [];
        const ys: number[] = [];
        for (const nb of votes) {
          const implied = impliedPos(room, allRooms[nb], positions.get(nb)!, scale);
          xs.push(implied.x);
          ys.push(implied.y);
        }
        const pos = positions.get(id)!;
        const nx = median(xs);
        const ny = median(ys);
        if (nx !== pos.x || ny !== pos.y) {
          positions.set(id, { x: nx, y: ny });
          moved++;
        }
      }
      if (!moved) break;
    }
  }

  // 3. Exit-less rooms: place relative to the nearest positioned room, or
  //    absolutely if the zone has no positioned rooms at all.
  const anchored = ids.filter((id) => placed.has(id));
  for (const id of ids) {
    if (placed.has(id)) continue;
    const room = allRooms[id];
    let nearest: number | undefined;
    let nearestDist = Infinity;
    for (const other of anchored) {
      const o = allRooms[other];
      const d = (o.x - room.x) ** 2 + (o.y - room.y) ** 2;
      if (d < nearestDist) {
        nearestDist = d;
        nearest = other;
      }
    }
    positions.set(
      id,
      nearest !== undefined
        ? impliedPos(room, allRooms[nearest], positions.get(nearest)!, scale)
        : { x: Math.round(room.x / scale), y: Math.round(room.y / scale) },
    );
  }
}

/**
 * Sub-cell values (labels, exit-line nudges, editor-authored room coords) are
 * kept at 1/128-cell precision — exactly representable in binary floating
 * point and matching the writer's integer cMUD units, so save/load cycles
 * never drift.
 */
function quantize(cells: number): number {
  return Math.round(cells * 128) / 128;
}

/** Build a room at the given Mudlet coordinates (the caller owns snapping/flipping x and y). */
function buildRoom(room: CmudRoom, x: number, y: number): MudletRoom {
  return {
    area: room.zoneId,
    x,
    y,
    z: Math.round(room.z),
    north: -1,
    northeast: -1,
    east: -1,
    southeast: -1,
    south: -1,
    southwest: -1,
    west: -1,
    northwest: -1,
    up: -1,
    down: -1,
    in: -1,
    out: -1,
    environment: 1,
    weight: 1,
    name: room.name,
    isLocked: false,
    mSpecialExits: {},
    mSpecialExitLocks: [],
    symbol: '',
    userData: room.description ? { 'cmud.description': room.description } : {},
    customLines: {},
    customLinesArrow: {},
    customLinesColor: {},
    customLinesStyle: {},
    exitLocks: [],
    stubs: [],
    exitWeights: {},
    doors: {},
  };
}

/** cMUD `ExitTbl.Flags` bit 1 — "draw as short stub, suppress the connecting line". */
const CMUD_EXIT_FLAG_STUB = 2;

function applyExits(
  rooms: Record<number, MudletRoom>,
  exits: CmudExit[],
  dirs: Record<number, CmudDirection>,
  cmudRooms: Record<number, CmudRoom>,
  zoneScales: Record<number, number>,
  fallbackScale: number,
): void {
  for (const exit of exits) {
    const room = rooms[exit.fromId];
    if (!room) continue;
    // cMUD stores ExitTbl.DirType as (DirId - 1) — zero-indexed. Undo the shift here.
    const dir = exit.dirType >= 0 ? dirs[exit.dirType + 1] : undefined;
    const dirName = (dir?.name ?? '').toLowerCase();
    // cMUD exits can carry both a canonical direction and a traversal command
    // in `Name` ("barak", "przesun kamien;wskocz do otworu"). Keep the visual
    // direction link and record the command as an Arkadia direction bind
    // (`userData['dir_bind']`, `dir=cmd&dir=cmd` — the crowdmap's mechanism
    // for "walking this direction sends these commands"). Command-only exits
    // (no direction) stay Mudlet special exits; a `Name` that is itself a
    // direction word ("e", "ne") is just an alias, not a bind.
    const command = exit.name ?? '';
    const dirSlot = CARDINAL_SLOTS[dirName];
    const commandSlot = command ? CARDINAL_SLOTS[command.toLowerCase()] : undefined;
    const slot = dirSlot ?? commandSlot;
    if (!command && !dirSlot) continue;

    const drawAsStub =
      exit.exitIdTo === -1 ||
      exit.toId === exit.fromId ||
      (exit.flags !== undefined && (exit.flags & CMUD_EXIT_FLAG_STUB) !== 0);

    if (drawAsStub) {
      // A stub has no command semantics on the map — keep the direction arrow.
      const stubId = slot ? DIR_BY_FIELD.get(slot)?.stubCode : undefined;
      if (stubId && !room.stubs.includes(stubId)) room.stubs.push(stubId);
    } else if (slot) {
      (room[slot] as number) = exit.toId;
      if (command && commandSlot !== slot) addDirBind(room, slot, command);
      applyExitLine(rooms, DIR_BY_FIELD.get(slot)!.short, exit, cmudRooms, zoneScales, fallbackScale);
    } else {
      room.mSpecialExits[command] = exit.toId;
      applyExitLine(rooms, command, exit, cmudRooms, zoneScales, fallbackScale);
    }
  }
}

/** Arkadia crowdmap direction-bind userData key (see DirBindSection in the arkadia plugin). */
const DIR_BIND_KEY = 'dir_bind';

/** Append a `direction=commands` entry to the room's dir_bind userData. */
function addDirBind(room: MudletRoom, dir: string, command: string): void {
  const entry = `${dir}=${command}`;
  const current = room.userData[DIR_BIND_KEY];
  if (current === undefined) {
    room.userData[DIR_BIND_KEY] = entry;
  } else if (!current.split('&').some((pair) => pair.startsWith(`${dir}=`))) {
    room.userData[DIR_BIND_KEY] = `${current}&${entry}`;
  }
}

/**
 * cMUD lets the user nudge where an exit line attaches (`ExitTbl.X0..Z1`,
 * offsets in zone units from the source/target rooms). Mudlet's counterpart is
 * a custom line, so build one: nudged start point (when offset), ending at the
 * target room (plus its offset) so the line still reaches the destination.
 * Anchored to the already-built (grid-snapped) room positions so the line
 * moves with the rooms.
 */
function applyExitLine(
  rooms: Record<number, MudletRoom>,
  key: string,
  exit: CmudExit,
  cmudRooms: Record<number, CmudRoom>,
  zoneScales: Record<number, number>,
  fallbackScale: number,
): void {
  const line = exit.line;
  if (!line) return;
  const from = rooms[exit.fromId];
  const to = rooms[exit.toId];
  if (!from || !to) return;
  const scale = zoneScales[cmudRooms[exit.fromId]?.zoneId ?? -1] ?? fallbackScale;
  const points: [number, number][] = [];
  if (line.x0 || line.y0) {
    points.push([quantize(from.x + line.x0 / scale), quantize(from.y - line.y0 / scale)]);
  }
  points.push([quantize(to.x + line.x1 / scale), quantize(to.y - line.y1 / scale)]);
  from.customLines[key] = points;
  // The renderer export reads these parallel maps unguarded — always fill them.
  from.customLinesColor[key] = { spec: 1, alpha: 255, r: 255, g: 0, b: 0, pad: 0 };
  from.customLinesStyle[key] = 1; // Qt::SolidLine
  from.customLinesArrow[key] = false;
}

function applyNotes(
  rooms: Record<number, MudletRoom>,
  notes: CmudNote[],
): void {
  for (const note of notes) {
    const room = rooms[note.objectId];
    if (!room) continue;
    const key = note.category && note.category !== '0'
      ? `cmud.note.${note.category}`
      : 'cmud.note';
    const existing = room.userData[key];
    room.userData[key] = existing ? `${existing}\n${note.text}` : note.text;
  }
}

/**
 * cMUD sentinel for `ObjectTbl.Color` meaning "no per-room override — inherit
 * from style/kind palette".
 */
const CMUD_INHERIT_SENTINEL = 0x1fffffff;

/** Decode cMUD's 24-bit BGR integer (`0x00BBGGRR`) into RGB channels. */
function decodeBgr(v: number): { r: number; g: number; b: number } {
  return { r: v & 0xff, g: (v >> 8) & 0xff, b: (v >> 16) & 0xff };
}

/**
 * Build the Mudlet env-color palette and per-room env assignment.
 *
 * Color resolution order for each room:
 *   1. Per-room `ObjectTbl.Color` override, unless it's the "inherit" sentinel.
 *   2. The room's style bg (or fg if no bg).
 *   3. A synthesised neutral grey, shared across all unclassified rooms.
 *
 * Mudlet's built-in env IDs occupy 257-272, so we start synthesised ones at
 * 300 to stay clear. Unique RGB triples are deduped across all sources.
 */
function buildEnvironments(
  cmudRooms: Record<number, CmudRoom>,
  styles: Record<number, CmudStyle>,
): { envColors: Record<number, MudletColor>; roomEnv: Record<number, number> } {
  const envColors: Record<number, MudletColor> = {};
  const rgbToEnv = new Map<string, number>();
  let nextId = 300;

  const getEnv = (rgb: { r: number; g: number; b: number }): number => {
    const key = `${rgb.r},${rgb.g},${rgb.b}`;
    let id = rgbToEnv.get(key);
    if (id === undefined) {
      id = nextId++;
      rgbToEnv.set(key, id);
      envColors[id] = { spec: 1, alpha: 255, r: rgb.r, g: rgb.g, b: rgb.b, pad: 0 };
    }
    return id;
  };

  let defaultEnv: number | undefined;
  const getDefaultEnv = (): number => {
    if (defaultEnv === undefined) defaultEnv = getEnv({ r: 128, g: 128, b: 128 });
    return defaultEnv;
  };

  const roomEnv: Record<number, number> = {};
  for (const room of Object.values(cmudRooms)) {
    let rgb: { r: number; g: number; b: number } | undefined;
    if (room.color !== undefined && room.color !== CMUD_INHERIT_SENTINEL) {
      rgb = decodeBgr(room.color);
    } else if (room.styleId !== undefined && styles[room.styleId]) {
      const s = styles[room.styleId];
      rgb = s.bg ?? s.fg;
    }
    roomEnv[room.id] = rgb ? getEnv(rgb) : getDefaultEnv();
  }
  return { envColors, roomEnv };
}

/**
 * Convert cMUD `DrawTbl` labels into Mudlet map labels, grouped by areaId.
 *
 * Positioned with the same per-zone scale as rooms (with y flipped). cMUD
 * labels carry no fg/bg color in the dbm samples we have, so we fall back to
 * black-on-transparent and let the renderer handle the rest. Label size is
 * estimated from text length since `DrawTbl.Dx/Dy` is typically 0.
 */
function buildForeignLabels(
  labels: CmudLabel[],
  zoneScales: Record<number, number>,
  fallbackScale: number,
  cmudRooms: Record<number, CmudRoom>,
  positions: Map<number, CellPos>,
): Record<number, MudletLabel[]> {
  const roomsByZone = new Map<number, CmudRoom[]>();
  for (const room of Object.values(cmudRooms)) {
    let list = roomsByZone.get(room.zoneId);
    if (!list) roomsByZone.set(room.zoneId, (list = []));
    list.push(room);
  }
  const out: Record<number, MudletLabel[]> = {};
  for (const label of labels) {
    const scale = zoneScales[label.zoneId] ?? fallbackScale;
    // Rooms move under relative placement — anchor each label to its nearest
    // room so it keeps its spot among the rooms.
    let nearest: CmudRoom | undefined;
    let nearestDist = Infinity;
    for (const room of roomsByZone.get(label.zoneId) ?? []) {
      const d = (room.x - label.x) ** 2 + (room.y - label.y) ** 2;
      if (d < nearestDist) {
        nearestDist = d;
        nearest = room;
      }
    }
    const anchor = nearest ? positions.get(nearest.id)! : undefined;
    const x = anchor && nearest
      ? quantize(anchor.x + (label.x - nearest.x) / scale)
      : quantize(label.x / scale);
    const y = anchor && nearest
      ? -quantize(anchor.y + (label.y - nearest.y) / scale)
      : quantize(-label.y / scale);
    const z = label.z;

    // Crude size estimate: ~0.3 cells wide per character, 0.4 cells tall.
    // Overridden by explicit Dx/Dy when cMUD has them.
    const width = label.dx > 0 ? label.dx / scale : label.text.length * 0.3;
    const height = label.dy > 0 ? label.dy / scale : 0.4;

    const mudletLabel: MudletLabel = {
      id: label.id,
      areaId: label.zoneId,
      labelId: label.id,
      pos: [x, y, z],
      size: [width, height],
      text: label.text,
      fgColor: { spec: 1, alpha: 255, r: 0, g: 0, b: 0, pad: 0 },
      bgColor: { spec: 1, alpha: 0, r: 255, g: 255, b: 255, pad: 0 },
      pixMap: new Uint8Array(0),
      noScaling: false,
      showOnTop: true,
    };
    if (!out[label.zoneId]) out[label.zoneId] = [];
    out[label.zoneId].push(mudletLabel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Editor-authored path (exact inverse of writer.ts, keyed off ArkadiaMetaTbl)
// ---------------------------------------------------------------------------

function convertEditorAuthored(cmud: CmudMap): MudletMap {
  const scale = Number(cmud.meta['cellScale']) || DEFAULT_CELL_SCALE;
  const globals = parseJsonMeta<Partial<MudletGlobals>>(cmud.meta['mudletGlobals']) ?? {};
  const labelExtras =
    parseJsonMeta<Record<number, LabelExtra>>(cmud.meta['labelExtras']) ?? {};
  const areaExtras =
    parseJsonMeta<Record<number, AreaExtra>>(cmud.meta['areaExtras']) ?? {};

  const rooms: Record<number, MudletRoom> = {};
  const exactDoors = new Map<number, MudletRoom['doors']>();
  for (const cr of Object.values(cmud.rooms)) {
    const room = buildRoom(cr, quantize(cr.x / scale), quantize(-cr.y / scale));
    room.environment = cr.userInt ?? 1;
    room.weight = cr.cost !== undefined && cr.cost > 0 ? cr.cost : 1;
    room.symbol = cr.userStr ?? '';
    room.isLocked = cr.enabled === false;
    const sidecar = parseJsonMeta<RoomSidecar>(cr.content);
    if (sidecar) {
      if (sidecar.ud) room.userData = { ...sidecar.ud, ...room.userData };
      if (sidecar.cl) room.customLines = sidecar.cl;
      if (sidecar.cla) room.customLinesArrow = sidecar.cla;
      if (sidecar.clc) room.customLinesColor = sidecar.clc;
      if (sidecar.cls) room.customLinesStyle = sidecar.cls;
      if (sidecar.el) room.exitLocks = sidecar.el;
      if (sidecar.sel) room.mSpecialExitLocks = sidecar.sel;
      if (sidecar.d) exactDoors.set(cr.id, sidecar.d);
    }
    rooms[cr.id] = room;
  }

  applyEditorExits(rooms, cmud.exits, cmud.directions);
  // Sidecar door states are exact; the ExitKindID-derived ones fold open into closed.
  for (const [id, doors] of exactDoors) {
    const room = rooms[id];
    if (room) room.doors = doors;
  }
  applyNotes(rooms, cmud.notes);

  const areas = buildAreas(rooms, cmud.zones);
  for (const [idStr, extra] of Object.entries(areaExtras)) {
    const area = areas[Number(idStr)];
    if (!area) continue;
    area.gridMode = extra.gridMode ?? false;
    area.userData = extra.userData ?? {};
  }

  const areaNames = buildAreaNames(cmud.zones, areas);

  const labels: Record<number, MudletLabel[]> = {};
  for (const label of cmud.labels) {
    const extra = labelExtras[label.id];
    const mudletLabel: MudletLabel = {
      id: label.id,
      areaId: label.zoneId,
      labelId: label.id,
      pos: extra?.pos ?? [label.x / scale, -label.y / scale, label.z],
      size: extra?.size ?? [label.dx / scale, label.dy / scale],
      text: label.text,
      fgColor: extra?.fg ?? { spec: 1, alpha: 255, r: 0, g: 0, b: 0, pad: 0 },
      bgColor: extra?.bg ?? { spec: 1, alpha: 0, r: 255, g: 255, b: 255, pad: 0 },
      pixMap: new Uint8Array(0),
      noScaling: extra?.noScaling ?? false,
      showOnTop: extra?.showOnTop ?? true,
    };
    if (!labels[label.zoneId]) labels[label.zoneId] = [];
    labels[label.zoneId].push(mudletLabel);
  }

  return {
    version: globals.version ?? 20,
    envColors: globals.envColors ?? {},
    areaNames,
    mCustomEnvColors: globals.mCustomEnvColors ?? {},
    mpRoomDbHashToRoomId: {},
    mUserData: globals.mUserData ?? {},
    mapSymbolFont: globals.mapSymbolFont ?? DEFAULT_FONT(),
    mapFontFudgeFactor: globals.mapFontFudgeFactor ?? 1.0,
    useOnlyMapFont: globals.useOnlyMapFont ?? false,
    areas,
    mRoomIdHash: {},
    labels,
    rooms,
  };
}

/**
 * Exit reconstruction for editor-authored files. Encoding contract with
 * writer.ts:
 *  - cardinal exits: `DirType = DirId - 1`; paired rows when bidirectional,
 *    `ExitIdTo = -1` for one-way (still a real exit here, unlike foreign files);
 *  - stubs: `ToID = FromID`, `ExitIdTo = -1`;
 *  - in/out and special exits: `DirType = -1`, command in `Name`;
 *  - doors: `ExitKindID` 1 (closed) / 2 (locked);
 *  - exit weights: `Distance`.
 */
function applyEditorExits(
  rooms: Record<number, MudletRoom>,
  exits: CmudExit[],
  dirs: Record<number, CmudDirection>,
): void {
  for (const exit of exits) {
    const room = rooms[exit.fromId];
    if (!room) continue;
    const dir = exit.dirType >= 0 ? dirs[exit.dirType + 1] : undefined;
    const dirName = (dir?.name ?? '').toLowerCase();
    const label = dirName || (exit.name ?? '');
    if (!label) continue;

    const slot = CARDINAL_SLOTS[label.toLowerCase()];
    const isStub = exit.toId === exit.fromId;
    const doorKey = slot ? DIR_BY_FIELD.get(slot)!.short : label;

    if (slot && isStub) {
      const stubId = DIR_BY_FIELD.get(slot)!.stubCode;
      if (!room.stubs.includes(stubId)) room.stubs.push(stubId);
    } else if (slot) {
      (room[slot] as number) = exit.toId;
    } else if (!isStub) {
      room.mSpecialExits[label] = exit.toId;
    }

    if (exit.exitKindId === 1) room.doors[doorKey] = 2;
    else if (exit.exitKindId === 2) room.doors[doorKey] = 3;
    if (exit.distance !== undefined && exit.distance > 1) {
      room.exitWeights[doorKey] = exit.distance;
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Zone names, plus an unnamed entry for every area rooms actually reference —
 * real cMUD files contain rooms in zone ids that `ZoneTbl` doesn't list.
 */
function buildAreaNames(
  zones: Record<number, CmudZone>,
  areas: Record<number, MudletArea>,
): Record<number, string> {
  const areaNames: Record<number, string> = {};
  for (const id of Object.keys(areas)) areaNames[Number(id)] = '';
  for (const zone of Object.values(zones)) areaNames[zone.id] = zone.name;
  return areaNames;
}

function buildAreas(
  rooms: Record<number, MudletRoom>,
  zones: Record<number, CmudZone>,
): Record<number, MudletArea> {
  const areas: Record<number, MudletArea> = {};
  for (const zone of Object.values(zones)) {
    areas[zone.id] = emptyArea();
  }
  for (const [idStr, room] of Object.entries(rooms)) {
    const id = Number(idStr);
    let area = areas[room.area];
    if (!area) {
      area = emptyArea();
      areas[room.area] = area;
    }
    area.rooms.push(id);
    updateAreaBounds(area, room);
  }
  for (const area of Object.values(areas)) finaliseArea(area);
  return areas;
}

function emptyArea(): MudletArea {
  return {
    rooms: [],
    zLevels: [],
    mAreaExits: {},
    gridMode: false,
    max_x: 0,
    max_y: 0,
    max_z: 0,
    min_x: 0,
    min_y: 0,
    min_z: 0,
    span: [0, 0, 0],
    xmaxForZ: {},
    ymaxForZ: {},
    xminForZ: {},
    yminForZ: {},
    pos: [0, 0, 0],
    isZone: false,
    zoneAreaRef: -1,
    userData: {},
  };
}

function updateAreaBounds(area: MudletArea, room: MudletRoom): void {
  const first = area.rooms.length === 1;
  if (first) {
    area.min_x = area.max_x = room.x;
    area.min_y = area.max_y = room.y;
    area.min_z = area.max_z = room.z;
  } else {
    if (room.x < area.min_x) area.min_x = room.x;
    if (room.x > area.max_x) area.max_x = room.x;
    if (room.y < area.min_y) area.min_y = room.y;
    if (room.y > area.max_y) area.max_y = room.y;
    if (room.z < area.min_z) area.min_z = room.z;
    if (room.z > area.max_z) area.max_z = room.z;
  }
  if (!area.zLevels.includes(room.z)) area.zLevels.push(room.z);
  const cur = area.xmaxForZ[room.z];
  if (cur === undefined || room.x > cur) area.xmaxForZ[room.z] = room.x;
  const cur2 = area.xminForZ[room.z];
  if (cur2 === undefined || room.x < cur2) area.xminForZ[room.z] = room.x;
  const cur3 = area.ymaxForZ[room.z];
  if (cur3 === undefined || room.y > cur3) area.ymaxForZ[room.z] = room.y;
  const cur4 = area.yminForZ[room.z];
  if (cur4 === undefined || room.y < cur4) area.yminForZ[room.z] = room.y;
}

function finaliseArea(area: MudletArea): void {
  area.zLevels.sort((a, b) => a - b);
  area.span = [
    area.max_x - area.min_x,
    area.max_y - area.min_y,
    area.max_z - area.min_z,
  ];
}

const DEFAULT_FONT = () => ({
  family: 'Bitstream Vera Sans Mono',
  style: '',
  pointSize: 12.0,
  pixelSize: -1,
  styleHint: 5,
  styleStrategy: 1,
  weight: 50,
  fontBits: 16,
  stretch: 100,
  extendedFontBits: 0,
  letterSpacing: 0,
  wordSpacing: 0,
  hintingPreference: 0,
  capital: 0,
  styleSetting: false,
  underline: false,
  overline: false,
  strikeOut: false,
  fixedPitch: false,
  kerning: true,
  styleOblique: false,
  ignorePitch: false,
  letterSpacingIsAbsolute: false,
});
