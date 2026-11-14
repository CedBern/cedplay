import 'fake-indexeddb/auto';
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

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

it('ignore un ancien lot après fermeture et relance, même si le lot revient en retard', async () => {
  const { clearChannelHealth } = await import('@/utils/streamCheck');
  await clearChannelHealth('default');
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
  const { clearChannelHealth } = await import('@/utils/streamCheck');
  await clearChannelHealth('default');
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

it('permet de filtrer et sélectionner des catégories pour restreindre le scan', async () => {
  const sport1 = { id: 's1', name: 'Sport 1', url: 'https://cdn/s1.ts', group: 'Sport' };
  const sport2 = { id: 's2', name: 'Sport 2', url: 'https://cdn/s2.ts', group: 'Sport' };
  const cine1 = { id: 'c1', name: 'Ciné 1', url: 'https://cdn/c1.ts', group: 'Cinéma' };
  const playlist = {
    id: 'pl-1',
    name: 'Ma Liste',
    channels: [sport1, sport2, cine1],
    groups: [
      { name: 'Sport', channels: [sport1, sport2] },
      { name: 'Cinéma', channels: [cine1] },
    ],
  };

  mock.probe.mockResolvedValue([
    { ok: true, status: 200 },
    { ok: true, status: 200 },
  ]);

  render(<ChannelHealthDialog {...props} playlist={playlist} open />);

  // Vérifier la présence du mode catégories
  expect(screen.getByText('2 sélectionnées')).toBeVisible();

  // Filtrer les catégories par recherche
  const searchInput = screen.getByPlaceholderText('Filtrer les catégories…');
  fireEvent.change(searchInput, { target: { value: 'Sport' } });
  expect(screen.getByText('Sport')).toBeVisible();
  expect(screen.queryByText('Cinéma')).toBeNull();

  // Désélectionner tout puis cocher uniquement Sport
  fireEvent.click(screen.getByRole('button', { name: 'Tout décocher' }));
  fireEvent.click(screen.getByText('Sport'));

  // Lancer le scan : seules les 2 chaînes de Sport doivent être vérifiées
  fireEvent.click(screen.getByRole('button', { name: 'Lancer la vérification' }));

  await waitFor(() => {
    expect(mock.probe).toHaveBeenCalledWith(
      ['https://cdn/s1.ts', 'https://cdn/s2.ts'],
      expect.any(Function),
      expect.any(Object),
      expect.objectContaining({ timeoutMs: 6000 }),
    );
  });
});

it('reprend le scan en ne testant que les chaînes non encore vérifiées', async () => {
  const ch1 = { id: 'c1', name: 'Ch 1', url: 'https://cdn/1.ts' };
  const ch2 = { id: 'c2', name: 'Ch 2', url: 'https://cdn/2.ts' };
  const playlist = {
    id: 'pl-resume',
    name: 'Liste Reprise',
    channels: [ch1, ch2],
    groups: [{ name: 'Général', channels: [ch1, ch2] }],
  };

  // Pré-enregistrer ch1 comme répondant dans IndexedDB
  const { saveChannelHealth } = await import('@/utils/streamCheck');
  await saveChannelHealth('pl-resume', {
    c1: { channelId: 'c1', url: 'https://cdn/1.ts', ok: true, status: 200, checkedAt: Date.now() },
  });

  mock.probe.mockResolvedValue([{ ok: true, status: 200 }]);

  render(<ChannelHealthDialog {...props} playlist={playlist} open />);

  // Attendre le chargement de l'historique : 1 répond, 1 non vérifiée
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Vérifier les non testées (1)' })).toBeVisible();
  });

  // Cliquer sur le bouton de reprise
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier les non testées (1)' }));

  await waitFor(() => {
    expect(mock.probe).toHaveBeenCalledWith(
      ['https://cdn/2.ts'],
      expect.any(Function),
      expect.any(Object),
      expect.any(Object),
    );
  });
});

