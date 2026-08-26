import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorState } from 'mudlet-map-editor';
import type { SceneRef } from './clientBridge';
import {
  captureSceneRef,
  getApplied,
  getClientRoomCount,
  getFollow,
  getLiveEdit,
  getPosition,
  getSelect,
  isConnected,
  navigateToRoom,
  pushWholeMap,
  setFollow,
  setLiveEdit,
  setSelect,
  subscribe,
} from './clientBridge';
import './arkadia.css';

/** The plugin bundle ships next to the editor, so its URL is relative to this page. */
function pluginUrl() {
  try {
    return new URL('client-plugin.js', document.baseURI).href;
  } catch {
    return 'client-plugin.js';
  }
}

function ConnectionHint() {
  const { t } = useTranslation('arkadia');
  const [copied, setCopied] = useState(false);
  const url = pluginUrl();

  const copy = () => {
    navigator.clipboard?.writeText(url).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => { /* clipboard blocked — the url is on screen to copy by hand */ },
    );
  };

  // A local editor cannot share a BroadcastChannel with a client on another
  // origin (the usual dev setup: published client, editor on localhost), so the
  // client has to be pointed at this origin explicitly.
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  return (
    <>
      <p className="hint">{t('client.setupHint')}</p>
      <div className="client-plugin-url">
        <code>{url}</code>
        <button type="button" onClick={copy}>
          {copied ? t('client.copied') : t('client.copy')}
        </button>
      </div>
      {isLocal && (
        <>
          <p className="hint" style={{ marginTop: 8 }}>{t('client.relayHint')}</p>
          <div className="client-plugin-url">
            <code>/edytor polacz {location.origin}/</code>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Pushing the whole map is the cure for a version mismatch, so the room-count
 * comparison and the button that fixes it belong together.
 */
function MapPushRow() {
  const { t } = useTranslation('arkadia');
  const [busy, setBusy] = useState(false);
  const map = useEditorState((s) => s.map);

  const ourCount = map ? Object.keys(map.rooms).length : 0;
  const theirCount = getClientRoomCount();
  const mismatch = theirCount !== null && ourCount > 0 && theirCount > 0 && theirCount !== ourCount;

  const push = () => {
    setBusy(true);
    // Serialising ~27k rooms blocks; let the button repaint as disabled first.
    requestAnimationFrame(() => {
      try {
        pushWholeMap();
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <>
      <h4 style={{ marginTop: 14 }}>{t('client.mapTitle')}</h4>
      {mismatch && (
        <p className="hint" style={{ color: '#ffd080' }}>
          {t('client.roomCountMismatch', { ours: ourCount, theirs: theirCount })}
        </p>
      )}
      <button type="button" disabled={!map || busy || !isConnected()} onClick={push}>
        {busy ? t('client.pushingMap') : t('client.pushMap')}
      </button>
      <p className="hint">{t('client.pushMapHint')}</p>
    </>
  );
}

export function ClientTab({ sceneRef }: { sceneRef: SceneRef }) {
  const { t } = useTranslation('arkadia');
  const [, rerender] = useState(0);
  useEffect(() => subscribe(() => rerender((n) => n + 1)), []);

  // Latching the ref here lets name captures update the renderer directly
  // instead of forcing a full structural rebuild.
  useEffect(() => captureSceneRef(sceneRef), [sceneRef]);

  // Room names change under us when a capture lands; re-read on every mutation.
  useEditorState((s) => s.dataVersion);
  const map = useEditorState((s) => s.map);

  const connected = isConnected();
  const position = getPosition();
  const applied = getApplied();
  const knownRoom = position && map ? map.rooms[position.roomId] : undefined;

  return (
    <>
      <h4>{t('client.title')}</h4>

      <div className={`client-status client-status--${connected ? 'on' : 'off'}`}>
        <span className="client-status-dot" />
        {connected ? t('client.connected') : t('client.disconnected')}
      </div>

      {!connected && <ConnectionHint />}

      <div className="gps-list" style={{ marginTop: 10 }}>
        <label className="field checkbox-field">
          <input type="checkbox" checked={getFollow()} onChange={(e) => setFollow(e.target.checked)} />
          <span>{t('client.follow')}</span>
        </label>
        <label className="field checkbox-field">
          <input type="checkbox" checked={getSelect()} onChange={(e) => setSelect(e.target.checked)} />
          <span>{t('client.selectRoom')}</span>
        </label>
        <label className="field checkbox-field">
          <input type="checkbox" checked={getLiveEdit()} onChange={(e) => setLiveEdit(e.target.checked)} />
          <span>{t('client.liveEdit')}</span>
        </label>
      </div>
      <p className="hint">{t('client.liveEditHint')}</p>

      <MapPushRow />

      <h4 style={{ marginTop: 14 }}>{t('client.positionTitle')}</h4>
      {position ? (
        <div className="client-position">
          <div>
            <span className="client-room-id">#{position.roomId}</span>{' '}
            {knownRoom ? (knownRoom.name || t('client.unnamed')) : t('client.roomMissing')}
          </div>
          <button type="button" disabled={!knownRoom} onClick={() => navigateToRoom(position.roomId, true)}>
            {t('client.goTo')}
          </button>
        </div>
      ) : (
        <p className="hint">{t('client.noPosition')}</p>
      )}

      <h4 style={{ marginTop: 14 }}>{t('client.appliedTitle')}</h4>
      {applied.length === 0 ? (
        <p className="hint">{t('client.appliedEmpty')}</p>
      ) : (
        <ul className="client-applied">
          {applied.map((entry) => (
            <li key={`${entry.roomId}-${entry.at}`}>
              <button type="button" className="client-room-id" onClick={() => navigateToRoom(entry.roomId, true)}>
                #{entry.roomId}
              </button>
              <span className="client-applied-from">{entry.from || '—'}</span>
              <span className="client-applied-arrow">→</span>
              <span className="client-applied-to">{entry.to}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="hint" style={{ marginTop: 12 }}>{t('client.aliasHint')}</p>
    </>
  );
}

export function ClientTabLabel() {
  const [, rerender] = useState(0);
  useEffect(() => subscribe(() => rerender((n) => n + 1)), []);
  return (
    <>
      Klient
      {isConnected() && <span className="client-tab-dot" />}
    </>
  );
}
