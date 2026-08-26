/**
 * Arkadia web client plugin — the client half of the editor bridge.
 *
 * Built standalone (`yarn build:client-plugin`) into `public/client-plugin.js`,
 * so it ships to the same GitHub Pages origin as the editor and the user pastes
 * its URL into the client's plugin list. Keeping both halves of the protocol in
 * this repo means they version together.
 *
 * What it does:
 *   - streams the player's position to any open editor tab, so the editor can
 *     follow along as you walk;
 *   - `/edytor nazwa` captures the game's current room short and sets it as the
 *     name of the current room in the editor.
 *
 * Note on syntax: the host loads plugins with `import()` and, if that fails,
 * retries by injecting a classic `<script src>`. That fallback cannot execute an
 * ES module at all, so a module-load failure surfaces as a syntax error on the
 * first module-only construct in the file. Keep `import.meta` out of here — it
 * makes that error land far from its real cause (see the transport note below).
 */

import type { PluginApi, PluginInfo } from '@arkadia/plugin-types';
import {
  createBridge,
  type Bridge,
  type BridgeMessage,
  type ClientPosition,
  type SyncedArea,
} from '../bridge/protocol';

const PREFIX = '[edytor]';
/** Heartbeat cadence — cheap (no network), keeps the editor's presence honest. */
const HELLO_INTERVAL_MS = 20_000;
const RELAY_KEY = 'arkadiaMapEditorOrigin';

/**
 * Where the editor lives, when it is *not* on this origin.
 *
 * In production both apps are served from the same GitHub Pages site, so
 * BroadcastChannel reaches the editor directly and this returns null. Local
 * development puts them on different ports, which BroadcastChannel cannot
 * cross; setting `localStorage.arkadiaMapEditorOrigin` to the editor's URL
 * routes traffic through its relay iframe instead.
 */
