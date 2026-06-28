import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '../qa/i18n';
import { PrivacySettings } from '../qa/SettingsPage';
import { loadPrivacyCfg } from '../qa/aiPrivacy';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('PrivacySettings', () => {
  it('changing mode persists to qa_ai_privacy', () => {
    render(
      <I18nProvider>
        <PrivacySettings />
      </I18nProvider>
    );
    fireEvent.click(screen.getByTestId('privacy-mode-local'));
    expect(loadPrivacyCfg().mode).toBe('local');
  });

  it('lockdown toggle persists to qa_ai_privacy', () => {
    render(
      <I18nProvider>
        <PrivacySettings />
      </I18nProvider>
    );
    fireEvent.click(screen.getByLabelText('toggle row'));
    expect(loadPrivacyCfg().lockdown).toBe(true);
  });
});
