import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { ChannelGroup } from '@/types/channel';
import type { ListCustomization } from '@/utils/channelCustomization';

const store = new Map<string, unknown>();
vi.mock('@/utils/idb', () => ({
  getMeta: async (key: string) => store.get(key),
  setMeta: async (key: string, value: unknown) => { store.set(key, structuredClone(value)); },
  getFavoritesFromDB: async () => (store.get('favorites') as string[] | undefined) ?? [],
  saveFavoritesToDB: async (ids: string[]) => { store.set('favorites', [...ids]); },
}));

const { GroupManagerDialog, FavoritesOrganizerDialog } = await import('@/components/ListOrganizers');
const { ChannelEditorDialog } = await import('@/components/ChannelEditor');
const { applyCustomization } = await import('@/utils/channelCustomization');

beforeEach(() => { store.clear(); });
afterEach(() => { cleanup(); });

const ch = (id: string, group: string) => ({ id, name: id.toUpperCase(), url: `http://h.test/${id}`, group });
const source: ChannelGroup[] = [
  { name: 'Sport', channels: [ch('s1', 'Sport'), ch('s2', 'Sport')] },
  { name: 'Info', channels: [ch('i1', 'Info')] },
];

function Harness({ onCustom }: { onCustom: (c: ListCustomization) => void }) {
  const [custom, setCustom] = useState<ListCustomization>({ edits: {} });
  const [hidden, setHidden] = useState<string[]>([]);
  return <GroupManagerDialog
    open
    onOpenChange={() => {}}
    groups={applyCustomization(source, custom)}
    hidden={hidden}
    onChange={setHidden}
    custom={custom}
    onCustomChange={next => { setCustom(next); onCustom(next); }}
  />;
}

it('range les groupes, puis l’ordre et les numéros des chaînes d’un groupe', () => {
  const onCustom = vi.fn();
  render(<Harness onCustom={onCustom} />);
  // Ordre alphabétique au départ : Info puis Sport.
  const names = () => screen.getAllByRole('switch').map(s => s.getAttribute('aria-label'));
  expect(names()).toEqual(['Info', 'Sport']);
  fireEvent.click(screen.getByRole('button', { name: 'Monter le groupe Sport' }));
  expect(names()).toEqual(['Sport', 'Info']);
  expect(onCustom).toHaveBeenLastCalledWith(expect.objectContaining({ groupOrder: ['Sport', 'Info'] }));

  fireEvent.click(screen.getByRole('button', { name: 'Organiser les chaînes de Sport' }));
  fireEvent.click(screen.getByRole('button', { name: 'Monter S2' }));
  expect(onCustom).toHaveBeenLastCalledWith(expect.objectContaining({ channelOrder: { Sport: ['s2', 's1'] } }));
  fireEvent.change(screen.getByLabelText('Numéroter à partir de'), { target: { value: '201' } });
  fireEvent.click(screen.getByRole('button', { name: /Appliquer/ }));
  const rows = within(screen.getByRole('list')).getAllByRole('listitem').map(li => li.textContent);
  expect(rows[0]).toContain('201');
  expect(rows[0]).toContain('S2');
  expect(rows[1]).toContain('202');
});

it('propose le tri des chaînes A–Z puis permet de revenir à la liste', () => {
  const onCustom = vi.fn();
  render(<Harness onCustom={onCustom} />);
  fireEvent.click(screen.getByRole('button', { name: 'Chaînes A–Z' }));
  expect(onCustom).toHaveBeenLastCalledWith(expect.objectContaining({ channelSort: 'name' }));
  expect(screen.getByRole('button', { name: 'Chaînes A–Z' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Ordre de la liste' }));
  expect(onCustom.mock.calls.at(-1)![0]).not.toHaveProperty('channelSort');
});

it('modifie une chaîne, l’ajoute à une nouvelle liste de favoris et la masque', async () => {
  const onSave = vi.fn();
  const onHide = vi.fn();
  render(<ChannelEditorDialog channel={ch('s1', 'Sport')} onOpenChange={() => {}} onSave={onSave} onHide={onHide} />);
  fireEvent.change(screen.getByLabelText('Nom affiché'), { target: { value: 'Sport 1' } });
  fireEvent.change(screen.getByLabelText('Numéro de chaîne'), { target: { value: 'abc' } });
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Numéro de chaîne'), { target: { value: '012' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith({ name: 'Sport 1', chno: '12' });

  fireEvent.change(screen.getByLabelText('Nom de la nouvelle liste de favoris'), { target: { value: 'Matchs' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Créer/ })); });
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Matchs' })).toHaveAttribute('aria-checked', 'true'));
  expect((store.get('favoriteLists') as { name: string; channelIds: string[] }[])[0]).toMatchObject({ name: 'Matchs', channelIds: ['s1'] });

  fireEvent.click(screen.getByRole('button', { name: /Masquer/ }));
  expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
});

it('organise une liste de favoris supplémentaire sans toucher aux numéros des Favoris', async () => {
  store.set('favorites', ['i1']);
  store.set('favoriteLists', [{ id: 'fl-1', name: 'Matchs', channelIds: ['s1', 's2'] }]);
  render(<FavoritesOrganizerDialog open onOpenChange={() => {}} channels={source.flatMap(g => g.channels)} />);
  await screen.findByRole('button', { name: 'Matchs' });
  fireEvent.click(screen.getByRole('button', { name: 'Matchs' }));
  await screen.findByRole('button', { name: 'Monter S2' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Monter S2' })); });
  await waitFor(() => expect((store.get('favoriteLists') as { channelIds: string[] }[])[0]!.channelIds).toEqual(['s2', 's1']));
  expect(store.get('favorites')).toEqual(['i1']);
});
