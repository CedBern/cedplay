import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublicCatalogueDialog } from '@/components/PublicCatalogueDialog';
import { catalogueCheckLabel, loadPublicCatalogue } from '@/utils/publicCatalogue';
import { readFileSync } from 'node:fs';
import { M3UParser } from '@/utils/m3uParser';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';

function CatalogueWithGlobalRemote() {
  useRemoteNavigation();
  return <PublicCatalogueDialog tvMode onOpen={vi.fn(async () => true)} onOpenChange={vi.fn()} />;
}

const sources = Array.from({ length: 289 }, (_, i) => ({
  id: String(i), name: `Canal ${i + 1}`, group: i === 0 ? 'France' : 'Mexique',
  url: `https://media.test/${i}.m3u8`, source: `https://official.test/${i}`,
  checkedAt: '2026-11-07T12:00:00Z', status: 200, segmentStatus: 200, segmentSampleBytes: 32768,
}));
function mockCatalogue(data: unknown = sources) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => data }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('le manifeste seul ne permet jamais d’afficher un extrait média reçu', () => {
  expect(catalogueCheckLabel({ ...sources[0]!, segmentSampleBytes: 0 })).toMatch(/^Échec/);
  expect(catalogueCheckLabel({ ...sources[0]!, segmentStatus: 403 })).toMatch(/^Échec/);
  expect(catalogueCheckLabel(sources[0]!)).toMatch(/^Extrait reçu le/);
  expect(catalogueCheckLabel({ ...sources[0]!, checkedAt: 'invalide' })).toBe('Pas encore contrôlé');
});

it('rejette une source non HTTPS et les identifiants dupliqués', async () => {
  mockCatalogue([{ ...sources[0], source: 'javascript:alert(1)' }]);
  await expect(loadPublicCatalogue(new AbortController().signal)).rejects.toThrow('Catalogue invalide');
  mockCatalogue([sources[0], sources[0]]);
  await expect(loadPublicCatalogue(new AbortController().signal)).rejects.toThrow('Catalogue invalide');
});

it('consulte les sources par pays sans sonder les flux ni modifier la sélection', async () => {
  const fetchMock = mockCatalogue();
  const onOpen = vi.fn(async () => true);
  render(<PublicCatalogueDialog tvMode onOpen={onOpen} onOpenChange={vi.fn()} />);
  await screen.findByRole('link', { name: 'Source de Canal 1' });
  await userEvent.click(screen.getByRole('button', { name: 'France' }));
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0])).not.toContain('.m3u8');
  expect(onOpen).not.toHaveBeenCalled();
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://official.test/0');
});

it('Droite rejoint Ouvrir depuis le milieu de 289 chaînes, Haut retrouve exactement cette source', async () => {
  mockCatalogue();
  render(<CatalogueWithGlobalRemote />);
  const row = await screen.findByRole('link', { name: 'Source de Canal 145' });
  row.focus();
  fireEvent.keyDown(row, { key: 'ArrowRight' });
  const open = screen.getByRole('button', { name: 'Ouvrir / actualiser la sélection' });
  expect(open).toHaveFocus();
  fireEvent.keyDown(open, { key: 'ArrowUp' });
  expect(row).toHaveFocus();
  fireEvent.keyDown(row, { key: 'ArrowLeft' });
  expect(screen.getByRole('button', { name: 'Tous' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(row).toHaveFocus();
});

it('l’ouverture échouée garde le catalogue ouvert et une réussite le ferme', async () => {
  mockCatalogue([]);
  const close = vi.fn();
  const open = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<PublicCatalogueDialog tvMode={false} onOpen={open} onOpenChange={close} />);
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir / actualiser la sélection' }));
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir / actualiser la sélection' }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
});

it('chaque chaîne proposée est exactement celle documentée par le catalogue, sans doublon', () => {
  const entries = JSON.parse(readFileSync('public/chaines-gratuites-sources.json', 'utf8')) as typeof sources;
  const playlist = M3UParser.parseM3U(readFileSync('public/chaines-gratuites.m3u', 'utf8'), 'Catalogue');
  expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
  expect(playlist.channels.map(c => ({ id: c.tvgId, url: c.url, name: c.name, group: c.group })))
    .toEqual(entries.map(e => ({ id: e.id, url: e.url, name: e.name, group: e.group })));
});
