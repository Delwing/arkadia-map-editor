import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from 'mudlet-map-editor';
import 'mudlet-map-editor/styles.css';
import type { EditorPlugin } from 'mudlet-map-editor';

const pluginModules = import.meta.glob('./plugins/*/index.{ts,tsx}', { eager: true });
const plugins = Object.values(pluginModules)
  .map((m) => (m as { default?: EditorPlugin }).default)
  .filter((p): p is EditorPlugin => p != null);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App plugins={plugins} title="Arkadia Map Editor" />
  </React.StrictMode>,
);
