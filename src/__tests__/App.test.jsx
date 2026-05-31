import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../App.jsx';

// The redesigned QA Companion is a single-window app with a left nav rail and
// nine routes. Outside Tauri the request executor falls back to canned
// responses, so the send → response flow is exercisable in jsdom.

const RAIL_LABELS = [
  'Home', 'Test Gen', 'API Client', 'Realtime', 'Runner',
  'Monitors', 'API Docs', 'Performance', 'Settings',
];

describe('App (redesign shell)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the title bar and lands on Home', () => {
    render(<App />);
    expect(document.querySelector('.qa-titlebar-name').textContent).toBe('QA Companion');
    expect(document.querySelector('.qa-titlebar-route').textContent).toBe('Home');
    // Home dashboard tiles (unique copy)
    expect(screen.getByText('Test Generation')).toBeInTheDocument();
    expect(screen.getByText('Credentials & Env')).toBeInTheDocument();
  });

  it('renders macOS-style traffic-light controls on non-Windows platforms', () => {
    const prev = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
    Object.defineProperty(navigator, 'userAgentData', { value: { platform: 'macOS' }, configurable: true });
    try {
      render(<App />);
      expect(screen.getByRole('button', { name: 'Close window' })
        .classList.contains('qa-winctl-close')).toBe(true);
      expect(document.querySelector('.qa-winctl-win')).toBeNull();
    } finally {
      if (prev) Object.defineProperty(navigator, 'userAgentData', prev);
      else delete navigator.userAgentData;
    }
  });

  it('renders Windows-style controls in minimize/maximize/close order on Windows', () => {
    const prev = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
    Object.defineProperty(navigator, 'userAgentData', { value: { platform: 'Windows' }, configurable: true });
    try {
      render(<App />);
      expect(document.querySelector('.qa-winctl-win')).not.toBeNull();
      const order = [...document.querySelectorAll('.qa-winctl-win button')]
        .map((b) => b.getAttribute('aria-label'));
      expect(order).toEqual(['Minimize window', 'Maximize window', 'Close window']);
      expect(screen.getByRole('button', { name: 'Close window' })
        .classList.contains('qa-winctl-wclose')).toBe(true);
    } finally {
      if (prev) Object.defineProperty(navigator, 'userAgentData', prev);
      else delete navigator.userAgentData;
    }
  });

  it('exposes all nine nav-rail destinations', () => {
    render(<App />);
    RAIL_LABELS.forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('opens the API Client with collections and a Send action', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'API Client' }));
    // The bundled public-apis demo collection auto-loads at boot, so the
    // sidebar shows it and its first request without any user import step.
    expect(screen.getByText('Public APIs — Callable Demo')).toBeInTheDocument();
    expect(screen.getByText('Random cat fact')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send/ })).toBeInTheDocument();
  });

  it('sends a request and renders the response (canned fallback)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'API Client' }));
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(
      () => expect(screen.getByText(/200/)).toBeInTheDocument(),
      { timeout: 4000 }
    );
  });

  it('switches to Settings and shows its tabs', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('AI / LLM')).toBeInTheDocument();
  });

  it('renders the remaining feature routes without crashing', () => {
    render(<App />);
    ['Test Gen', 'Realtime', 'Runner', 'Monitors', 'API Docs', 'Performance'].forEach((label) => {
      fireEvent.click(screen.getByRole('button', { name: label }));
      const content = document.querySelector('.qa-content');
      expect(content).toBeTruthy();
      expect(content.textContent.length).toBeGreaterThan(0);
    });
  });
});
