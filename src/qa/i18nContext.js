import React from 'react';

export const I18nContext = React.createContext({
  locale: 'en-US',
  setLocale: () => {},
  t: (key) => key,
});
