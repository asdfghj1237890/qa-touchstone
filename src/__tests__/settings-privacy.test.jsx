import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../qa/i18n.jsx';
import { PrivacySettings } from '../qa/SettingsPage.jsx';
import { loadPrivacyCfg } from '../qa/aiPrivacy.js';

beforeEach(() => localStorage.clear());

describe('PrivacySettings', () => {
  it('changing mode persists to qa_ai_privacy', () => {
    render(<I18nProvider><PrivacySettings /></I18nProvider>);
    fireEvent.click(screen.getByTestId('privacy-mode-local'));
    expect(loadPrivacyCfg().mode).toBe('local');
  });
});
