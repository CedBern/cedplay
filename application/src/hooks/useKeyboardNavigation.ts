import { useEffect, useState } from 'react';

export function useKeyboardNavigation<T>(
  items: T[],
  onSelect?: (item: T) => void,
  enabled: boolean = true
) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!enabled || items.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.documentElement.classList.contains('remote-navigation')) return;
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, [contenteditable="true"], [role="slider"], [role="tab"]')) return;
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : items.length - 1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex(prev => prev < items.length - 1 ? prev + 1 : 0);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (onSelect && items[selectedIndex]) {
            onSelect(items[selectedIndex]);
          }
          break;
        case 'Escape':
          event.preventDefault();
          setSelectedIndex(0);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items, selectedIndex, onSelect, enabled]);

  // Reset selected index when items change
  useEffect(() => {
    if (selectedIndex >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1));
    }
  }, [selectedIndex, items.length]);

  return {
    selectedIndex,
    setSelectedIndex
  };
}
