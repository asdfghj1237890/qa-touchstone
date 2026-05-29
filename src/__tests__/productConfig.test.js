import { describe, expect, it } from 'vitest';
import {
  PRODUCT_NAME,
  PRODUCT_EDITION,
  EXTERNAL_VISIBLE_PAGES,
  getVisiblePagesForEdition,
  isExternalSettingsTabVisible,
} from '../productConfig';

describe('productConfig', () => {
  it('uses an external-safe product identity', () => {
    expect(PRODUCT_EDITION).toBe('external');
    expect(PRODUCT_NAME).toBe('QA Touchstone');
    expect(PRODUCT_NAME).not.toMatch(/amazon|qa-touchstone|ring|echo/i);
  });

  it('defaults external navigation to API only', () => {
    expect(EXTERNAL_VISIBLE_PAGES).toEqual({
      credentials: false,
      flashNordic: false,
      flashSilabs: false,
      flashEFD: false,
      flashRFD: false,
      tab6: false,
      apiTest: true,
      tab8: false,
    });
  });

  it('enforces external hidden tabs even if saved config enables them', () => {
    const visible = getVisiblePagesForEdition({
      credentials: true,
      flashNordic: false,
      flashSilabs: false,
      flashEFD: true,
      flashRFD: true,
      tab6: true,
      apiTest: false,
      tab8: true,
    });

    expect(visible).toEqual({
      credentials: false,
      flashNordic: false,
      flashSilabs: false,
      flashEFD: false,
      flashRFD: false,
      tab6: false,
      apiTest: true,
      tab8: false,
    });
  });

  it('hides placeholder settings tabs from the external edition', () => {
    expect(isExternalSettingsTabVisible('setting5')).toBe(false);
    expect(isExternalSettingsTabVisible('setting2')).toBe(false);
    expect(isExternalSettingsTabVisible('setting3')).toBe(false);
    expect(isExternalSettingsTabVisible('apiSettings')).toBe(true);
  });
});
