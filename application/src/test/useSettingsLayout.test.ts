import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettingsLayout } from '@/hooks/useSettingsLayout';

describe('Dimensions visibles des réglages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('suit le clavier et le décalage du viewport puis retire les écouteurs', () => {
    const visual = Object.assign(new EventTarget(), { height: 780, offsetTop: 0 });
    const remove = vi.spyOn(visual, 'removeEventListener');
    vi.stubGlobal('visualViewport', visual);
    vi.stubGlobal('innerWidth', 390);
    const { result, rerender, unmount } = renderHook(({ open, tv }) => useSettingsLayout(open, tv), { initialProps: { open: true, tv: false } });
    expect(result.current).toEqual({ mobile: true, height: 780, top: 0 });
    act(() => {
      visual.height = 410;
      visual.offsetTop = 54;
      visual.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ mobile: true, height: 410, top: 54 });
    rerender({ open: true, tv: true });
    expect(result.current.mobile).toBe(false);
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('utilise la hauteur de fenêtre sans visualViewport', () => {
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('innerHeight', 720);
    const { result } = renderHook(() => useSettingsLayout(true, false));
    expect(result.current.height).toBe(720);
    expect(result.current.top).toBe(0);
  });
});
