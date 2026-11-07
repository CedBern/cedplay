// Tests du dialog de connexion Xtream (XtreamLoginDialog.tsx).
// Le dialog Radix est fermé par défaut : on l'ouvre en cliquant le bouton
// « Connexion Xtream » (DialogTrigger), comme le fait PlaylistLoader.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { XtreamLoginDialog } from '@/components/XtreamLoginDialog';
import { toast } from 'sonner';
import { fetchXtreamLimits, saveXtreamAccount } from '@/utils/xtreamCatalog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/utils/xtreamCatalog', () => ({ saveXtreamAccount: vi.fn(), getXtreamAccount: vi.fn(() => null), fetchXtreamLimits: vi.fn(() => Promise.resolve({ maxConnections: 2, activeCons: 0, fetchedAt: 0 })) }));
vi.mock('@/utils/proxy', () => ({ getProxyBase: () => 'http://relais.test' }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { get: vi.fn(), post: vi.fn() },
}));

const toastMock = vi.mocked(toast);
const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

/** Saisit des identifiants (complets par défaut) dans le dialog déjà ouvert. */
async function remplir(user: ReturnType<typeof userEvent.setup>, creds?: { server?: string; user?: string; pass?: string }) {
  const { server = 'http://serveur.test:8080', user: username = 'user', pass = 'pass' } = creds ?? {};
  if (server) await user.type(screen.getByPlaceholderText('http://serveur.com:8080'), server);
  if (username) await user.type(screen.getByPlaceholderText('Identifiant'), username);
  if (pass) await user.type(screen.getByPlaceholderText('Mot de passe'), pass);
}

