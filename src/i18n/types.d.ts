import type { ArkadiaLocale } from './locales/en';
import type { EditorLocale } from 'mudlet-map-editor';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'editor';
    resources: {
      editor: EditorLocale;
      arkadia: ArkadiaLocale;
    };
    returnNull: false;
    returnObjects: false;
  }
}
