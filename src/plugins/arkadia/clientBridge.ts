/**
 * Editor half of the bridge to the Arkadia web client.
 *
 * Owns the transport, tracks whether a client is live, applies the requests it
 * sends, and — when following is on — pans the map to the player as they walk.
 * State follows the same module-singleton + listener-set pattern as
 * `github-sync/state.ts`; components subscribe and force a re-render.
 */

import { pushCommand, store } from 'mudlet-map-editor';
import type { RoomSectionProps } from 'mudlet-map-editor';
import { createBridge, type Bridge, type BridgeMessage, type ClientPosition } from '../../bridge/protocol';
import { buildAreas, buildWholeMap, collectAffectedAreas, resetAreaSyncCache } from './areaSync';

/** `SceneHandle` itself is not a public export, but the ref type reaches us here. */
export type SceneRef = RoomSectionProps['sceneRef'];

const FOLLOW_KEY = 'arkadia_client_follow';
const SELECT_KEY = 'arkadia_client_select';
const LIVE_EDIT_KEY = 'arkadia_client_live_edit';
/** A client heartbeats every 20s; two missed beats and we call it gone. */
const PRESENCE_TIMEOUT_MS = 55_000;
/** Running through a corridor fires a move per step — pan at most this often. */
const FOLLOW_THROTTLE_MS = 150;

