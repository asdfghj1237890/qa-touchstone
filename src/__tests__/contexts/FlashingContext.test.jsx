import React from 'react';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FlashingProvider, useFlashing } from '../../contexts/FlashingContext.jsx';

describe('FlashingContext', () => {
  it('provides default flashing state', () => {
    const { result } = renderHook(() => useFlashing(), {
      wrapper: FlashingProvider
    });
    
    expect(result.current.isFlashing).toBe(false);
    expect(typeof result.current.setIsFlashing).toBe('function');
  });

  it('updates flashing state', () => {
    const { result } = renderHook(() => useFlashing(), {
      wrapper: FlashingProvider
    });
    
    act(() => {
      result.current.setIsFlashing(true);
    });
    
    expect(result.current.isFlashing).toBe(true);
    
    act(() => {
      result.current.setIsFlashing(false);
    });
    
    expect(result.current.isFlashing).toBe(false);
  });

  it('shares state between multiple consumers', () => {
    const TestComponent1 = () => {
      const { isFlashing, setIsFlashing } = useFlashing();
      return (
        <div>
          <span data-testid="status1">{isFlashing ? 'Flashing' : 'Not Flashing'}</span>
          <button onClick={() => setIsFlashing(true)}>Start Flash</button>
        </div>
      );
    };
    
    const TestComponent2 = () => {
      const { isFlashing } = useFlashing();
      return <span data-testid="status2">{isFlashing ? 'Flashing' : 'Not Flashing'}</span>;
    };
    
    render(
      <FlashingProvider>
        <TestComponent1 />
        <TestComponent2 />
      </FlashingProvider>
    );
    
    expect(screen.getByTestId('status1')).toHaveTextContent('Not Flashing');
    expect(screen.getByTestId('status2')).toHaveTextContent('Not Flashing');
    
    fireEvent.click(screen.getByText('Start Flash'));
    
    expect(screen.getByTestId('status1')).toHaveTextContent('Flashing');
    expect(screen.getByTestId('status2')).toHaveTextContent('Flashing');
  });

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test
    const originalError = console.error;
    console.error = vi.fn();
    
    expect(() => {
      renderHook(() => useFlashing());
    }).toThrow('useFlashing must be used within a FlashingProvider');
    
    console.error = originalError;
  });

  it('maintains state during re-renders', () => {
    const TestComponent = () => {
      const { isFlashing, setIsFlashing } = useFlashing();
      const [count, setCount] = React.useState(0);
      
      return (
        <div>
          <span data-testid="status">{isFlashing ? 'Flashing' : 'Not Flashing'}</span>
          <span data-testid="count">{count}</span>
          <button onClick={() => setIsFlashing(!isFlashing)}>Toggle Flash</button>
          <button onClick={() => setCount(count + 1)}>Increment</button>
        </div>
      );
    };
    
    render(
      <FlashingProvider>
        <TestComponent />
      </FlashingProvider>
    );
    
    // Toggle flashing state
    fireEvent.click(screen.getByText('Toggle Flash'));
    expect(screen.getByTestId('status')).toHaveTextContent('Flashing');
    
    // Trigger re-render with count update
    fireEvent.click(screen.getByText('Increment'));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    
    // Flashing state should be maintained
    expect(screen.getByTestId('status')).toHaveTextContent('Flashing');
  });

  it('prevents navigation when flashing is active', () => {
    const TestComponent = () => {
      const { isFlashing, setIsFlashing } = useFlashing();
      const [currentTab, setCurrentTab] = React.useState(0);
      
      const handleTabChange = (newTab) => {
        if (!isFlashing) {
          setCurrentTab(newTab);
        }
      };
      
      return (
        <div>
          <span data-testid="current-tab">{currentTab}</span>
          <button data-testid="start-flash-nav" onClick={() => setIsFlashing(true)}>Start Flash Navigation Test</button>
          <button data-testid="stop-flash-nav" onClick={() => setIsFlashing(false)}>Stop Flash Navigation Test</button>
          <button data-testid="go-to-tab-1" onClick={() => handleTabChange(1)}>Go to Tab 1</button>
        </div>
      );
    };
    
    render(
      <FlashingProvider>
        <TestComponent />
      </FlashingProvider>
    );
    
    // Initially can change tabs
    fireEvent.click(screen.getByTestId('go-to-tab-1'));
    expect(screen.getByTestId('current-tab')).toHaveTextContent('1');
    
    // Start flashing
    fireEvent.click(screen.getByTestId('start-flash-nav'));
    
    // Try to change tabs - should be prevented
    fireEvent.click(screen.getByTestId('go-to-tab-1'));
    expect(screen.getByTestId('current-tab')).toHaveTextContent('1'); // No change
    
    // Stop flashing
    fireEvent.click(screen.getByTestId('stop-flash-nav'));
    
    // Now can change tabs again
    fireEvent.click(screen.getByTestId('go-to-tab-1'));
    expect(screen.getByTestId('current-tab')).toHaveTextContent('1');
  });
}); 