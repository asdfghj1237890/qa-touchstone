import { describe, it, expect, afterEach } from 'vitest';
import { isCoreAvailable } from '../coreAvailable';

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  delete (window as unknown as Record<string, unknown>).__TAURI__;
});

describe('isCoreAvailable', () => {
  it('is false with no Tauri globals (browser/dev)', () => {
    expect(isCoreAvailable()).toBe(false);
  });
  it('is true when __TAURI_INTERNALS__ is present', () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isCoreAvailable()).toBe(true);
  });
  it('is true when __TAURI__ is present', () => {
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
    expect(isCoreAvailable()).toBe(true);
  });
});
