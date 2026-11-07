import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebounce } from '@/hooks/useDebounce';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebounce', () => {
  it('rend la valeur initiale immédiatement puis la confirme après le délai', () => {
    vi.useFakeTimers();
    const { result } = renderHook(({ value }) => useDebounce(value, 120), { initialProps: { value: 'a' } });
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(120); });
    expect(result.current).toBe('a');
  });

  it('propage la nouvelle valeur après le délai', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 120), { initialProps: { value: 'a' } });
    rerender({ value: 'abc' });
    act(() => { vi.advanceTimersByTime(60); });
    expect(result.current).toBe('a'); // pas encore stabilisé
    act(() => { vi.advanceTimersByTime(60); });
    expect(result.current).toBe('abc');
  });

  it('reprogramme le timer quand la valeur change pendant le délai', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 120), { initialProps: { value: 'a' } });
    rerender({ value: 'b' });
    act(() => { vi.advanceTimersByTime(50); });
    rerender({ value: 'c' }); // annule le timer de 'b'
    act(() => { vi.advanceTimersByTime(119); });
    expect(result.current).toBe('a'); // ni 'b' ni 'c' n'ont stabilisé
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('c'); // seul le dernier est retenu
  });

  it('respecte un délai personnalisé', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), { initialProps: { value: 'a', delay: 500 } });
    rerender({ value: 'b', delay: 500 });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('b');
  });
});