function resolveRelay(): { origin: string; path: string } | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RELAY_KEY);
  } catch {
    return null; // storage blocked — same-origin BroadcastChannel is the normal path
  }
  if (!raw) return null;

  try {
    const url = new URL(raw, location.href);
    const path = url.pathname.endsWith('.html')
      ? url.pathname
      : url.pathname.replace(/\/*$/, '/') + 'bridge.html';
    return { origin: url.origin, path };
  } catch {
    return null;
  }
}

let bridge: Bridge | null = null;
let helloTimer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
/** Kept for teardown: the host's `cleanup()` drops aliases but not event listeners. */
let host: PluginApi | null = null;

/** Last line the server tagged as a room short — the text `/edytor nazwa` captures. */
let lastShort: string | null = null;
let onRoomShort: ((buffer: { text: string }) => void) | null = null;
let onEnterLocation: (() => void) | null = null;
/** Last room we reported, so re-entering the same room doesn't re-post. */
let lastReportedRoomId: number | null = null;

let reqSeq = 0;
function nextReqId(): string {
  return `r${++reqSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentPosition(api: PluginApi): ClientPosition | null {
  const room = api.map.getRoom();
  if (!room || typeof room.id !== 'number') return null;
  return {
    roomId: room.id,
    areaId: room.area,
    name: room.name ?? '',
    x: room.x,
    y: room.y,
    z: room.z,
  };
}

/** (Re)open the transport. Called at init and whenever `/edytor polacz` changes it. */
function connect(api: PluginApi) {
  bridge?.close();
  const relay = resolveRelay();

  bridge = createBridge({
    role: 'client',
    relayOrigin: relay?.origin,
    relayPath: relay?.path,
    onMessage: (msg) => handleEditorMessage(api, msg),
    onStatus: (status, detail) => {
      if (status === 'timeout') {
        api.output.print(`${PREFIX} przekaznik nie odpowiada: ${detail}`);
        api.output.print(`${PREFIX} sprawdz, czy edytor dziala pod tym adresem (i czy to ta sama karta, ktora obserwujesz).`);
      } else if (status === 'ready') {
        api.output.print(`${PREFIX} przekaznik gotowy: ${detail}`);
      } else if (status === 'unsupported') {
        api.output.print(`${PREFIX} ta przegladarka nie wspiera BroadcastChannel.`);
      }
    },
  });

  bridge.post(helloMessage(api));
}

export async function init(api: PluginApi): Promise<PluginInfo> {
  disposed = false;
  host = api;

  connect(api);

  const sayHello = () => bridge?.post(helloMessage(api));
  helloTimer = setInterval(sayHello, HELLO_INTERVAL_MS);

  // The server tags the room title line, so the short needs no regex.
  onRoomShort = (buffer) => {
    const text = buffer?.text?.trim();
    if (text) lastShort = text;
  };
  api.events.on('gmcp_msg.room.short', onRoomShort as never);

  // `enterLocation`, not `mapMove`. Every room change funnels through
  // MapHelper.renderRoomById, which emits `enterLocation`; only some of its
  // callers also emit `mapMove`, and that one is suppressible. Notably
  // setMapRoomById — used by `/ustaw`, right-click set-location and
  // api.map.setLocation — emits no `mapMove` at all. Silent renders pass
  // sendEvent=false, so they correctly stay silent here too.
  onEnterLocation = () => {
    const position = currentPosition(api);
    if (position && position.roomId === lastReportedRoomId) return;
    lastReportedRoomId = position?.roomId ?? null;
    bridge?.post({ t: 'position', position });
  };
  api.events.on('enterLocation', onEnterLocation as never);

  api.aliases.register(/^\/edytor(?:\s+(.*))?$/, (matches) => {
    handleAlias(api, (matches?.[1] ?? '').trim());
    return true;
  });

  window.addEventListener('beforeunload', sayGoodbye);

  return {
    name: 'Edytor mapy',
    version: '1.0.0',
    author: 'Delwing',
    description: 'Most do edytora mapy Arkadii — podazanie za postacia i przechwytywanie nazwy lokacji.',
  };
}

/**
 * Presence beat, carrying how many rooms this client holds. The editor compares
 * it with its own count as a cheap early warning that the two sides are on
 * different map versions — in which case room ids mean different things.
 */
function helloMessage(api: PluginApi) {
  let roomCount = 0;
  try {
    for (const area of api.map.getAreas()) roomCount += area.rooms.length;
  } catch {
    // Map not loaded yet; 0 is the honest answer.
  }
  return { t: 'client-hello' as const, character: null, roomCount };
}

function sayGoodbye() {
  bridge?.post({ t: 'client-bye' });
}

function handleEditorMessage(api: PluginApi, msg: BridgeMessage) {
  switch (msg.t) {
    case 'editor-hello':
      // An editor tab just opened (or reloaded) — re-announce so it can show
      // presence, and hand it the current position right away.
      bridge?.post(helloMessage(api));
      bridge?.post({ t: 'position', position: currentPosition(api) });
      break;
    case 'result':
      api.output.print(`${PREFIX} ${msg.ok ? '' : 'blad: '}${msg.text}`);
      break;
    case 'sync-areas':
      syncAreas(api, msg.areas, msg.needsReload);
      break;
    case 'push-map': {
      const ok = api.map.replaceMap(msg.mapData as never, msg.colors as never);
      api.output.print(
        ok
          ? `${PREFIX} zaladowano mape z edytora${msg.version ? ` (wersja ${msg.version})` : ''}.`
          : `${PREFIX} edytor przyslal pusta mape — nic nie zmieniam.`,
      );
      // A fresh map means earlier "cannot mirror" warnings no longer apply.
      if (ok) warnedNeedsReload.clear();
      break;
    }
    default:
      break;
  }
}

/** Command kinds already reported as unmirrorable — warn once each, not per edit. */
const warnedNeedsReload = new Set<string>();

function syncAreas(api: PluginApi, areas: SyncedArea[], needsReload: string[]) {
  if (areas.length > 0) {
    // The payload is already in the shape the client loads its map in, so it
    // goes straight through — including y in source orientation, which the
    // host flips exactly as it does at load time.
    const synced = api.map.syncAreas(areas as never);
    if (synced === 0) {
      // No area matched — almost always a different map version on each side.
      api.output.print(`${PREFIX} zmiany nie pasuja do tej mapy (inna wersja?).`);
    }
  }

  const fresh = needsReload.filter((kind) => !warnedNeedsReload.has(kind));
  if (fresh.length > 0) {
    fresh.forEach((kind) => warnedNeedsReload.add(kind));
    api.output.print(`${PREFIX} te zmiany wymagaja przeladowania mapy: ${fresh.join(', ')}`);
  }
}

function handleAlias(api: PluginApi, args: string) {
  const [subcommand, ...rest] = args.split(/\s+/);
  const remainder = rest.join(' ').trim();

  switch (subcommand) {
    case '':
    case 'status':
      printStatus(api);
      return;
    case 'nazwa':
      captureName(api, remainder);
      return;
    case 'polacz':
      setRelay(api, remainder);
      return;
    case 'mapa':
      bridge?.post({ t: 'request-map' });
      api.output.print(`${PREFIX} prosze edytor o mape — to moze chwile potrwac.`);
      return;
    default:
      api.output.print(`${PREFIX} nieznane polecenie: ${subcommand}`);
      printStatus(api);
  }
}

/**
 * Point the bridge at an editor on another origin — the local-editor +
 * published-client setup. Without an argument, clears it and goes back to the
 * same-origin channel (what production uses).
 */
function setRelay(api: PluginApi, target: string) {
  try {
    if (target) localStorage.setItem(RELAY_KEY, target);
    else localStorage.removeItem(RELAY_KEY);
  } catch {
    api.output.print(`${PREFIX} nie moge zapisac ustawienia — pamiec przegladarki jest zablokowana.`);
    return;
  }

  const relay = resolveRelay();
  if (target && !relay) {
    api.output.print(`${PREFIX} nieprawidlowy adres: ${target}`);
    return;
  }

  connect(api);
  api.output.print(
    relay
      ? `${PREFIX} lacze przez przekaznik ${relay.origin}${relay.path}`
      : `${PREFIX} lacze w obrebie tej samej domeny.`,
  );
}

function printStatus(api: PluginApi) {
  const position = currentPosition(api);
  const relay = resolveRelay();
  api.output.print(`${PREFIX} lokacja: ${position ? `#${position.roomId} ${position.name}` : 'nieznana'}`);
  api.output.print(`${PREFIX} krotki opis: ${lastShort ?? '— brak —'}`);
  const transport = relay ? `przekaznik ${relay.origin}${relay.path}` : 'ta sama domena';
  api.output.print(`${PREFIX} polaczenie: ${transport} [${bridge?.status() ?? 'brak'}]`);
  api.output.print(`${PREFIX} edytor musi byc otwarty pod ${relay ? relay.origin : location.origin}`);
  api.output.print(`${PREFIX} /edytor nazwa [tekst]  — ustaw nazwe biezacej lokacji w edytorze`);
  api.output.print(`${PREFIX} /edytor mapa           — zaladuj mape prosto z edytora`);
  api.output.print(`${PREFIX} /edytor polacz [adres] — wskaz edytor na innej domenie (bez adresu: ta sama domena)`);
}

function captureName(api: PluginApi, explicit: string) {
  const position = currentPosition(api);
  if (!position) {
    api.output.print(`${PREFIX} nie wiem, gdzie jestes — mapa nie ma ustalonej lokacji.`);
    return;
  }

  const name = explicit || lastShort;
  if (!name) {
    api.output.print(`${PREFIX} nie mam krotkiego opisu. Rozejrzyj sie i sprobuj ponownie.`);
    return;
  }

  bridge?.post({ t: 'set-room-name', reqId: nextReqId(), roomId: position.roomId, name });
  api.output.print(`${PREFIX} wysylam do edytora: #${position.roomId} → "${name}"`);
}

export async function destroy(): Promise<void> {
  if (disposed) return;
  disposed = true;

  window.removeEventListener('beforeunload', sayGoodbye);
  if (helloTimer !== undefined) clearInterval(helloTimer);
  helloTimer = undefined;

  // The host's cleanup() unregisters aliases but leaves event listeners to us.
  if (host) {
    if (onRoomShort) host.events.off('gmcp_msg.room.short', onRoomShort as never);
    if (onEnterLocation) host.events.off('enterLocation', onEnterLocation as never);
  }
  onRoomShort = null;
  onEnterLocation = null;
  lastReportedRoomId = null;
  host = null;

  sayGoodbye();
  bridge?.close();
  bridge = null;
  lastShort = null;
}
