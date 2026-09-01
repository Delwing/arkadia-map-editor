import { useEffect, useState } from 'react';
import { subscribe, getNotes, setNotes } from '../github-sync/state';
import { fetchNotes } from '../github-sync/notesApi';
import type { EditorPlugin, SwatchSet } from 'mudlet-map-editor';
import { addTranslations, store } from 'mudlet-map-editor';
import { GitHubPanel } from '../github-sync/GitHubPanel';
import { NotesTab } from '../github-sync/NotesTab';
import { ChangesTab, ChangesTabLabel } from '../github-sync/ChangesTab';
import { RecordingOverlay } from '../github-sync/RecordingOverlay';
import { exchangeCode, setToken } from '../github-sync/auth';
import { setSavedBytes, setMapVersion } from '../github-sync/state';
import { DirBindSection } from './DirBindSection';
import { TeamFollowSection } from './TeamFollowSection';
import { GPSSection } from './GPSSection';
import { BindySection } from './BindySection';
import { ClientTab, ClientTabLabel } from './ClientTab';
import { announce, captureSceneRef, onMapClosed as clientBridgeMapClosed, startClientBridge } from './clientBridge';
import { checkMap } from './mapChecks';
import { en as arkadiaEn } from '../../i18n/locales/en';
import { plArkadia } from '../../i18n/locales/pl';

// Register plugin translations before the app renders
addTranslations('en', 'arkadia', arkadiaEn);
addTranslations('pl', 'arkadia', plArkadia);

// Open on the "Arkadia" tab rather than the built-in selection panel — fetching
// the map and taking the lock is the first thing anyone does here. Set at module
// scope (plugins are imported before <App/> mounts) instead of in onAppReady,
// which runs after the first paint and would flash the selection panel. Picking
// a room still flips the panel to the selection tab as usual.
store.setState({ sidebarTab: 'github' });

const TERENY: SwatchSet = {
  id: 'arkadia-tereny',
  name: 'Arkadia – Tereny',
  swatches: [
    { id: 'ark-las',               name: 'Las',                 symbol: '', environment: 258 },
    { id: 'ark-trakt',             name: 'Trakt',               symbol: '', environment: 257 },
    { id: 'ark-miasto',            name: 'Miasto',              symbol: '', environment: 272 },
    { id: 'ark-wies',              name: 'Wieś',                symbol: '', environment: 262 },
    { id: 'ark-akweny',            name: 'Akweny wodne',        symbol: '', environment: 268 },
    { id: 'ark-plaze',             name: 'Plaże',               symbol: '', environment: 303 },
    { id: 'ark-gory',              name: 'Góry',                symbol: '', environment: 303 },
    { id: 'ark-gory-przepasc',     name: 'Góry z przepaścią',   symbol: '', environment: 301 },
    { id: 'ark-fontanny',          name: 'Fontanny lub woda',   symbol: '', environment: 200 },
    { id: 'ark-dylizanse',         name: 'Dyliżanse',           symbol: '', environment: 267 },
    { id: 'ark-porty',             name: 'Porty',               symbol: '', environment: 267 },
    { id: 'ark-kowale',            name: 'Kowale',              symbol: '', environment: 266 },
    { id: 'ark-karczmy',           name: 'Karczmy, budynki',    symbol: '', environment: 295 },
    { id: 'ark-budynki-wazne',     name: 'Budynki – ważne!',    symbol: '', environment: 267 },
    { id: 'ark-poczty',            name: 'Poczty',              symbol: '', environment: 269 },
    { id: 'ark-bez-swiatla',       name: 'Bez światła',         symbol: '', environment: 261 },
    { id: 'ark-startowka',         name: 'Startówka',           symbol: '', environment: 271 },
    { id: 'ark-bossowie',          name: 'Bossowie, klucze',    symbol: '', environment: 202 },
    { id: 'ark-niebezpieczne',     name: 'Niebezpieczne',       symbol: '', environment: 202 },
  ],
};

