/**
 * Builds renderer-shaped area payloads so the game client can mirror edits.
 *
 * Rather than translating each editor command into field-level patches, we work
 * out which *areas* a command touched and resend those wholesale. The area is
 * the renderer's own rebuild unit — geometry and exits are cached per area — so
 * one mechanism covers rooms, labels, custom lines and added/deleted rooms
 * alike, and it keeps working as the editor's command set grows.
 *
 * The cost is bounded: a median area is ~390 rooms / 144 KB and the largest is
 * ~750 KB, against 11 MB for the whole map. That is a same-process structured
 * clone, and the area rebuild happens on any edit regardless.
 *
 * Conversion uses `mudlet-map-binary-reader`'s own `convertRoom`/`convertLabel`,
 * the same functions that produce the published `mapExport.json`, so the client
 * receives exactly the shape it already loads — including y in source
 * orientation, which the client flips on the way in.
 */

import { convertLabel, convertRoom, readerExport } from 'mudlet-map-binary-reader';
import type { MudletMap } from 'mudlet-map-editor';
import type { SyncedArea } from '../../bridge/protocol';

/**
 * Commands the client cannot mirror at all, because they change the set of
 * areas (its renderer builds area wrappers once at load) or the shared colour
 * palette, which is not part of area data.
 */
const NEEDS_RELOAD = new Set([
  'addArea',
  'deleteArea',
  'deleteAreaWithRooms',
  'setCustomEnvColor',
]);

type AnyCommand = { kind: string; cmds?: AnyCommand[] } & Record<string, unknown>;

/**
 * Room-id-bearing fields across the command union. Over-collecting is harmless
 * — the worst case is resending an area that did not change — so this favours
 * catching new commands automatically over being exactly right.
 */
const ROOM_ID_FIELDS = ['id', 'roomId', 'fromId', 'toId'] as const;

export interface AffectedAreas {
  areaIds: number[];
  /** Command kinds that need a full map reload to show up. */
  needsReload: string[];
}

/** Work out which areas a run of commands touched. */
export function collectAffectedAreas(cmds: readonly unknown[], map: MudletMap): AffectedAreas {
  const areaIds = new Set<number>();
  const needsReload = new Set<string>();

  const addRoomsArea = (roomId: unknown) => {
    if (typeof roomId !== 'number') return;
    const area = map.rooms[roomId]?.area;
    if (typeof area === 'number') areaIds.add(area);
  };

  const visit = (cmd: AnyCommand) => {
    if (cmd.kind === 'batch') {
      for (const child of cmd.cmds ?? []) visit(child);
      return;
    }
    if (NEEDS_RELOAD.has(cmd.kind)) {
      needsReload.add(cmd.kind);
      return;
    }

    // Explicit area references (label edits, area renames, room moves between areas).
    for (const field of ['areaId', 'fromAreaId', 'toAreaId'] as const) {
      const value = cmd[field];
      if (typeof value === 'number') areaIds.add(value);
    }
    if (Array.isArray(cmd.affectedOtherAreaIds)) {
      for (const id of cmd.affectedOtherAreaIds) {
        if (typeof id === 'number') areaIds.add(id);
      }
    }

    for (const field of ROOM_ID_FIELDS) addRoomsArea(cmd[field]);
    if (Array.isArray(cmd.roomIds)) cmd.roomIds.forEach(addRoomsArea);

    // Exit edits rewrite the far side too, which may sit in another area.
    const reverse = cmd.reverse as { fromId?: number } | null | undefined;
    addRoomsArea(reverse?.fromId);
    if (Array.isArray(cmd.exits)) {
      for (const exit of cmd.exits) addRoomsArea(exit?.reverse?.fromId);
    }
    if (Array.isArray(cmd.neighborEdits)) {
      for (const edit of cmd.neighborEdits) addRoomsArea(edit?.roomId);
    }
  };

  for (const cmd of cmds) visit(cmd as AnyCommand);

  return { areaIds: [...areaIds], needsReload: [...needsReload] };
}

/**
 * Reverse of `mpRoomDbHashToRoomId`, cached per map.
 *
 * Room hashes matter to the client beyond display: it resolves the player's
 * position by hash, so a synced room that lost its hash would break location
 * tracking for that room.
 */
let hashCache: { map: MudletMap; byRoomId: Map<number, string> } | null = null;

function roomHashes(map: MudletMap): Map<number, string> {
  if (hashCache?.map === map) return hashCache.byRoomId;

  const byRoomId = new Map<number, string>();
  for (const [hash, roomId] of Object.entries(map.mpRoomDbHashToRoomId ?? {})) {
    byRoomId.set(roomId as number, hash);
  }
  hashCache = { map, byRoomId };
  return byRoomId;
}

/** Drop the cached hash index — call when a different map is opened. */
export function resetAreaSyncCache() {
  hashCache = null;
}

/**
 * Export the whole map in the shape the client loads.
 *
 * Uses the binary reader's own exporter — the same one that generates the
 * published `mapExport.json` — so the client receives a payload indistinguishable
 * from the file it normally downloads, colour palette included.
 *
 * Around 11 MB for the full Arkadia map, so this is for explicit requests only.
 */
export function buildWholeMap(map: MudletMap): { mapData: unknown[]; colors: unknown } {
  const exported = readerExport(map);
  return { mapData: exported.mapData, colors: exported.colors };
}

/** Build renderer-shaped payloads for the given areas. */
export function buildAreas(areaIds: readonly number[], map: MudletMap): SyncedArea[] {
  const hashes = roomHashes(map);
  const areas: SyncedArea[] = [];

  for (const areaId of areaIds) {
    const area = map.areas?.[areaId];
    if (!area) continue;

    const rooms = [];
    for (const roomId of area.rooms ?? []) {
      const room = map.rooms[roomId];
      if (!room) continue;
      rooms.push(convertRoom(roomId, room, hashes.get(roomId)));
    }

    areas.push({
      areaId,
      areaName: map.areaNames?.[areaId] ?? '',
      rooms,
      labels: (map.labels?.[areaId] ?? []).map(convertLabel),
    });
  }

  return areas;
}
