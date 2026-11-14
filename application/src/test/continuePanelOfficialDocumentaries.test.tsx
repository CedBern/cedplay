import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ContinuePanel } from '@/components/ContinuePanel';
import { useOfficialDocumentaries } from '@/hooks/useOfficialDocumentaries';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { setMeta } from '@/utils/idb';
import { orderRows } from '@/utils/discover';
import { clearPodcastStorageForTests } from '@/utils/podcastStorage';
vi.mock('@/hooks/useBodlavDocumentaries', () => ({ useBodlavDocumentaries: () => [] }));
vi.mock('@/hooks/useOfficialDocumentaries', () => ({ useOfficialDocumentaries: vi.fn() }));
const item = { id: '/fr/documentaires/societe/film', title: 'Film documentaire', url: 'https://www.tv5mondeplus.com/fr/documentaires/societe/film', image: 'https://assets.tv5mondeplus.com/imagescaler002/tv5monde/tv5mondeplus/assets/a.jpg?w=423' };
const props = { playlist: { id: 'official-ui', name: 'Test', channels: [], groups: [] }, onChannelSelect: vi.fn(), onOpenVod: vi.fn(), tvMode: true };
beforeEach(async () => {
  localStorage.clear(); clearPodcastStorageForTests(); await setMeta('playHistory', []); await setMeta('vod_watchlist', []); await setMeta('favorites', []);
  vi.mocked(useOfficialDocumentaries).mockReturnValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('garde les deux accès officiels même sans catalogue et les place après Bodlav', async () => {
  render(<ContinuePanel {...props} />);
  const tv5 = await screen.findByRole('region', { name: 'Documentaires TV5MONDEplus' });
  expect(within(tv5).getByRole('button', { name: 'Tous les documentaires sur TV5MONDEplus' })).toHaveAttribute('data-discover-card');
  expect(screen.getByRole('region', { name: 'Documentaires ImagoTV' })).toBeVisible();
  const present = new Set(['bodlav-documentaries', 'tv5-documentaries', 'imago-documentaries', 'platforms'] as const);
  expect(orderRows(present, ['video'], 'all')).toEqual(['bodlav-documentaries', 'tv5-documentaries', 'imago-documentaries', 'platforms']);
  expect(orderRows(present, ['video'], 'series')).toEqual(['platforms']);
});
it('ouvre le catalogue officiel Web avec protection opener, sans lecture VOD', async () => {
  vi.spyOn(NativePlayerBridge, 'isAvailable').mockReturnValue(false); const tab = { opener: {} }; const open = vi.spyOn(window, 'open').mockReturnValue(tab as Window);
  render(<ContinuePanel {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'Tous les documentaires sur ImagoTV' }));
  expect(open).toHaveBeenCalledWith('https://www.imagotv.fr/documentaires', '_blank', 'noopener,noreferrer'); expect(tab.opener).toBeNull(); expect(props.onOpenVod).not.toHaveBeenCalled();
});
it('affiche un vrai titre, alimente le héros et ouvre sa fiche exacte sur Android', async () => {
  vi.mocked(useOfficialDocumentaries).mockImplementation(source => source === 'tv5mondeplus' ? [item] : []);
  vi.spyOn(NativePlayerBridge, 'isAvailable').mockReturnValue(true); const open = vi.spyOn(NativePlayerBridge, 'openWeb').mockResolvedValue(true);
  render(<ContinuePanel {...props} />); const card = await screen.findByRole('button', { name: 'Ouvrir Film documentaire sur TV5MONDEplus' });
  expect(card.querySelector('img')).toHaveAttribute('src', item.image); expect(card).toHaveAttribute('data-remote-entry'); fireEvent.focus(card);
  expect(screen.getByRole('region', { name: 'Contenu sélectionné' })).toHaveTextContent(item.title); fireEvent.click(card); expect(open).toHaveBeenCalledWith(item.url, item.title);
});
it('masque et suspend sous verrou ou filtres Séries/Podcasts, invalide le contexte playlist', async () => {
  const view = render(<ContinuePanel {...props} />); await screen.findByRole('region', { name: 'Documentaires TV5MONDEplus' });
  fireEvent.click(screen.getByRole('button', { name: 'Films' })); expect(screen.getByRole('region', { name: 'Documentaires ImagoTV' })).toBeVisible();
  fireEvent.focus(screen.getByRole('button', { name: 'Tous les documentaires sur ImagoTV' }));
  fireEvent.click(screen.getByRole('button', { name: 'Séries' })); expect(screen.queryByRole('region', { name: 'Documentaires ImagoTV' })).toBeNull();
  expect(vi.mocked(useOfficialDocumentaries).mock.lastCall?.[1]).toBe(false); expect(screen.queryByText('Parcourir la rubrique officielle')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Podcasts' })); expect(screen.queryByRole('region', { name: 'Documentaires TV5MONDEplus' })).toBeNull();
  vi.mocked(useOfficialDocumentaries).mockImplementation(source => source === 'tv5mondeplus' ? [item] : []);
  fireEvent.click(screen.getByRole('button', { name: 'Tout' })); fireEvent.focus(screen.getByRole('button', { name: 'Ouvrir Film documentaire sur TV5MONDEplus' }));
  expect(screen.getByRole('region', { name: 'Contenu sélectionné' })).toHaveTextContent(item.title);
  view.rerender(<ContinuePanel {...props} parentalEnabled unlocked={false} />);
  expect(screen.queryByRole('region', { name: 'Documentaires ImagoTV' })).toBeNull(); expect(vi.mocked(useOfficialDocumentaries).mock.lastCall?.[1]).toBe(false);
  expect(screen.queryByText(item.title)).toBeNull(); expect(screen.queryByRole('region', { name: 'Contenu sélectionné' })).toBeNull();
  view.rerender(<ContinuePanel {...props} playlist={{ ...props.playlist, id: 'new-playlist' }} parentalEnabled unlocked />);
  expect(await screen.findByRole('region', { name: 'Documentaires ImagoTV' })).toBeVisible(); expect(vi.mocked(useOfficialDocumentaries).mock.lastCall?.[2]).toContain('new-playlist');
});
