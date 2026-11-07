import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';

afterEach(() => {
  document.body.innerHTML = '';
});

function keyDown(key: string, init: Record<string, unknown> = {}) {
  act(() => {
    fireEvent.keyDown(window, { key, bubbles: true, cancelable: true, ...init });
  });
}

describe('useKeyboardNavigation', () => {
  const items = ['A', 'B', 'C'];

  it('descend et remonte dans la liste', () => {
    const { result } = renderHook(() => useKeyboardNavigation(items));
    keyDown('ArrowDown');
    keyDown('ArrowDown');
    expect(result.current.selectedIndex).toBe(2);
    keyDown('ArrowUp');
    expect(result.current.selectedIndex).toBe(1);
  });

  it('boucle en fin et début de liste (wrap-around)', () => {
    const { result } = renderHook(() => useKeyboardNavigation(items));
    keyDown('ArrowDown'); // 1
    keyDown('ArrowDown'); // 2
    keyDown('ArrowDown'); // wrap → 0
    expect(result.current.selectedIndex).toBe(0);
    keyDown('ArrowUp'); // wrap → dernier
    expect(result.current.selectedIndex).toBe(2);
  });

  it('Enter et Espace sélectionnent l\'élément courant', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useKeyboardNavigation(items, onSelect));
    keyDown('ArrowDown');
    keyDown('Enter');
    expect(onSelect).toHaveBeenCalledWith('B');
    keyDown(' ');
    expect(onSelect).toHaveBeenCalledWith('B');
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(result.current.selectedIndex).toBe(1);
  });

  it('Escape remet la sélection au début', () => {
    const { result } = renderHook(() => useKeyboardNavigation(items));
    keyDown('ArrowDown');
    keyDown('ArrowDown');
    keyDown('Escape');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('ignore les touches quand désactivé ou liste vide', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useKeyboardNavigation(items, onSelect, false));
    keyDown('ArrowDown');
    keyDown('Enter');
    expect(result.current.selectedIndex).toBe(0);
    expect(onSelect).not.toHaveBeenCalled();

    const empty = renderHook(() => useKeyboardNavigation([], onSelect));
    keyDown('ArrowDown');
    keyDown('Enter');
    expect(empty.result.current.selectedIndex).toBe(0);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignore les modificateurs (ctrl/alt/meta)', () => {
    const { result } = renderHook(() => useKeyboardNavigation(items));
    keyDown('ArrowDown', { ctrlKey: true });
    keyDown('ArrowDown', { altKey: true });
    keyDown('ArrowDown', { metaKey: true });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('ignore les touches issues d\'un champ de saisie ou d\'un bouton', () => {
    render(<div><input aria-label="recherche" /><button>Bouton</button></div>);
    const input = document.querySelector('input')!;
    const { result } = renderHook(() => useKeyboardNavigation(items));
    act(() => { fireEvent.keyDown(input, { key: 'ArrowDown', bubbles: true, cancelable: true }); });
    expect(result.current.selectedIndex).toBe(0);
    const button = document.querySelector('button')!;
    act(() => { fireEvent.keyDown(button, { key: 'ArrowDown', bubbles: true, cancelable: true }); });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('ignore les touches quand un dialogue est ouvert', () => {
    render(<div role="dialog">Dialogue</div>);
    const { result } = renderHook(() => useKeyboardNavigation(items));
    keyDown('ArrowDown');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('re-clampe l\'index quand la liste rétrécit', () => {
    const { result, rerender } = renderHook(({ list }) => useKeyboardNavigation(list), { initialProps: { list: items } });
    keyDown('ArrowDown');
    keyDown('ArrowDown');
    expect(result.current.selectedIndex).toBe(2);
    rerender({ list: ['A'] });
    expect(result.current.selectedIndex).toBe(0);
  });
});
