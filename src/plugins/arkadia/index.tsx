import { useEffect, useState } from 'react';
import { getI18n } from 'react-i18next';
import { subscribe, getNotes, setNotes } from '../github-sync/state';
import { fetchNotes } from '../github-sync/notesApi';
import { startLockSync } from '../github-sync/lockSync';
import type { EditorPlugin, LabelPreset, SwatchSet } from 'mudlet-map-editor';
import { addTranslations, store } from 'mudlet-map-editor';
import { GitHubPanel } from '../github-sync/GitHubPanel';
import { NotesTab } from '../github-sync/NotesTab';
import { ChangesTab, ChangesTabLabel } from '../github-sync/ChangesTab';
import { RecordingOverlay } from '../github-sync/RecordingOverlay';
import { exchangeCode, setToken } from '../github-sync/auth';
import { setMapVersion } from '../github-sync/state';
import { DirBindSection } from './DirBindSection';
import { TeamFollowSection } from './TeamFollowSection';
import { GPSSection } from './GPSSection';
import { BindySection } from './BindySection';
import { ClientTab, ClientTabLabel } from './ClientTab';
import { SaveToast } from './SaveToast';
import { toolbarSave } from './saveFlow';
import { announce, captureSceneRef, onMapClosed as clientBridgeMapClosed, startClientBridge } from './clientBridge';
import { checkMap } from './mapChecks';
import { TABLICZKA_STYLE } from './tabliczka';
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

/**
 * Label presets — the house style for map labels, applied in one click from the
 * label panel and used as the starting point for every new label.
 *
 * The box is 3 units tall and as wide as the text needs: 'width' fitting keeps
 * a row of village names on one baseline height whatever their length. The
 * padding matches the vertical slack a 80px line leaves in a 192px box, so the
 * frame sits evenly around the word.
 */
const WIOSKA: LabelPreset = {
  id: 'ark-wioska',
  name: 'Wioska',
  fgColor: '#fed971',
  // Fully transparent — the map shows through, only the text and frame read.
  bgColor: '#00000000',
  outlineColor: null,
  border: { width: 4, color: '#fed97180' },
  font: { family: 'Segoe UI', size: 65, bold: true, italic: false, underline: false, strikeout: false },
  styleId: 'capsBigInitials',
  // Stated rather than left to the default, so applying this over a label that
  // came from Statki pulls its alignment back.
  textAlign: 'center',
  // [horizontal, vertical] — caps in a frame read tight at the sides, so the
  // side margin is twice the one above and below.
  padding: [70, 35],
  // Both axes follow the text, so the padding is the margin on all four sides
  // and a two-line name gets a box tall enough for it. A fixed height only ever
  // suited one line, and had to be recomputed whenever the font or padding
  // moved; single-line names still come out the same height as each other.
  fitToText: true,
};

/** The village house style a size up, for towns that should read bigger. */
const MIASTA: LabelPreset = {
  ...WIOSKA,
  id: 'ark-miasta',
  name: 'Miasta',
  font: { ...WIOSKA.font, size: 80 },
  padding: [80, 40],
};

/** Hamlets: the village caps and margins, smaller, in teal and without a frame, so they
 *  read a step below a village rather than as one. Taken from the Łany label. */
const WIOCHY: LabelPreset = {
  ...WIOSKA,
  id: 'ark-wiochy',
  name: 'Wiochy',
  fgColor: '#008080',
  border: null,
  font: { ...WIOSKA.font, size: 55 },
};

const STATKI: LabelPreset = {
  id: 'ark-statki',
  name: 'Statki',
  fgColor: '#ffff00',
  bgColor: '#00000000',
  outlineColor: null,
  border: null,
  font: { family: 'Segoe UI', size: 60, bold: false, italic: false, underline: false, strikeout: false },
  styleId: 'plain',
  textAlign: 'left',
  padding: 10,
  fitToText: true,
};

/**
 * Area crossing — where an exit out of this area leads. Wayfinding rather than
 * a place, so it sits on top of the rooms it labels: an edge marker tucked
 * under a room is no use.
 *
 * A plate nailed to the edge: legible over any terrain, and yellow rather than
 * the desaturated gold the place names use, so it belongs to the map's palette
 * without being mistaken for one of them. The plate is a warm near-black so the
 * yellow stays warm; the frame is the text colour at 40%, as on a village.
 *
 * Drawn by its own style (see tabliczka.ts), whose shape setting in the label
 * panel gives the plate arrow ends; the preset starts square.
 */
const TABLICZKA: LabelPreset = {
  id: 'ark-przejscie-tabliczka',
  name: 'Tabliczka',
  fgColor: '#ffe45c',
  bgColor: '#1c1708d9',
  outlineColor: null,
  border: { width: 2, color: '#ffe45c66' },
  font: { family: 'Segoe UI', size: 60, bold: true, italic: false, underline: false, strikeout: false },
  styleId: TABLICZKA_STYLE.id,
  textAlign: 'center',
  padding: [24, 12],
  fitToText: true,
  showOnTop: true,
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
    // Read back who we are and whether the lock is ours. The lock lives on the
    // server, so a reload has to ask for it rather than assume it was lost.
    startLockSync();
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

  // The main save button drives the map-submission flow: it names the next step
  // (log in, take the lock, upload) rather than writing a file. Saving to a
  // file, in any registered format, stays on the split button's caret menu,
  // which the toolbar drives separately from this onClick.
  toolbarActions(actions) {
    return actions.map((action) =>
      action.id === 'save'
        ? { ...action, title: getI18n().t('arkadia:save.buttonTitle'), onClick: toolbarSave }
        : action,
    );
  },

  swatchSets() {
    return [TERENY, POI];
  },

  labelStyles() {
    return [TABLICZKA_STYLE];
  },

  labelPresets() {
    return [MIASTA, WIOSKA, WIOCHY, STATKI, TABLICZKA];
  },

  // The map's labels are drawn here, with styles, borders, padding and text
  // alignment Mudlet knows nothing about, so the pixmap has to be what Mudlet
  // shows rather than its own re-render of the label text. 2x because that
  // pixmap is then the only copy there is — and a constant, so what lands in a
  // map shared through GitHub doesn't depend on the display scaling of whoever
  // edited it.
  labelPolicy() {
    return { preservePixmaps: true, supersample: 2 };
  },

  sidebarTabs() {
    return [
      { id: 'github', label: 'Arkadia', render: () => <GitHubPanel /> },
      // Selection-aware: jumping to a note's room selects it, and the panel's
      // "use selected room" field reads the selection, so the tab has to survive
      // a selection change (it used to pin `sidebarTab` on every jump instead).
      {
        id: 'notes',
        label: <NotesTabLabel />,
        render: (sceneRef) => <NotesTab sceneRef={sceneRef} />,
        selectionAware: true,
        multiSelectionAware: true,
      },
      // Selection-aware: the tab shows the history *of* the selection, so
      // clicking around the map must not bounce the user to the Selection tab.
      {
        id: 'changes',
        label: <ChangesTabLabel />,
        render: () => <ChangesTab />,
        selectionAware: true,
        multiSelectionAware: true,
      },
      { id: 'client', label: <ClientTabLabel />, render: (sceneRef) => <ClientTab sceneRef={sceneRef} /> },
    ];
  },

  renderOverlay() {
    return (
      <>
        <OAuthCallback />
        <RecordingOverlay />
        <SaveToast />
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
