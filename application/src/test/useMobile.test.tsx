import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useIsMobile } from '@/hooks/use-mobile';

describe('useIsMobile', () => {
  let listeners: Array<() => void> = [];

  beforeEach(() => {
    listeners = [];
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn((_, cb) => listeners.push(cb)),
      removeEventListener: vi.fn((_, cb) => {
        listeners = listeners.filter(l => l !== cb);
      }),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('détecte le mode bureau quand la largeur est >= 768px', () => {
    window.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('détecte le mode mobile quand la largeur est < 768px', () => {
    window.innerWidth = 500;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('réagit au changement de taille via le listener matchMedia', () => {
    window.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      window.innerWidth = 400;
      listeners.forEach(cb => cb());
    });
    expect(result.current).toBe(true);
  });
});
