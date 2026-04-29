import { useTranslation } from 'react-i18next';
import type { RoomSectionProps } from 'mudlet-map-editor';
import { pushCommand, store, useEditorState } from 'mudlet-map-editor';
import arkadiaLogo from './arkadia-logo.svg';
import './arkadia.css';

const DRINKABLE_KEY = 'drinkable';
const BIND_KEY = 'bind';
const BIND_PRINTABLE_KEY = 'bind_printable';

export function BindySection({ roomId, room, sceneRef }: RoomSectionProps) {
    const { t } = useTranslation('arkadia');
    const dataVersion = useEditorState((s) => s.dataVersion);

    const drinkable = room.userData?.[DRINKABLE_KEY] === 'true';
    const bindValue = room.userData?.[BIND_KEY] ?? '';

    function commitDrinkable(checked: boolean) {
        const from = room.userData?.[DRINKABLE_KEY] ?? null;
        const to = checked ? 'true' : null;
        if (from === to) return;
        pushCommand({ kind: 'setUserDataEntry', roomId, key: DRINKABLE_KEY, from, to }, sceneRef.current);
        sceneRef.current?.refresh();
        store.bumpData();
    }

    function commitBind(value: string) {
        const newBind = value.trim() || null;
        const fromBind = room.userData?.[BIND_KEY] ?? null;
        const fromPrintable = room.userData?.[BIND_PRINTABLE_KEY] ?? null;
        const toPrintable = newBind ? newBind.split('#').join(';') : null;
        if (fromBind === newBind && fromPrintable === toPrintable) return;
        pushCommand({ kind: 'setUserDataEntry', roomId, key: BIND_KEY, from: fromBind, to: newBind }, sceneRef.current);
        pushCommand({ kind: 'setUserDataEntry', roomId, key: BIND_PRINTABLE_KEY, from: fromPrintable, to: toPrintable }, sceneRef.current);
        sceneRef.current?.refresh();
        store.bumpData();
    }

    return (
        <>
            <h4>
                {t('bindy.title')}
                <img src={arkadiaLogo} alt="Arkadia" style={{ height: '2.5em', verticalAlign: 'middle', marginLeft: 6, marginTop: '-0.75em', marginBottom: '-0.75em' }} />
            </h4>
            <div className="gps-list">
                <label className="field checkbox-field">
                    <input
                        key={`drinkable-${roomId}-${dataVersion}`}
                        type="checkbox"
                        defaultChecked={drinkable}
                        onChange={(e) => commitDrinkable(e.target.checked)}
                    />
                    <span>{t('bindy.drinkable')}</span>
                </label>
                <div className="gps-field">
                    <label className="gps-field-label">{t('bindy.locationBind')}</label>
                    <input
                        key={`bind-${roomId}-${bindValue}`}
                        className="ark-input"
                        defaultValue={bindValue}
                        placeholder={t('bindy.locationBindPlaceholder')}
                        onBlur={(e) => commitBind(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                </div>
            </div>
        </>
    );
}
