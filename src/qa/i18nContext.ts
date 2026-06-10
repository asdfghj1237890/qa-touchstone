import React from 'react';

/** i18n context 值：locale、切換器、翻譯函式（vars 做 {placeholder} 插值）。 */
export interface I18nValue {
  locale: string;
  setLocale: (next: string) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export const I18nContext = React.createContext<I18nValue>({
  locale: 'en-US',
  setLocale: () => {},
  t: (key) => key,
});
