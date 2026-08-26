/**
 * Cross-tab bridge between this editor and the Arkadia web client.
 *
 * Both apps ship to the same GitHub Pages origin, so in production a plain
 * BroadcastChannel reaches every tab of either app. Local development breaks
 * that: the two Vite servers sit on different ports and BroadcastChannel is
 * strictly same-origin. There we tunnel through a relay iframe served from the
 * editor's own origin (`public/bridge.html`), which re-publishes onto the
 * channel on the editor's behalf.
 *
 * The client plugin is loaded *from the editor's origin*, so it can derive the
 * relay URL from its own module URL and pick the right transport with no
 * configuration. See `src/client-plugin/index.ts`.
 */

export const BRIDGE_CHANNEL = 'arkadia-map-bridge';
export const PROTOCOL_VERSION = 1;

export type BridgeRole = 'client' | 'editor';

/** Where the player currently stands, as the client's mapper resolved it. */
export interface ClientPosition {
  roomId: number;
  areaId: number;
  /** Room name from the *map*, not the game's short — used for display only. */
  name: string;
  /**
   * Client-space coordinates, which are y-**down** — the opposite of the raw
   * Mudlet y-up coordinates the editor holds. The editor navigates by `roomId`
   * and reads coordinates from its own map, so these are informational only.
   * Anything that starts using them must flip y first (see `liveEdit.ts`).
   */
  x: number;
  y: number;
  z: number;
}

export type ClientMessage =
  /** Sent on connect and as a periodic heartbeat so the editor can show presence. */
  | { t: 'client-hello'; character: string | null; roomCount: number }
  /** Asks the editor to send its whole map over (see `push-map`). */
  | { t: 'request-map' }
  | { t: 'client-bye' }
  | { t: 'position'; position: ClientPosition | null }
  | { t: 'set-room-name'; reqId: string; roomId: number; name: string };

/**
 * One area in the shape the client's renderer consumes — identical to an entry
 * in the published `mapExport.json`, produced by the binary reader's own
 * `convertRoom`/`convertLabel`.
 *
 * Coordinates stay in **source orientation** (y-up, as Mudlet stores them). The
 * client flips y on the way in, exactly as it does when first loading the map,
 * which keeps that conversion in one place rather than spread across the wire.
 */
export interface SyncedArea {
  areaId: number;
  areaName: string;
  rooms: unknown[];
  labels: unknown[];
}

export type EditorMessage =
  | { t: 'editor-hello'; fileName: string | null; roomCount: number }
  | { t: 'editor-bye' }
  /** Outcome of a request, echoed back to the client so it can print feedback. */
  | { t: 'result'; reqId: string; ok: boolean; text: string }
  /**
   * Areas to replace in the client's in-memory map, mirroring an edit.
   *
   * `needsReload` names command kinds in the same change that no area sync can
   * express — ones that add or remove areas, or change the shared colour
   * palette — so the client can say its view is incomplete rather than silently
   * drifting from the editor.
   */
  | { t: 'sync-areas'; areas: SyncedArea[]; needsReload: string[] }
  /**
   * The whole map being edited, for the client to load in place of its own.
   *
   * The heavy option — around 11 MB for the full Arkadia map — so it is only
   * ever sent on an explicit request, never per edit. Its real value is
   * alignment: once the client holds exactly the map in the editor, every later
   * area sync is guaranteed to land on the right rooms.
   */
  | { t: 'push-map'; mapData: unknown[]; colors: unknown; version: string | null; fileName: string | null };

export type BridgeMessage = ClientMessage | EditorMessage;

interface Envelope {
  ch: typeof BRIDGE_CHANNEL;
  v: number;
  from: string;
  role: BridgeRole;
  msg: BridgeMessage;
}

/** Handshake frames exchanged with the relay iframe — never hit the channel. */
type RelayFrame =
  | { ch: typeof BRIDGE_CHANNEL; relay: 'hello' }
  | { ch: typeof BRIDGE_CHANNEL; relay: 'ready' };

/**
 * Transport health. `direct` needs no setup and is ready immediately; the relay
 * has to load an iframe and shake hands, which can fail silently (wrong port,
 * editor not running, blocked frame) — hence `timeout`.
 */
export type BridgeStatus = 'direct' | 'connecting' | 'ready' | 'timeout' | 'unsupported';

export interface Bridge {
  readonly peerId: string;
  /** Current transport health; poll it for status output. */
  status(): BridgeStatus;
  post(msg: BridgeMessage): void;
  close(): void;
}

