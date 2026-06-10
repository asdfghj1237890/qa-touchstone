import React from 'react';
import { I18nContext, type I18nValue } from './i18nContext';

export function useI18n(): I18nValue {
  return React.useContext(I18nContext);
}
