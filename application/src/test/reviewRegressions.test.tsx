import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBackup, parseBackup } from '@/utils/backup';
import { getVodWatchlistFromDB, setMeta, toggleVodWatchlist } from '@/utils/idb';
import { translateSrt } from '@/utils/subtitleTranslator';
import { GlobalSearchDialog } from '@/components/GlobalSearchDialog';
import { ParentalPinDialog } from '@/components/ParentalPinDialog';
import { StorageManager } from '@/utils/storage';
import { SettingsPanel } from '@/components/SettingsPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('exporte puis relit une chaîne avec son numéro M3U', () => {
  const channel = { id: 'a', name: 'A', url: 'https://example.test/a', chno: '12' };
  const playlist = { id: 'p', name: 'P', channels: [channel], groups: [{ name: 'G', channels: [channel] }] };
  expect(parseBackup(JSON.stringify(createBackup([playlist], []))).playlists[0].channels[0].chno).toBe('12');
});

it('conserve deux ajouts simultanés à Ma Liste', async () => {
  await setMeta('vod_watchlist', []);
  await Promise.all(['1', '2'].map(id => toggleVodWatchlist({ id, name: id, kind: 'movie', playlistId: 'p' })));
  expect(await getVodWatchlistFromDB()).toHaveLength(2);
});

it('limite les résultats VOD de recherche à la liste active', async () => {
  await setMeta('vod_watchlist', [{ id: '1', name: 'Film privé autre liste', kind: 'movie', playlistId: 'other' }]);
  render(<GlobalSearchDialog open onOpenChange={() => {}} playlist={{ id: 'p', name: 'P', channels: [], groups: [] }} onSelectChannel={() => {}} onSelectTab={() => {}} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Rechercher' }), 'Film privé');
  expect(screen.queryByRole('button', { name: /Film privé autre liste/ })).toBeNull();
});

it('transmet le titre choisi depuis la recherche et pas seulement son onglet', async () => {
  const item = { id: '42', name: 'Film enregistré', kind: 'movie' as const, playlistId: 'p', addedAt: 0 };
  await setMeta('vod_watchlist', [item]);
  const select = vi.fn();
  render(<GlobalSearchDialog open onOpenChange={() => {}} playlist={{ id: 'p', name: 'P', channels: [], groups: [] }} onSelectChannel={() => {}} onSelectTab={() => {}} onSelectVod={select} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Rechercher' }), 'Film enregistré');
  await userEvent.click(await screen.findByRole('button', { name: /Film enregistré/ }));
  expect(select).toHaveBeenCalledWith(item);
});

it('signale un échec de traduction au lieu de déclarer le texte VO traduit', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(translateSrt('1\n00:00:01,000 --> 00:00:02,000\nHello')).rejects.toThrow();
});

it('refuse une traduction qui a perdu la séparation des répliques', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [[['Bonjour au revoir']]] }));
  await expect(translateSrt('1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nBye')).rejects.toThrow();
});

it('utilise l’authentification DeepL actuelle sans clé dans le corps de requête', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ translations: [{ text: 'Bonjour' }] }) });
  vi.stubGlobal('fetch', fetcher);
  await translateSrt('1\n00:00:01,000 --> 00:00:02,000\nHello', 'fr', { deeplApiKey: 'test-key:fx' });
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('DeepL-Auth-Key test-key:fx');
  expect(fetcher.mock.calls[0][1].body).not.toContain('auth_key');
});

it('ne contourne pas le délai du PIN en fermant et rouvrant le dialogue', async () => {
  const props = { pin: '1234', onOpenChange: () => {}, onUnlock: vi.fn() };
  const { rerender } = render(<ParentalPinDialog open {...props} />);
  const user = userEvent.setup();
  for (let i = 0; i < 5; i++) {
    await user.type(screen.getByLabelText('Code parental'), '9999');
    await user.click(screen.getByRole('button', { name: 'Déverrouiller' }));
  }
  expect(screen.getByLabelText('Code parental')).toBeDisabled();
  rerender(<ParentalPinDialog open={false} {...props} />);
  rerender(<ParentalPinDialog open {...props} />);
  expect(screen.getByLabelText('Code parental')).toBeDisabled();
});

it('exige le code actuel pour désactiver la protection parentale', async () => {
  const save = vi.spyOn(StorageManager, 'saveSettings').mockResolvedValue(StorageManager.getSettings());
  render(<SettingsPanel open onOpenChange={() => {}} currentSettings={{ ...StorageManager.getSettings(), parentalControlEnabled: true, parentalPin: '1234' }} onSettingsChange={() => {}} />);
  await userEvent.click(screen.getByLabelText('Verrouiller les groupes adultes derrière un code'));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(save).not.toHaveBeenCalled();
});
