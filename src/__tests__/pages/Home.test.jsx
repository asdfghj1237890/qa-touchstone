import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Home from '../../pages/Home.jsx';

vi.mock('../../../package.json', () => ({
  default: {
    version: '0.13.1'
  }
}));

describe('Home Page', () => {
  beforeEach(() => {
    window.electronAPI = {
      openSettings: vi.fn()
    };
  });

  afterEach(() => {
    cleanup();
    delete window.electronAPI;
  });

  it('renders external-safe product copy', () => {
    render(<Home />);

    expect(screen.getByText(/QA Companion/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Postman-compatible API client/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Sidewalk/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ring/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Echo/i)).not.toBeInTheDocument();
  });

  it('shows the first-pass external API feature set', () => {
    render(<Home />);

    expect(screen.getByRole('button', { name: /^API Client$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^API Settings$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Nordic Flash$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Silabs Flash$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/5 auth methods/i)).toBeInTheDocument();
    expect(screen.getByText(/Postman collections/i)).toBeInTheDocument();
    expect(screen.getByText(/Local execution/i)).toBeInTheDocument();
  });

  it('dispatches tab changes for primary tools', () => {
    const onTabChange = vi.fn();
    window.addEventListener('requestTabChange', onTabChange);

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /^API Client$/i }));

    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange.mock.calls[0][0].detail.newValue).toBe(1);

    window.removeEventListener('requestTabChange', onTabChange);
  });

  it('opens settings for API Settings', () => {
    render(<Home />);

    fireEvent.click(screen.getByRole('button', { name: /^API Settings$/i }));

    expect(window.electronAPI.openSettings).toHaveBeenCalledTimes(1);
  });
});
