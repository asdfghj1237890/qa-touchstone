import React from 'react';
import './setup.js';
import { useI18n } from './useI18n.js';

function SecurityPage() {
  const { t } = useI18n();
  return <div className="qa-sec"><h2>{t('security.title')}</h2><p>{t('security.subtitle')}</p></div>;
}

Object.assign(window, { SecurityPage });
export { SecurityPage };