export interface AppliedEntry {
  roomId: number;
  from: string;
  to: string;
  at: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();
function notify() { listeners.forEach((l) => l()); }

export function subscribe(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

let bridge: Bridge | null = null;

let _connected = false;
let _lastSeen = 0;
let _position: ClientPosition | null = null;
let _applied: AppliedEntry[] = [];
let _follow = localStorage.getItem(FOLLOW_KEY) === 'true';
let _select = localStorage.getItem(SELECT_KEY) === 'true';
let _liveEdit = localStorage.getItem(LIVE_EDIT_KEY) === 'true';
/** Undo-stack depth at the last check — how new commands and undos are spotted. */
let _lastUndoLength = 0;
/** Rooms the client reports holding — compared with ours to spot a version drift. */
let _clientRoomCount: number | null = null;

export function isConnected() { return _connected; }
export function getPosition() { return _position; }
export function getApplied() { return _applied; }
export function getClientRoomCount() { return _clientRoomCount; }

export function getFollow() { return _follow; }
export function setFollow(v: boolean) {
  _follow = v;
  localStorage.setItem(FOLLOW_KEY, String(v));
  // Turning follow on mid-walk should jump to wherever the player already is.
  if (v && _position) followTo(_position);
  notify();
}

export function getSelect() { return _select; }
export function setSelect(v: boolean) {
  _select = v;
  localStorage.setItem(SELECT_KEY, String(v));
  notify();
}

export function getLiveEdit() { return _liveEdit; }
export function setLiveEdit(v: boolean) {
  _liveEdit = v;
  localStorage.setItem(LIVE_EDIT_KEY, String(v));
  // Re-baseline: edits made while off are not replayed, they would arrive
  // without the context that made them meaningful.
  _lastUndoLength = store.getState().undo.length;
  notify();
}

/**
 * The editor hands a scene ref to plugin render hooks but never to lifecycle
 * hooks, so we latch the first one we are given. App owns a single stable ref
 * object, so one capture stays valid for the session — and `pushCommand` with a
 * scene keeps the renderer in sync instead of forcing a full rebuild.
 */
let sceneRef: SceneRef | null = null;
export function captureSceneRef(ref: SceneRef) {
  if (!sceneRef) sceneRef = ref;
}

// ── Transport lifecycle ──

export function startClientBridge() {
  if (bridge) return;

  bridge = createBridge({
    role: 'editor',
    onMessage: (msg) => handleClientMessage(msg),
  });

  announce();
  watchForEdits();

  // Lives as long as the tab does — the bridge has no stop path.
  setInterval(() => {
    if (_connected && Date.now() - _lastSeen > PRESENCE_TIMEOUT_MS) {
      _connected = false;
      notify();
    }
  }, 5_000);

  window.addEventListener('beforeunload', () => bridge?.post({ t: 'editor-bye' }));
}

/**
 * Mirror edits into the connected client by watching the undo stack.
 *
 * The stack doubles as a change feed: it grows by one entry per applied command
 * and shrinks by one per undo. Comparing its depth between notifications tells
 * us which commands were involved — and since we only read them to work out
 * *which areas* to resend, an undo needs no special handling. The area is
 * rebuilt from whatever the map holds by then, reverted value included.
 */
function watchForEdits() {
  _lastUndoLength = store.getState().undo.length;

  store.subscribe((state) => {
    const undo = state.undo;
    const previous = _lastUndoLength;
    if (undo.length === previous) return;

    // Loading a different map resets the stack; re-baseline instead of
    // forwarding a phantom "everything changed".
    const grew = undo.length > previous;
    const touched = grew
      ? undo.slice(previous)
      // On undo the commands leave `undo` and land on top of `redo`, newest last.
      : state.redo.slice(state.redo.length - (previous - undo.length));
    _lastUndoLength = undo.length;

    if (!_liveEdit || !_connected || !state.map || touched.length === 0) return;

    const { areaIds, needsReload } = collectAffectedAreas(touched, state.map);
    if (areaIds.length === 0 && needsReload.length === 0) return;

    bridge?.post({
      t: 'sync-areas',
      areas: buildAreas(areaIds, state.map),
      needsReload,
    });
  });
}

/**
 * Send the whole open map to the client, replacing whatever it had.
 *
 * Expensive by nature (~11 MB for the full map), so this is only ever triggered
 * by the user or by an explicit client request — never automatically. Once done,
 * both sides are provably on the same map and later area syncs cannot land on
 * the wrong rooms.
 */
export function pushWholeMap(): boolean {
  const { map, loaded } = store.getState();
  if (!map) return false;

  const { mapData, colors } = buildWholeMap(map);
  bridge?.post({
    t: 'push-map',
    mapData,
    colors,
    version: map.mUserData?.['version'] ?? null,
    fileName: loaded?.fileName ?? null,
  });
  // The client's map is now ours, so anything before this point is irrelevant.
  _lastUndoLength = store.getState().undo.length;
  _clientRoomCount = Object.keys(map.rooms).length;
  notify();
  return true;
}

/** Called when a map closes so the area-sync hash index does not linger. */
export function onMapClosed() {
  resetAreaSyncCache();
  _lastUndoLength = 0;
}

/** Tell any listening client which map is open — also prompts it to re-announce. */
export function announce() {
  const { map, loaded } = store.getState();
  bridge?.post({
    t: 'editor-hello',
    fileName: loaded?.fileName ?? null,
    roomCount: map ? Object.keys(map.rooms).length : 0,
  });
}

function markSeen() {
  _lastSeen = Date.now();
  if (!_connected) {
    _connected = true;
    return true;
  }
  return false;
}

function handleClientMessage(msg: BridgeMessage) {
  switch (msg.t) {
    case 'client-hello': {
      const becameConnected = markSeen();
      const previousCount = _clientRoomCount;
      _clientRoomCount = msg.roomCount ?? null;
      if (becameConnected) {
        announce(); // first sight of this client — tell it what map we hold
      }
      if (becameConnected || previousCount !== _clientRoomCount) notify();
      break;
    }
    case 'request-map':
      markSeen();
      pushWholeMap();
      break;
    case 'client-bye':
      _connected = false;
      _position = null;
      notify();
      break;
    case 'position':
      markSeen();
      _position = msg.position;
      if (_follow && msg.position) followTo(msg.position);
      notify();
      break;
    case 'set-room-name':
      markSeen();
      applyRoomName(msg.reqId, msg.roomId, msg.name);
      break;
    default:
      break;
  }
}

// ── Applying requests ──

function applyRoomName(reqId: string, roomId: number, name: string) {
  const reply = (ok: boolean, text: string) => bridge?.post({ t: 'result', reqId, ok, text });

  const map = store.getState().map;
  if (!map) {
    reply(false, 'edytor nie ma otwartej mapy.');
    return;
  }

  const room = map.rooms[roomId];
  if (!room) {
    reply(false, `lokacja #${roomId} nie istnieje w otwartej mapie.`);
    return;
  }

  const from = room.name ?? '';
  if (from === name) {
    reply(true, `#${roomId} juz ma te nazwe.`);
    return;
  }

  const scene = sceneRef?.current ?? null;
  pushCommand({ kind: 'setRoomField', id: roomId, field: 'name', from, to: name }, scene);
  if (scene) {
    scene.refresh();
    store.bumpData();
  } else {
    // No scene captured yet — a structural bump makes App rebuild so the new
    // label actually shows up.
    store.bumpStructure();
  }

  refreshSelectionPanel(roomId);

  _applied = [{ roomId, from, to: name, at: Date.now() }, ..._applied].slice(0, 20);
  notify();
  reply(true, `#${roomId}: "${from || '—'}" → "${name}"`);
}

/**
 * Force the room panel to re-read a room we just changed from outside it.
 *
 * The panel keeps the name/symbol/weight inputs in local React state and only
 * resyncs them when the *room object identity* changes. `setRoomField` mutates
 * the room in place, so an edit made from here updates the data while an open
 * panel keeps showing its cached value — it looks like nothing happened until
 * you click away and back. Clearing and restoring the selection remounts it.
 *
 * Only touches the selection when it is exactly the room we renamed, so a
 * capture elsewhere on the map never disturbs what the user has selected.
 */
function refreshSelectionPanel(roomId: number) {
  const selection = store.getState().selection;
  if (selection?.kind !== 'room' || selection.ids.length !== 1 || selection.ids[0] !== roomId) return;

  store.setState({ selection: null });
  setTimeout(() => {
    const still = store.getState().selection;
    // Don't fight the user if they selected something else in the meantime.
    if (still === null) store.setState({ selection: { kind: 'room', ids: [roomId] } });
  }, 0);
}

// ── Following ──

let followPending: ClientPosition | null = null;
let followTimer: ReturnType<typeof setTimeout> | undefined;

function followTo(position: ClientPosition) {
  followPending = position;
  if (followTimer !== undefined) return;
  followTimer = setTimeout(() => {
    followTimer = undefined;
    const next = followPending;
    followPending = null;
    if (next) navigateToRoom(next.roomId, _select);
  }, FOLLOW_THROTTLE_MS);
}

/**
 * Pan (and switch plane when needed) to a room. Selection is opt-in: following
 * would otherwise clobber whatever the user has selected on every step.
 */
export function navigateToRoom(roomId: number, select: boolean) {
  const s = store.getState();
  const room = s.map?.rooms[roomId];
  if (!room) return;

  const selection = select ? { selection: { kind: 'room' as const, ids: [roomId] } } : {};

  if (room.area !== s.currentAreaId || room.z !== s.currentZ) {
    store.setState({
      ...selection,
      currentAreaId: room.area,
      currentZ: room.z,
      navigateTo: { mapX: room.x, mapY: -room.y },
    });
    store.bumpStructure();
  } else {
    store.setState({
      ...selection,
      panRequest: { mapX: room.x, mapY: -room.y },
    });
  }
}
