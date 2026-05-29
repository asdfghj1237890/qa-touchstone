export const PRODUCT_EDITION = import.meta.env.VITE_PRODUCT_EDITION || 'external';

export const PRODUCT_NAME = PRODUCT_EDITION === 'internal'
  ? 'QA Companion Internal'
  : 'QA Companion';

export const EXTERNAL_VISIBLE_PAGES = Object.freeze({
  credentials: false,
  flashNordic: false,
  flashSilabs: false,
  flashEFD: false,
  flashRFD: false,
  tab6: false,
  apiTest: true,
  tab8: false,
});

export const INTERNAL_VISIBLE_PAGE_DEFAULTS = Object.freeze({
  credentials: true,
  flashNordic: true,
  flashSilabs: false,
  flashEFD: true,
  flashRFD: true,
  tab6: true,
  apiTest: true,
  tab8: false,
});

export const GENERIC_API_ENVIRONMENTS = Object.freeze([
  { label: 'None', baseUrl: '', basePath: '', variables: {}, knownBasePaths: [] },
  { label: 'Local', baseUrl: 'http://localhost:3000', basePath: '', variables: {}, knownBasePaths: [] },
  { label: 'Staging', baseUrl: '', basePath: '', variables: {}, knownBasePaths: [] },
  { label: 'Production', baseUrl: '', basePath: '', variables: {}, knownBasePaths: [] },
]);

const EXTERNAL_SETTINGS_TABS = new Set(['setting1', 'apiSettings']);

export function getVisiblePagesForEdition(savedVisiblePages = {}) {
  if (PRODUCT_EDITION === 'internal') {
    return {
      ...INTERNAL_VISIBLE_PAGE_DEFAULTS,
      ...savedVisiblePages,
    };
  }

  return { ...EXTERNAL_VISIBLE_PAGES };
}

export function isExternalSettingsTabVisible(tabKey) {
  return PRODUCT_EDITION === 'internal' || EXTERNAL_SETTINGS_TABS.has(tabKey);
}
