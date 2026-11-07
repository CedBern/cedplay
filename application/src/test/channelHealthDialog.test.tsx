import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChannelHealthDialog } from '@/components/ChannelHealthDialog';
import type { ProbeResult } from '@/utils/streamCheck';

const mock = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock('@/utils/streamCheck', async original => ({
  ...await original<typeof import('@/utils/streamCheck')>(), probeStreams: mock.probe,
}));
const channel = { id: 'a', name: 'Chaîne test', url: 'https://example.test/a' };
const props = { onOpenChange: vi.fn(), visibleChannels: [channel], favoriteIds: [], hiddenChannelIds: [], onHide: vi.fn(), onShowAll: vi.fn() };
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('ignore un ancien lot après fermeture et relance, même si le lot revient en retard', async () => {
  const jobs: { progress: (done: number, results: ProbeResult[]) => void; finish: () => void }[] = [];
  mock.probe.mockImplementation((_urls, progress) => new Promise<void>(resolve => jobs.push({ progress, finish: resolve })));
  const view = render(<ChannelHealthDialog {...props} open />);
  fireEvent.click(screen.getByRole('button', { name: 'Lancer la vérification' }));
  await waitFor(() => expect(jobs).toHaveLength(1));
  view.rerender(<ChannelHealthDialog {...props} open={false} />);
  view.rerender(<ChannelHealthDialog {...props} open />);
  fireEvent.click(screen.getByRole('button', { name: /Lancer la vérification|Relancer/ }));
  await waitFor(() => expect(jobs).toHaveLength(2));
  await act(async () => { jobs[0].progress(1, [{ ok: false, status: 404 }]); jobs[0].finish(); });
  expect(screen.getByText('Vérification en cours…')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Masquer 1' })).toBeNull();
  await act(async () => { jobs[1].progress(1, [{ ok: true, status: 200 }]); jobs[1].finish(); });
  expect(screen.getByText('Toutes les chaînes vérifiées répondent.')).toBeVisible();
});

it('conserve les résultats partiels lorsque l’utilisateur arrête volontairement le contrôle', async () => {
  let finish!: () => void;
  mock.probe.mockImplementation(async (_urls, progress, signal) => {
    progress(1, [{ ok: false, status: 404 }]);
    await new Promise<void>(resolve => { finish = () => { expect(signal.aborted).toBe(true); resolve(); }; });
  });
  render(<ChannelHealthDialog {...props} open />);
  fireEvent.click(screen.getByRole('button', { name: 'Lancer la vérification' }));
  fireEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
  await act(async () => finish());
  fireEvent.click(screen.getByRole('button', { name: 'Masquer 1' }));
  expect(props.onHide).toHaveBeenCalledWith(['a']);
});
