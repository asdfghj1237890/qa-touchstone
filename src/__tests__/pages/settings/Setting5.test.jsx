import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import Setting5 from '../../../pages/settings/Setting5.jsx';

describe('Setting5', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders settings page title', () => {
    const { container } = render(<Setting5 />);
    
    // Use container to scope the query
    const headings = container.querySelectorAll('h6');
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]).toHaveTextContent('Setting 5');
  });

  it('displays placeholder content', () => {
    const { container } = render(<Setting5 />);
    
    // Look for the specific text content within this container
    const textElement = Array.from(container.querySelectorAll('p')).find(p => 
      p.textContent.includes('This is Setting 5 content')
    );
    expect(textElement).toBeInTheDocument();
  });

  it('shows proper layout structure', () => {
    const { container } = render(<Setting5 />);
    
    // Should have a container element
    expect(container.firstChild).toBeInTheDocument();
    
    // Should contain heading within this specific container
    const heading = container.querySelector('h6');
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent('Setting 5');
  });

  it('maintains consistent styling with other settings pages', () => {
    const { container } = render(<Setting5 />);
    
    // Should have Typography component for title
    const title = container.querySelector('h6');
    expect(title).toBeInTheDocument();
    expect(title.tagName).toMatch(/^H\d$/); // Should be a heading element
  });

  it('renders without errors', () => {
    expect(() => render(<Setting5 />)).not.toThrow();
  });

  it('displays as a placeholder for future settings', () => {
    const { container } = render(<Setting5 />);
    
    // Should indicate it's a placeholder or have minimal content
    const content = Array.from(container.querySelectorAll('p')).find(p => 
      p.textContent.includes('Setting 5 content')
    );
    expect(content).toBeInTheDocument();
  });

  it('follows settings page conventions', () => {
    const { container } = render(<Setting5 />);
    
    // Should have Material UI Box structure
    expect(container.querySelector('div')).toBeInTheDocument();
  });

  it('includes Material UI components', () => {
    const { container } = render(<Setting5 />);
    
    // Should use Typography for heading
    const heading = container.querySelector('h6');
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent('Setting 5');
    
    // Should have descriptive text about future configuration
    const futureText = Array.from(container.querySelectorAll('p')).find(p => 
      p.textContent.includes('future configuration options')
    );
    expect(futureText).toBeInTheDocument();
  });

  it('has consistent layout with other settings pages', () => {
    const { container } = render(<Setting5 />);
    
    // Should have Paper component structure (Material UI styling)
    const paperElement = container.querySelector('[class*="MuiPaper"]');
    expect(paperElement).toBeInTheDocument();
  });

  it('shows settings icon', () => {
    const { container } = render(<Setting5 />);
    
    // Should include settings icon
    const iconElement = container.querySelector('[data-testid="SettingsIcon"], svg');
    expect(iconElement).toBeInTheDocument();
  });
}); 