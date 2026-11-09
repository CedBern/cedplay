// Réglage « mes abonnements » : la liste vient de TMDB pour le pays choisi.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ fetchRegionProviders: vi.fn() }));
vi.mock('@/utils/tmdb', () => ({ fetchRegionProviders: mocks.fetchRegionProviders }));

import { WatchSubscriptions } from '@/components/WatchSubscriptions';

const providers = [
  { providerId: 8, name: 'Netflix', logoPath: '/n.png', priority: 1 },
  { providerId: 457, name: 'VIX', logoPath: null, priority: 3 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRegionProviders.mockResolvedValue(providers);
});
afterEach(cleanup);

it('liste les plateformes du pays et transmet la sélection', async () => {
  const onChange = vi.fn();
  render(<WatchSubscriptions apiKey="cle" region="MX" selected={[8]} onChange={onChange} />);

  expect(await screen.findByRole('button', { name: /Netflix/ })).toHaveAttribute('aria-pressed', 'true');
  expect(mocks.fetchRegionProviders).toHaveBeenCalledWith('MX', 'cle');

  await userEvent.click(screen.getByRole('button', { name: /VIX/ }));
  expect(onChange).toHaveBeenCalledWith([8, 457]);

  await userEvent.click(screen.getByRole('button', { name: /Netflix/ }));
  expect(onChange).toHaveBeenCalledWith([]);
});

it('demande la clé TMDB avant tout appel réseau', () => {
  render(<WatchSubscriptions apiKey="  " region="MX" selected={[]} onChange={() => {}} />);
  expect(screen.getByText(/Renseigne d’abord une clé TMDB/)).toBeInTheDocument();
  expect(mocks.fetchRegionProviders).not.toHaveBeenCalled();
});

it('signale une liste indisponible sans bloquer les réglages', async () => {
  mocks.fetchRegionProviders.mockRejectedValue(new Error('réseau'));
  render(<WatchSubscriptions apiKey="cle" region="FR" selected={[]} onChange={() => {}} />);
  expect(await screen.findByText(/Liste des plateformes indisponible/)).toBeInTheDocument();
});