export interface BridgeOptions {
  role: BridgeRole;
  onMessage(msg: BridgeMessage, from: string, role: BridgeRole): void;
  /**
   * Origin serving `bridge.html`. When it differs from this page's origin the
   * relay iframe is used; when it matches (or is omitted) we talk to the
   * BroadcastChannel directly.
   */
  relayOrigin?: string;
  /** Path to the relay page on `relayOrigin`. Defaults to `/bridge.html`. */
  relayPath?: string;
  /** Called whenever transport health changes — used to report a dead relay. */
  onStatus?(status: BridgeStatus, detail: string): void;
}

/** How long the relay iframe gets to load and hand back its ready frame. */
const RELAY_READY_TIMEOUT_MS = 5_000;

function isEnvelope(data: unknown): data is Envelope {
  if (typeof data !== 'object' || data === null) return false;
  const e = data as Partial<Envelope>;
  return (
    e.ch === BRIDGE_CHANNEL &&
    e.v === PROTOCOL_VERSION &&
    typeof e.from === 'string' &&
    (e.role === 'client' || e.role === 'editor') &&
    typeof e.msg === 'object' &&
    e.msg !== null &&
    typeof (e.msg as BridgeMessage).t === 'string'
  );
}

function newPeerId(role: BridgeRole): string {
  return `${role}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createBridge(opts: BridgeOptions): Bridge {
  const peerId = newPeerId(opts.role);

  const deliver = (data: unknown) => {
    if (!isEnvelope(data)) return;
    if (data.from === peerId) return; // our own echo
    opts.onMessage(data.msg, data.from, data.role);
  };

  const wrap = (msg: BridgeMessage): Envelope => ({
    ch: BRIDGE_CHANNEL,
    v: PROTOCOL_VERSION,
    from: peerId,
    role: opts.role,
    msg,
  });

  const sameOrigin = !opts.relayOrigin || opts.relayOrigin === location.origin;

  if (sameOrigin) {
    if (typeof BroadcastChannel === 'undefined') {
      opts.onStatus?.('unsupported', 'BroadcastChannel is unavailable in this browser');
      return { peerId, status: () => 'unsupported', post: () => {}, close: () => {} };
    }
    const channel = new BroadcastChannel(BRIDGE_CHANNEL);
    channel.onmessage = (e) => deliver(e.data);
    return {
      peerId,
      status: () => 'direct',
      post: (msg) => channel.postMessage(wrap(msg)),
      close: () => channel.close(),
    };
  }

  // ── Cross-origin: tunnel through the relay iframe ──
  const relayOrigin = opts.relayOrigin!;
  const relayUrl = relayOrigin + (opts.relayPath ?? '/bridge.html');

  const iframe = document.createElement('iframe');
  iframe.src = relayUrl;
  iframe.style.display = 'none';
  iframe.setAttribute('aria-hidden', 'true');

  let state: BridgeStatus = 'connecting';
  const queue: Envelope[] = [];

  // A relay that never answers is the failure mode that looks like nothing
  // happening at all: messages just pile up in the queue. Give up loudly.
  const readyTimer = setTimeout(() => {
    if (state === 'connecting') {
      state = 'timeout';
      queue.length = 0;
      opts.onStatus?.('timeout', relayUrl);
    }
  }, RELAY_READY_TIMEOUT_MS);

  const sendToRelay = (payload: Envelope | RelayFrame) => {
    iframe.contentWindow?.postMessage(payload, relayOrigin);
  };

  const onWindowMessage = (e: MessageEvent) => {
    if (e.origin !== relayOrigin || e.source !== iframe.contentWindow) return;
    const data = e.data as RelayFrame | Envelope;
    if (typeof data === 'object' && data !== null && (data as RelayFrame).relay === 'ready') {
      clearTimeout(readyTimer);
      state = 'ready';
      opts.onStatus?.('ready', relayUrl);
      for (const queued of queue.splice(0)) sendToRelay(queued);
      return;
    }
    deliver(data);
  };

  window.addEventListener('message', onWindowMessage);
  iframe.addEventListener('load', () => {
    sendToRelay({ ch: BRIDGE_CHANNEL, relay: 'hello' });
  });
  iframe.addEventListener('error', () => {
    clearTimeout(readyTimer);
    state = 'timeout';
    opts.onStatus?.('timeout', relayUrl);
  });
  document.body.appendChild(iframe);

  return {
    peerId,
    status: () => state,
    post: (msg) => {
      const envelope = wrap(msg);
      if (state === 'ready') sendToRelay(envelope);
      else if (state === 'connecting') queue.push(envelope);
      // 'timeout' drops: nothing is listening, and an unbounded queue would
      // just replay a burst of stale positions if it ever recovered.
    },
    close: () => {
      clearTimeout(readyTimer);
      window.removeEventListener('message', onWindowMessage);
      iframe.remove();
    },
  };
}
