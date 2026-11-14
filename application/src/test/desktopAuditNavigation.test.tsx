import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MainNavigation } from '@/components/MainNavigation';
import { Tabs } from '@/components/ui/tabs';
import { setDesktopRuntimeForTests } from '@/utils/desktopBridge';

afterEach(() => { cleanup(); setDesktopRuntimeForTests(null); });

it('keeps the Windows sidebar open while hovered when content takes keyboard focus', () => {
  setDesktopRuntimeForTests(true);
  render(<Tabs defaultValue="continue"><MainNavigation tv onNavigate={() => {}} /></Tabs>);
  const rail = screen.getByRole('navigation');
  const tab = screen.getByRole('tab', { name: 'Découvrir' });
  fireEvent.mouseEnter(rail);
  fireEvent.focus(tab);
  fireEvent.blur(tab, { relatedTarget: document.body });
  expect(rail).toHaveAttribute('data-expanded', 'true');
  fireEvent.click(tab);
  expect(rail).toHaveAttribute('data-expanded', 'false');
  fireEvent.mouseLeave(rail);
  fireEvent.mouseEnter(rail);
  expect(rail).toHaveAttribute('data-expanded', 'true');
});
