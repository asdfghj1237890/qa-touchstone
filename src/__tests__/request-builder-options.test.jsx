import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { OptionsEditor } from '../qa/RequestBuilder';
import { I18nProvider } from '../qa/i18n';

function installLocalStorage(seed = {}) {
  let store = { ...seed };
  const storage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

describe('RequestBuilder options', () => {
  afterEach(() => cleanup());

  it('does not crash when env.baseUrl is an unresolved template', () => {
    installLocalStorage({ qa_locale: 'en-US' });
    render(
      <I18nProvider>
        <OptionsEditor
          req={{ id: 'r1' }}
          env={{ label: 'Templated', baseUrl: '{{apiHost}}' }}
          sslVerify={true}
          setSslVerify={vi.fn()}
          localVars={[]}
          setLocalVars={vi.fn()}
          varMap={{}}
          cookies={[]}
          collectionId="c1"
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>
    );

    expect(screen.getByText(/Cookies for configured host/)).toBeInTheDocument();
  });
});
