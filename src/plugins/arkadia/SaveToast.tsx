import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorState } from 'mudlet-map-editor';
import { dismissSaveToast, getSaveToast, goToArkadiaTab, subscribeSaveFlow, type SaveToastKind } from './saveFlow';
import './arkadia.css';

/** Margin the editor's floating chrome keeps from the viewport edges. */
const GAP = 12;

/** Accent and call-to-action per prompt kind. `action` labels the button that
 *  jumps to the Arkadia tab, where every step the prompt can ask for lives. */
const VARIANTS = {
  readyToUpload: { tone: '', action: 'save.goToUpload' },
  needLogin: { tone: 'warn', action: 'save.goToLogin' },
  needLock: { tone: 'warn', action: 'save.goToLock' },
} as const satisfies Record<SaveToastKind, { tone: '' | 'warn'; action: string }>;

/**
 * Prompt shown after the toolbar's save button runs. Rendered over the canvas
 * by the Arkadia plugin's `renderOverlay`.
 *
 * Nothing happens here beyond pointing at the Arkadia tab — the tab remains the
 * one place the map-submission flow is driven from, whether you got there through
 * this prompt or on your own.
 */
export function SaveToast() {
  const { t } = useTranslation('arkadia');
  const [, rerender] = useState(0);
  useEffect(() => subscribeSaveFlow(() => rerender((n) => n + 1)), []);

  // Sit just left of the side panel, aligned with its top edge. The panel's
  // width comes from three different places (collapsed rail, resizable width,
  // modal-expanded), so measure what is actually rendered instead of
  // reproducing that logic — the store reads below are what re-run it.
  const panelWidth = useEditorState((s) => s.panelWidth);
  const panelCollapsed = useEditorState((s) => s.panelCollapsed);
  const panelExpanded = useEditorState((s) => s.panelExpanded);
  const [right, setRight] = useState(GAP);
  const toast = getSaveToast();

  useLayoutEffect(() => {
    const measure = () => {
      const left = document.querySelector('.side-panel')?.getBoundingClientRect().left;
      setRight(left == null ? GAP : Math.max(GAP, window.innerWidth - left + GAP));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [panelWidth, panelCollapsed, panelExpanded, toast]);

  if (!toast) return null;
  const { tone, action } = VARIANTS[toast];

  return (
    <div className={`ark-save-toast${tone ? ` ark-save-toast--${tone}` : ''}`} style={{ right }}>
      <span className="ark-save-toast-text">{t(`save.${toast}`)}</span>
      <button type="button" className="context-menu-btn primary" onClick={goToArkadiaTab}>
        {t(action)}
      </button>
      <button type="button" className="context-menu-btn" onClick={dismissSaveToast}>
        {t('save.dismiss')}
      </button>
    </div>
  );
}
