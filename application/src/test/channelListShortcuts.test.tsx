import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelList } from '@/components/ChannelList';
import { getMeta, setMeta } from '@/utils/idb';
import { Channel } from '@/types/channel';

afterEach(cleanup);

beforeEach(async () => {
  await Promise.all([
    setMeta('selectedGroup', 'all'),
    setMeta('qualityFilter', 'all'),
    setMeta('favorites', []),
    setMeta('playHistory', []),
  ]);
});

const sampleChannels: Channel[] = [
  { id: 'ch1', name: 'TF1 HD', url: 'https://example.test/tf1', group: 'Généraliste', quality: 'HD' },
  { id: 'ch2', name: 'France 2 4K', url: 'https://example.test/fr2', group: 'Généraliste', quality: '4K' },
  { id: 'ch3', name: 'M6 SD', url: 'https://example.test/m6', group: 'Divertissement', quality: 'SD' },
];

describe('ChannelList shortcuts et favoris', () => {
  it('bascule une chaîne en favori au clic sur le bouton cœur', async () => {
    await setMeta('favorites', []);
    render(
      <ChannelList
        groups={[
          { name: 'Généraliste', channels: [sampleChannels[0], sampleChannels[1]] },
          { name: 'Divertissement', channels: [sampleChannels[2]] },
        ]}
        onChannelSelect={() => {}}
      />
    );

    await screen.findByRole('heading', { name: /^1\. TF1 HD/ });

    // Bouton ajouter aux favoris pour TF1 HD
    const favBtn = screen.getByRole('button', { name: 'Ajouter TF1 HD aux favoris' });
    await userEvent.click(favBtn);

    // Le bouton doit maintenant proposer de retirer des favoris
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retirer TF1 HD des favoris' })).toBeInTheDocument();
    });

    // Vérifie que l'id est persisté
    const favs = await getMeta('favorites');
    expect(favs).toContain('ch1');
  });

  it('active la barre de recherche avec le raccourci clavier "/"', async () => {
    render(
      <ChannelList
        groups={[{ name: 'Généraliste', channels: sampleChannels }]}
        onChannelSelect={() => {}}
      />
    );

    const searchInput = screen.getByRole('textbox', { name: 'Rechercher une chaîne' });
    expect(document.activeElement).not.toBe(searchInput);

    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(searchInput);
  });

  it('bascule sur les chaînes récentes avec le raccourci clavier "r"', async () => {
    await Promise.all([
      setMeta('selectedGroup', 'all'),
      setMeta('playHistory', [{ channelId: 'ch1', ts: Date.now() }]),
    ]);

    render(
      <ChannelList
        groups={[{ name: 'Généraliste', channels: sampleChannels }]}
        onChannelSelect={() => {}}
      />
    );

    await screen.findByRole('heading', { name: /^1\. TF1 HD/ });
    fireEvent.keyDown(window, { key: 'r' });

    await waitFor(async () => {
      expect(await getMeta('selectedGroup')).toBe('recent');
    });
  });

  it('cycle les filtres de qualité avec le raccourci "q"', async () => {
    render(
      <ChannelList
        groups={[{ name: 'Généraliste', channels: sampleChannels }]}
        onChannelSelect={() => {}}
      />
    );

    await screen.findByRole('heading', { name: /^1\. TF1 HD/ });

    // Cycle: all -> 4K
    fireEvent.keyDown(window, { key: 'q' });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /France 2/ })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /TF1 HD/ })).toBeNull();
    });
  });
});
