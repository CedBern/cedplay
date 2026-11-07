import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '@/App';

const native = vi.hoisted(() => ({ addListener: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: native.addListener } }));
vi.mock('@/pages/Index', () => ({ default: () => <div>Accueil test</div> }));
vi.mock('@/utils/storage', () => ({ StorageManager: { getSettings: () => ({ theme: 'dark' }), getCachedSettings: () => ({ theme: 'dark' }), loadSettingsAsync: async () => ({ theme: 'dark', telemetryPersistence: false }) } }));
afterEach(cleanup);

it('retire aussi les écouteurs Android dont l’inscription se termine après un démontage', async () => {
  const pending: ((handle: { remove: () => Promise<void> }) => void)[] = [];
  native.addListener.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const view = render(<App />);
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  view.unmount();
  const removals = pending.map(() => vi.fn(async () => {}));
  await act(async () => pending.forEach((resolve, i) => resolve({ remove: removals[i] })));
  removals.forEach(remove => expect(remove).toHaveBeenCalledOnce());
});

it('retire l’écouteur déjà inscrit quand l’application est démontée', async () => {
  const remove = vi.fn(async () => {});
  native.addListener.mockResolvedValue({ remove });
  const view = render(<App />);
  await waitFor(() => expect(native.addListener).toHaveBeenCalled());
  await act(async () => {});
  view.unmount();
  expect(remove).toHaveBeenCalledOnce();
});
