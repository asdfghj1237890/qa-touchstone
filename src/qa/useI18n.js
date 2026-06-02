import React from 'react';
import { I18nContext } from './i18nContext.js';

export function useI18n() {
  return React.useContext(I18nContext);
}
