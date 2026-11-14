import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';
import userEvent from '@testing-library/user-event';
import { GlobalSearchDialog } from '@/components/GlobalSearchDialog';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import type { Channel, PlaylistInfo } from '@/types/channel';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function SearchWithRemote({ query = '' }: { query?: string }) {
  useRemoteNavigation();
  return <GlobalSearchDialog open tvMode initialQuery={query} onOpenChange={() => {}}
    playlist={testPlaylist} onSelectChannel={() => {}} onSelectTab={() => {}} />;
}

function searchGeometry() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    // La géométrie favoriserait l'ancienne recherche, à droite sous le champ.
    const first = this.hasAttribute('data-recent-search-first');
    const row = first || this.textContent === 'recente2' || this.hasAttribute('data-search-first-result');
    const x = first ? 0 : this.matches('input') || row ? 200 : 500;
    const y = this.matches('input') ? 0 : row ? 100 : 300;
    return { x, y, left: x, top: y, right: x + 80, bottom: y + 40, width: 80, height: 40, toJSON() {} };
  });
}

const channels: Channel[] = [
  { id: '1', name: 'TF1 HD', url: 'https://example.test/tf1', group: 'France', quality: 'HD' },
  { id: '2', name: 'France 2 FHD', url: 'https://example.test/fr2', group: 'France', quality: 'FHD' },
  { id: '3', name: 'Canal+ Sport', url: 'https://example.test/cplus', group: 'Sport', quality: 'HD' },
];

const testPlaylist: PlaylistInfo = {
  id: 'test-playlist',
  name: 'Test Playlist',
  channels,
  groups: [{ name: 'France', channels: [channels[0], channels[1]] }, { name: 'Sport', channels: [channels[2]] }],
};