const POI: SwatchSet = {
  id: 'arkadia-poi',
  name: 'Arkadia – POI',
  swatches: [
    { id: 'poi-P',  name: 'Poczta',                   symbol: 'P',   environment: 269 },
    { id: 'poi-K',  name: 'Kowal',                    symbol: 'K',   environment: 266 },
    { id: 'poi-S',  name: 'Sklep / handlarz',          symbol: 'S',   environment: 295 },
    { id: 'poi-s',  name: 'Skup',                     symbol: 's',   environment: 295 },
    { id: 'poi-Z',  name: 'Zielarz',                  symbol: 'Z',   environment: 258 },
    { id: 'poi-r',  name: 'Rzemieślnik',               symbol: 'r',   environment: 295 },
    { id: 'poi-E',  name: 'Trener zawodu',             symbol: 'E',   environment: 295 },
    { id: 'poi-T',  name: 'Karczma',                  symbol: 'T',   environment: 295 },
    { id: 'poi-p',  name: 'Piekarnia',                symbol: 'p',   environment: 295 },
    { id: 'poi-a',  name: 'Sprzedawca zwierząt',      symbol: 'a',   environment: 295 },
    { id: 'poi-tb', name: 'Tablica ogłoszeń',          symbol: '[]',  environment: 295 },
    { id: 'poi-m',  name: 'Rzeźnik',                  symbol: 'm',   environment: 295 },
    { id: 'poi-B',  name: 'Biblioteka',               symbol: 'B',   environment: 295 },
    { id: 'poi-G',  name: 'Gildia podróżnicza',        symbol: 'G',   environment: 295 },
    { id: 'poi-A',  name: 'Aukcje / sklep gildiowy',  symbol: 'A',   environment: 295 },
    { id: 'poi-W',  name: 'Wozownia',                 symbol: 'W',   environment: 295 },
    { id: 'poi-u',  name: 'Urna',                     symbol: 'u',   environment: 295 },
    { id: 'poi-J',  name: 'Jubiler / złotnik',         symbol: 'J',   environment: 295 },
    { id: 'poi-$',  name: 'Bank / kantor',            symbol: '$',   environment: 295 },
    { id: 'poi-C',  name: 'Kasyno',                   symbol: 'C',   environment: 295 },
    { id: 'poi-k',  name: 'Krawiec',                  symbol: 'k',   environment: 295 },
    { id: 'poi-F',  name: 'Fryzjer',                  symbol: 'F',   environment: 295 },
    { id: 'poi-+',  name: 'Świątynia / kapliczka',    symbol: '+',   environment: 295 },
  ],
};

function NotesTabLabel() {
  const [, rerender] = useState(0);
  useEffect(() => subscribe(() => rerender((n) => n + 1)), []);
  const count = getNotes().length;
  return (
    <>
      Notatki
      {count > 0 && <span className="tab-badge">{count}</span>}
    </>
  );
}

function OAuthCallback() {
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    // Running inside the OAuth popup — hand the code (or error) back and close.
    const error = params.get('error');
    if (window.opener && (code || error)) {
      window.opener.postMessage({ type: 'github-oauth', code, error }, window.location.origin);
      window.close();
      return;
    }

    // Running in the main window — listen for the code from the popup.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'github-oauth') return;
      if (e.data.error) { setMsg(`Login failed: ${e.data.error}`); return; }
      setMsg('Completing GitHub login…');
      exchangeCode(e.data.code)
        .then((token) => { setToken(token); setMsg(''); })
        .catch((err: Error) => setMsg(`Login failed: ${err.message}`));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!msg) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    }} onClick={() => setMsg('')}>
      <div style={{ background: '#1e1e2e', padding: 24, borderRadius: 8, color: '#cdd6f4' }}>
        {msg}
      </div>
    </div>
  );
}

const plugin: EditorPlugin = {
  id: 'arkadia',

  async onAppReady() {
    fetchNotes().then(setNotes);
    startClientBridge();
  },

  onMapOpened(map) {
    setMapVersion(map.mUserData?.['version'] ?? null);
    // Let a connected client know which map it is now talking to.
    announce();
  },

  onMapClosed() {
    setMapVersion(null);
    clientBridgeMapClosed();
  },

  onMapSave(bytes) {
    setSavedBytes(bytes);
  },

  swatchSets() {
    return [TERENY, POI];
  },

  sidebarTabs() {
    return [
      { id: 'github', label: 'Arkadia', render: () => <GitHubPanel /> },
      { id: 'notes', label: <NotesTabLabel />, render: (sceneRef) => <NotesTab sceneRef={sceneRef} /> },
      { id: 'changes', label: <ChangesTabLabel />, render: () => <ChangesTab /> },
      { id: 'client', label: <ClientTabLabel />, render: (sceneRef) => <ClientTab sceneRef={sceneRef} /> },
    ];
  },

  renderOverlay() {
    return (
      <>
        <OAuthCallback />
        <RecordingOverlay />
      </>
    );
  },

  roomPanelSections() {
    return [
      // Selecting any room latches the scene ref for the client bridge, so a
      // captured name updates the renderer without a full structural rebuild.
      { id: 'arkadia-scene-ref', render: (props) => { captureSceneRef(props.sceneRef); return null; } },
      { id: 'arkadia-dir-bind', render: (props) => <DirBindSection key={props.roomId} {...props} /> },
      { id: 'arkadia-team-follow', render: (props) => <TeamFollowSection key={props.roomId} {...props} /> },
      { id: 'arkadia-gps', render: (props) => <GPSSection key={props.roomId} {...props} /> },
      { id: 'arkadia-bindy', render: (props) => <BindySection key={props.roomId} {...props} /> },
    ];
  },

  mapChecks(map) {
    return checkMap(map);
  },
};

export default plugin;
