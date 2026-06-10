import { describe, it, expect } from 'vitest';
import { classifyDestination } from '../qa/aiPrivacy';

describe('classifyDestination', () => {
  it('builtin and openai are cloud', () => {
    expect(classifyDestination({ provider: 'builtin' }).isCloud).toBe(true);
    expect(classifyDestination({ provider: 'openai' }).isCloud).toBe(true);
  });
  it('loopback custom is private, not cloud', () => {
    const d = classifyDestination({ provider: 'custom', baseUrl: 'http://localhost:11434/v1/chat/completions' });
    expect(d.isLoopback).toBe(true);
    expect(d.isPrivate).toBe(true);
    expect(d.isCloud).toBe(false);
  });
  it('RFC1918 custom is private', () => {
    expect(classifyDestination({ provider: 'custom', baseUrl: 'http://10.0.0.5/v1' }).isPrivate).toBe(true);
    expect(classifyDestination({ provider: 'custom', baseUrl: 'http://192.168.1.9/v1' }).isPrivate).toBe(true);
  });
  it('public custom host is cloud', () => {
    const d = classifyDestination({ provider: 'custom', baseUrl: 'https://api.openai.com/v1/chat/completions' });
    expect(d.isCloud).toBe(true);
    expect(d.isPrivate).toBe(false);
  });
});
