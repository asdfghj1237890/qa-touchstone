import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PromptPreviewHost, requestPromptApproval, __resetPreviewState } from '../qa/PromptPreview';
import { I18nProvider } from '../qa/i18n';

const meta = { site: 'testgen', mode: 'redacted', destination: { provider: 'openai', label: 'OpenAI', isCloud: true } };
const wrap = () => render(<I18nProvider><PromptPreviewHost /></I18nProvider>);

describe('PromptPreviewHost', () => {
  beforeEach(() => __resetPreviewState());
  it('shows the prompt and resolves true on Send', async () => {
    wrap();
    let p; act(() => { p = requestPromptApproval('THE-PROMPT-TEXT', meta); });
    expect(await screen.findByText(/THE-PROMPT-TEXT/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('preview-send'));
    await expect(p).resolves.toBe(true);
  });
  it('resolves false on Cancel', async () => {
    wrap();
    let p; act(() => { p = requestPromptApproval('X', meta); });
    await screen.findByTestId('preview-cancel');
    fireEvent.click(screen.getByTestId('preview-cancel'));
    await expect(p).resolves.toBe(false);
  });
});
