// src/__tests__/suite-run-bar.test.jsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '../qa/i18n.jsx';
import { SuiteRunBar } from '../qa/SuiteRunBar.jsx';

afterEach(() => cleanup());
const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>);

describe('SuiteRunBar', () => {
  it('shows the run button when idle and calls onRun', () => {
    const onRun = vi.fn();
    wrap(<SuiteRunBar suite={{ running: false }} onRun={onRun} onStop={() => {}} />);
    fireEvent.click(screen.getByText('Run full security suite'));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
  it('shows progress + a Stop button while running', () => {
    const onStop = vi.fn();
    wrap(<SuiteRunBar suite={{ running: true, engine: 'bola', done: 3, total: 8 }} onRun={() => {}} onStop={onStop} />);
    expect(screen.getByText(/Running BOLA/)).toBeTruthy();
    fireEvent.click(screen.getByText('Stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