it('propose de retester spécifiquement les échecs et permet le retest individuel', async () => {
  const chFail = { id: 'f1', name: 'Chaîne Échec', url: 'https://cdn/fail.ts' };
  const playlist = {
    id: 'pl-fail',
    name: 'Liste Échecs',
    channels: [chFail],
    groups: [{ name: 'Général', channels: [chFail] }],
  };

  const { saveChannelHealth } = await import('@/utils/streamCheck');
  await saveChannelHealth('pl-fail', {
    f1: { channelId: 'f1', url: 'https://cdn/fail.ts', ok: false, status: 503, checkedAt: Date.now() },
  });

  mock.probe.mockResolvedValue([{ ok: true, status: 200 }]);

  render(<ChannelHealthDialog {...props} playlist={playlist} open />);

  // Attendre l'affichage de l'échec et du bouton de retest
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Retester les échecs \(1\)/ })).toBeVisible();
    expect(screen.getByText('Erreur du serveur (503)')).toBeVisible();
  });

  // Retester spécifiquement cette chaîne via le bouton individuel
  fireEvent.click(screen.getByRole('button', { name: 'Retester' }));

  await waitFor(() => {
    expect(mock.probe).toHaveBeenCalledWith(['https://cdn/fail.ts']);
  });
});

it('invalide un ancien résultat si l’adresse du flux a changé', async () => {
  const chUpdated = { id: 'u1', name: 'Chaîne Maj', url: 'https://cdn/nouvelle-adresse.ts' };
  const playlist = {
    id: 'pl-invalidated',
    name: 'Liste Maj',
    channels: [chUpdated],
    groups: [{ name: 'Général', channels: [chUpdated] }],
  };

  const { saveChannelHealth } = await import('@/utils/streamCheck');
  // L'ancienne adresse enregistrée était différente
  await saveChannelHealth('pl-invalidated', {
    u1: { channelId: 'u1', url: 'https://cdn/ancienne-adresse.ts', ok: true, status: 200, checkedAt: Date.now() },
  });

  render(<ChannelHealthDialog {...props} playlist={playlist} open />);

  // La chaîne doit être considérée comme non vérifiée car son URL a changé
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Lancer la vérification' })).toBeVisible();
    expect(screen.queryByText('Toutes les chaînes vérifiées répondent.')).toBeNull();
  });
});

it('permet de valider la sélection directement depuis le panneau des catégories avec le bouton dédié', async () => {
  const c1 = { id: 'c1', name: 'Canal 1', url: 'https://cdn/c1.ts', group: 'Actualité' };
  const c2 = { id: 'c2', name: 'Canal 2', url: 'https://cdn/c2.ts', group: 'Actualité' };
  const c3 = { id: 'c3', name: 'Canal 3', url: 'https://cdn/c3.ts', group: 'Musique' };
  const playlist = {
    id: 'pl-valider',
    name: 'Liste Test',
    channels: [c1, c2, c3],
    groups: [
      { name: 'Actualité', channels: [c1, c2] },
      { name: 'Musique', channels: [c3] },
    ],
  };

  mock.probe.mockResolvedValue([
    { ok: true, status: 200 },
    { ok: true, status: 200 },
  ]);

  render(<ChannelHealthDialog {...props} playlist={playlist} open />);

  // Décoche tout puis sélectionne seulement Actualité
  fireEvent.click(screen.getByRole('button', { name: 'Tout décocher' }));
  const btnActu = screen.getByText('Actualité');
  fireEvent.click(btnActu);

  // Le bouton de validation directe de la sélection doit être visible dans le panneau
  const validateBtn = screen.getByRole('button', { name: 'Vérifier cette sélection (2)' });
  expect(validateBtn).toBeVisible();

  // Cliquer sur le bouton de validation lance immédiatement le scan sur les 2 chaînes
  fireEvent.click(validateBtn);

  await waitFor(() => {
    expect(mock.probe).toHaveBeenCalledWith(
      ['https://cdn/c1.ts', 'https://cdn/c2.ts'],
      expect.any(Function),
      expect.any(Object),
      expect.any(Object),
    );
  });
});