it('affiche les suggestions populaires quand la recherche est vide', () => {
  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={() => {}}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  expect(screen.getByText('Recherche unifiée')).toBeTruthy();
  expect(screen.getByText('Recherches populaires :')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'TF1' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Netflix' })).toBeTruthy();
});

it('recherche et sélectionne une chaîne en direct', async () => {
  const onSelectChannel = vi.fn();
  const onOpenChange = vi.fn();
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={onOpenChange}
      playlist={testPlaylist}
      onSelectChannel={onSelectChannel}
      onSelectTab={() => {}}
    />
  );

  const input = screen.getByRole('textbox', { name: 'Rechercher' });
  await user.type(input, 'France 2');

  const channelBtn = await screen.findByRole('button', { name: /France 2 FHD/ });
  expect(channelBtn).toBeTruthy();

  await user.click(channelBtn);
  expect(onSelectChannel).toHaveBeenCalledWith(channels[1]);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('trouve une plateforme de streaming et déclenche openWeb', async () => {
  const openWebSpy = vi.spyOn(NativePlayerBridge, 'openWeb').mockResolvedValue(true);
  const onOpenChange = vi.fn();
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={onOpenChange}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  const input = screen.getByRole('textbox', { name: 'Rechercher' });
  await user.type(input, 'Netflix');

  const netflixBtn = await screen.findByRole('button', { name: /Netflix/ });
  expect(netflixBtn).toBeTruthy();

  await user.click(netflixBtn);
  // Application officielle d'abord (allowAppHome), sinon navigateur : paquets transmis au pont natif.
  expect(openWebSpy).toHaveBeenCalledWith('https://www.netflix.com', undefined, ['com.netflix.mediaclient', 'com.netflix.ninja'], true);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('affiche un message quand aucun résultat ne correspond', async () => {
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={() => {}}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  const input = screen.getByRole('textbox', { name: 'Rechercher' });
  await user.type(input, 'xyzintrouvable123');

  expect(await screen.findByText(/Aucun résultat pour « xyzintrouvable123 »/)).toBeTruthy();
});

it('affiche les recherches récentes et les remet dans le champ', async () => {
  localStorage.setItem('cedplay_search_history', JSON.stringify(['miserables', 'Netflix']));
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={() => {}}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  expect(await screen.findByText('Recherches récentes')).toBeTruthy();
  // Les suggestions populaires restent proposées sous l'historique.
  expect(screen.getByText('Recherches populaires :')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'miserables' }));
  expect(screen.getByRole('textbox', { name: 'Rechercher' })).toHaveValue('miserables');
});

it('garde une recherche en mémoire après l’ouverture d’un résultat', async () => {
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={() => {}}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  await user.type(screen.getByRole('textbox', { name: 'Rechercher' }), 'France 2');
  await user.click(await screen.findByRole('button', { name: /France 2 FHD/ }));

  // La requête est gardée sur l'appareil : la rouvrir ne demande pas de la retaper.
  expect(JSON.parse(localStorage.getItem('cedplay_search_history') || '[]')).toEqual(['France 2']);
});

it('retire une recherche récente et peut effacer tout l’historique', async () => {
  localStorage.setItem('cedplay_search_history', JSON.stringify(['arte', 'canal']));
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={() => {}}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  await user.click(await screen.findByRole('button', { name: /Retirer « arte »/ }));
  expect(screen.queryByRole('button', { name: 'arte' })).toBeNull();
  expect(screen.getByRole('button', { name: 'canal' })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Effacer' }));
  expect(screen.queryByText('Recherches récentes')).toBeNull();
});

it('restaure initialQuery et notifie les changements de saisie via onQueryChange', async () => {
  const onQueryChange = vi.fn();
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      initialQuery="France"
      onQueryChange={onQueryChange}
      onOpenChange={() => {}}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  const input = screen.getByRole('textbox', { name: 'Rechercher' });
  expect(input).toHaveValue('France');
  expect(onQueryChange).toHaveBeenCalledWith('France');

  await user.type(input, ' 3');
  expect(onQueryChange).toHaveBeenCalledWith('France 3');
});

it('en mode TV : la croix de suppression de l’historique est exclue du D-pad et Flèche bas descend sur le premier terme', async () => {
  localStorage.setItem('cedplay_search_history', JSON.stringify(['recente1', 'recente2']));

  render(
    <GlobalSearchDialog
      open={true}
      tvMode={true}
      onOpenChange={() => {}}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  const removeBtns = screen.getAllByRole('button', { name: /Retirer «/ });
  expect(removeBtns.length).toBe(2);
  // En mode TV, la croix ne doit pas prendre le focus spatial (tabIndex -1 et non cliquable télécommande)
  removeBtns.forEach(btn => {
    expect(btn).toHaveAttribute('tabindex', '-1');
    expect(btn.className).toContain('pointer-events-none');
  });

  const firstRecent = screen.getByRole('button', { name: 'recente1' });
  expect(firstRecent).toHaveAttribute('data-recent-search-first', 'true');
});

it('avec la navigation globale active, Bas choisit la recherche récente et Haut revient au champ', () => {
  localStorage.setItem('cedplay_search_history', JSON.stringify(['recente1', 'recente2']));
  searchGeometry();
  render(<SearchWithRemote />);
  const input = screen.getByRole('textbox', { name: 'Rechercher' });
  const recent = screen.getByRole('button', { name: 'recente1' });
  input.focus();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(recent).toHaveFocus();
  fireEvent.keyDown(recent, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: 'recente2' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(input).toHaveFocus();
  expect(screen.getByRole('button', { name: 'recente1' })).toBeInTheDocument();
});

it('avec la navigation globale active, Bas entre dans les résultats et Haut revient au champ', async () => {
  searchGeometry();
  render(<SearchWithRemote query="France 2" />);
  const input = screen.getByRole('textbox', { name: 'Rechercher' });
  const result = await screen.findByRole('button', { name: /France 2 FHD/ });
  input.focus();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(result).toHaveFocus();
  fireEvent.keyDown(result, { key: 'ArrowUp' });
  expect(input).toHaveFocus();
});