/** Ouvre le dialog et saisit des identifiants complets. */
async function ouvrirEtRemplir(user: ReturnType<typeof userEvent.setup>, creds?: { server?: string; user?: string; pass?: string }) {
  await user.click(screen.getByRole('button', { name: 'Connexion Xtream' }));
  await remplir(user, creds);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('XtreamLoginDialog', () => {
  it('refuse la connexion sans identifiants complets', async () => {
    const onPlaylistLoaded = vi.fn();
    const user = userEvent.setup();
    render(<XtreamLoginDialog onPlaylistLoaded={onPlaylistLoaded} />);

    await user.click(screen.getByRole('button', { name: 'Connexion Xtream' }));

    const boutonConnexion = screen.getByRole('button', { name: 'Se connecter & charger les catégories' });
    // Champs vides : le bouton est désactivé, c'est lui qui refuse la connexion.
    expect(boutonConnexion).toBeDisabled();

    // « Si on force » : un clic dispatché directement sur le DOM d'un bouton
    // disabled n'est jamais délivré par React à onClick (le filtre se base sur
    // les props, pas sur l'attribut DOM). Le refus est donc total : ni requête
    // réseau, ni toast, ni callback.
    // NB : le toast « Veuillez renseigner… » de fetchCategories est du code
    // défensif injoignable via l'UI — sa condition est identique au `disabled`
    // du bouton, et React ne transmet aucun évènement pointeur aux boutons
    // désactivés.
    fireEvent.click(boutonConnexion);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onPlaylistLoaded).not.toHaveBeenCalled();

    // Des identifiants remplis uniquement d'espaces laissent le bouton désactivé
    const serverInput = screen.getByPlaceholderText('http://serveur.com:8080');
    const userInput = screen.getByPlaceholderText('Identifiant');
    const passInput = screen.getByPlaceholderText('Mot de passe');
    await user.type(serverInput, '   ');
    await user.type(userInput, '   ');
    await user.type(passInput, '   ');
    expect(boutonConnexion).toBeDisabled();

    // Contre-épreuve : dès que les trois champs contiennent du texte valide, le bouton s'active.
    await user.clear(serverInput);
    await user.clear(userInput);
    await user.clear(passInput);
    await remplir(user);
    expect(boutonConnexion).toBeEnabled();
  });

  it('charge les catégories et présélectionne la France', async () => {
    const onPlaylistLoaded = vi.fn();
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/xtream/categories')) {
        return jsonResponse([
          { category_id: '1', category_name: 'FR | Généralistes' },
          { category_id: '2', category_name: 'UK' },
        ]);
      }
      return jsonResponse([]);
    });

    render(<XtreamLoginDialog onPlaylistLoaded={onPlaylistLoaded} />);
    await ouvrirEtRemplir(user);
    await user.click(screen.getByRole('button', { name: 'Se connecter & charger les catégories' }));

    expect(await screen.findByText('2 catégories trouvées (1 sélectionnée(s))')).toBeVisible();
    expect(toastMock.success).toHaveBeenCalledWith('2 catégories chargées.');

    // La catégorie FR est cochée, l'anglaise non.
    const labelFr = screen.getByText('FR | Généralistes').closest('label')!;
    const checkboxFr = labelFr.querySelector('button[role="checkbox"]') as HTMLElement;
    expect(checkboxFr).toHaveAttribute('aria-checked', 'true');
    const labelUk = screen.getByText('UK').closest('label')!;
    const checkboxUk = labelUk.querySelector('button[role="checkbox"]') as HTMLElement;
    expect(checkboxUk).toHaveAttribute('aria-checked', 'false');

    // Requête passée par le relais avec les identifiants encodés.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://relais.test/xtream/categories?server=http%3A%2F%2Fserveur.test%3A8080&username=user&password=pass'
    );
    expect(onPlaylistLoaded).not.toHaveBeenCalled();
  });

  it('affiche l’erreur du fournisseur et ses conseils', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        { error: 'Auth échouée', detail: 'Identifiants invalides', hints: ['Vérifiez votre abonnement', 'Un seul appareil à la fois'] },
        false,
        502
      )
    );

    render(<XtreamLoginDialog onPlaylistLoaded={vi.fn()} />);
    await ouvrirEtRemplir(user);
    await user.click(screen.getByRole('button', { name: 'Se connecter & charger les catégories' }));

    expect(await screen.findByText('Erreur : Auth échouée (Identifiants invalides)')).toBeVisible();
    expect(screen.getByText('Vérifiez votre abonnement')).toBeVisible();
    expect(screen.getByText('Un seul appareil à la fois')).toBeVisible();
    expect(toastMock.error).toHaveBeenCalledWith('Auth échouée (Identifiants invalides)');
  });

  it('importe les chaînes avec variante de secours et ferme le dialog', async () => {
    const onPlaylistLoaded = vi.fn();
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/xtream/categories')) {
        return jsonResponse([{ category_id: '1', category_name: 'FR | Généralistes' }]);
      }
      if (u.includes('/xtream/streams')) {
        return jsonResponse([
          {
            num: 1,
            name: 'TF1',
            stream_type: 'live',
            stream_id: 42,
            stream_icon: 'http://i/t.png',
            epg_channel_id: 'C42.1.tvg.com',
          },
        ]);
      }
      return jsonResponse([]);
    });

    render(<XtreamLoginDialog onPlaylistLoaded={onPlaylistLoaded} />);
    await ouvrirEtRemplir(user);
    await user.click(screen.getByRole('button', { name: 'Se connecter & charger les catégories' }));
    await screen.findByText('1 catégories trouvées (1 sélectionnée(s))');

    await user.click(screen.getByRole('button', { name: 'Importer les chaînes sélectionnées' }));

    await waitFor(() => expect(onPlaylistLoaded).toHaveBeenCalledTimes(1));
    const playlist = onPlaylistLoaded.mock.calls[0][0];
    expect(playlist.name).toBe('Xtream: user');
    expect(playlist.groups).toEqual([
      { name: 'FR | Généralistes', channels: [playlist.channels[0]] },
    ]);

    // Chaîne principale en HLS (.m3u8), variante de secours MPEG-TS (.ts).
    const tf1 = playlist.channels[0];
    expect(tf1.name).toBe('TF1');
    expect(tf1.url).toBe('http://serveur.test:8080/live/user/pass/42.m3u8');
    expect(tf1.variants).toHaveLength(1);
    expect(tf1.variants[0].url).toBe('http://serveur.test:8080/live/user/pass/42.ts');
    expect(tf1.variants[0].name).toBe('TF1 (TS)');
    expect(tf1.logo).toBe('http://i/t.png');
    expect(tf1.tvgId).toBe('C42.1.tvg.com');
    expect(tf1.group).toBe('FR | Généralistes');

    // Le compte est mémorisé pour le catalogue VOD, le dialog se referme.
    expect(saveXtreamAccount).toHaveBeenCalledWith(playlist.id, {
      server: 'http://serveur.test:8080',
      username: 'user',
      password: 'pass',
    });
    // Limites du compte (lectures simultanées) lues une fois, après l'import réussi.
    expect(fetchXtreamLimits).toHaveBeenCalledWith(playlist.id, {
      server: 'http://serveur.test:8080',
      username: 'user',
      password: 'pass',
    });
    expect(toastMock.success).toHaveBeenCalledWith('1 chaînes importées avec succès !');
    await waitFor(() => expect(screen.queryByText('Connexion Xtream Codes')).toBeNull());
    screen.getByRole('button', { name: 'Connexion Xtream' });
  });

  it('n’interrompt pas l’import si la lecture des limites échoue', async () => {
    vi.mocked(fetchXtreamLimits).mockRejectedValueOnce(new Error('hors ligne'));
    const onPlaylistLoaded = vi.fn();
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/xtream/categories')) return jsonResponse([{ category_id: '1', category_name: 'FR | Généralistes' }]);
      if (u.includes('/xtream/streams')) return jsonResponse([{ num: 1, name: 'TF1', stream_type: 'live', stream_id: 42 }]);
      return jsonResponse([]);
    });

    render(<XtreamLoginDialog onPlaylistLoaded={onPlaylistLoaded} />);
    await ouvrirEtRemplir(user);
    await user.click(screen.getByRole('button', { name: 'Se connecter & charger les catégories' }));
    await screen.findByText('1 catégories trouvées (1 sélectionnée(s))');
    await user.click(screen.getByRole('button', { name: 'Importer les chaînes sélectionnées' }));

    await waitFor(() => expect(onPlaylistLoaded).toHaveBeenCalledTimes(1));
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('1 chaînes importées avec succès !');
  });

  it('termine l’import sans attendre la lecture des limites', async () => {
    // Promesse jamais résolue : si le dialog l'awaitait, l'import resterait bloqué.
    vi.mocked(fetchXtreamLimits).mockImplementationOnce(() => new Promise(() => {}));
    const onPlaylistLoaded = vi.fn();
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/xtream/categories')) return jsonResponse([{ category_id: '1', category_name: 'FR | Généralistes' }]);
      if (u.includes('/xtream/streams')) return jsonResponse([{ num: 1, name: 'TF1', stream_type: 'live', stream_id: 42 }]);
      return jsonResponse([]);
    });

    render(<XtreamLoginDialog onPlaylistLoaded={onPlaylistLoaded} />);
    await ouvrirEtRemplir(user);
    await user.click(screen.getByRole('button', { name: 'Se connecter & charger les catégories' }));
    await screen.findByText('1 catégories trouvées (1 sélectionnée(s))');
    await user.click(screen.getByRole('button', { name: 'Importer les chaînes sélectionnées' }));

    await waitFor(() => expect(onPlaylistLoaded).toHaveBeenCalledTimes(1));
    expect(fetchXtreamLimits).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith('1 chaînes importées avec succès !');
    await waitFor(() => expect(screen.queryByText('Connexion Xtream Codes')).toBeNull());
  });
});
