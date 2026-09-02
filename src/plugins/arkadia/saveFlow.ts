import { store } from 'mudlet-map-editor';
import { getHasLock, getToken } from '../github-sync/state';

/** How long the post-save prompt stays up before it disappears on its own. */
const TOAST_MS = 60_000;

/**
 * Which step the prompt points at after a save — logging in, taking the lock,
 * or uploading. Nothing else stands between an edit and the shared map.
 */
export type SaveToastKind = 'needLogin' | 'needLock' | 'readyToUpload';

let toast: SaveToastKind | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribeSaveFlow(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getSaveToast(): SaveToastKind | null {
  return toast;
}

export function dismissSaveToast(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (toast === null) return;
  toast = null;
  notify();
}

function raise(kind: SaveToastKind): void {
  toast = kind;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; toast = null; notify(); }, TOAST_MS);
  notify();
}

/**
 * What the toolbar's save button does: name the next step towards getting the
 * edits into the map, and offer a jump to the Arkadia tab where that step
 * lives.
 *
 * It writes nothing itself. The map is serialized by the upload, and saving to
 * a file lives on the split button's caret menu, so there is nothing left for
 * this button to persist — which is also why it never clears the dirty marker.
 * That happens when the upload succeeds and the edits have actually left the
 * browser.
 *
 * The state is read here, at click time, and never in `toolbarActions`: the
 * toolbar re-renders off editor state and knows nothing about the lock, so a
 * decision baked into the action list would still say "no lock" after one had
 * been taken.
 */
export function toolbarSave(): void {
  if (!getToken()) raise('needLogin');
  else if (!getHasLock()) raise('needLock');
  else raise('readyToUpload');
}

/** Dismiss the prompt and switch the sidebar to the Arkadia tab. */
export function goToArkadiaTab(): void {
  dismissSaveToast();
  store.setState({ sidebarTab: 'github' });
}
