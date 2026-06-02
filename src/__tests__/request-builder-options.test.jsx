import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { OptionsEditor } from '../qa/RequestBuilder.jsx';

describe('RequestBuilder options', () => {
  afterEach(() => cleanup());

  it('does not crash when env.baseUrl is an unresolved template', () => {
    render(
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
    );

    expect(screen.getByText(/Cookies for configured host/)).toBeInTheDocument();
  });
});
