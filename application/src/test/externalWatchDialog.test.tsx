import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExternalWatchDialog } from '@/components/ExternalWatchDialog';
import { clearExternalWatches, getExternalWatches, saveExternalWatches, type PlayHistoryEntry } from '@/utils/idb';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(async () => { await clearExternalWatches(); });
afterEach(cleanup);

const watch = (name: string, ts: number): PlayHistoryEntry => ({
  channelId: `elsewhere:netflix:movie:${name.toLowerCase()}`, ts, kind: 'vod', mediaKind: 'movie',
  name, status: 'completed', platform: 'netflix',
});

const openDialog = async () => {
  await userEvent.click(screen.getByRole('button', { name: /Vu ailleurs/i }));
  return screen.findByLabelText(/Fichier d'historique/i);
};

describe('ExternalWatchDialog', () => {
  it('importe un CSV Netflix et prévient le parent', async () => {
    const onChanged = vi.fn();
    render(<ExternalWatchDialog watches={[]} onChanged={onChanged} />);
    const input = await openDialog();
    const file = new File(['Title,Date\nInception,4/12/23\nDune,5/1/22'], 'netflix.csv', { type: 'text/csv' });
    await userEvent.upload(input, file);

    await waitFor(async () => expect(await getExternalWatches()).toHaveLength(2));
    const saved = await getExternalWatches();
    expect(saved.map(entry => entry.name).sort()).toEqual(['Dune', 'Inception']);
    expect(saved.every(entry => entry.platform === 'netflix')).toBe(true);
    expect(onChanged).toHaveBeenCalled();
  });

  it('ajoute au contenu existant sans écraser un visionnage plus récent', async () => {
    const recent = Date.now() + 24 * 3600 * 1000;
    await saveExternalWatches([watch('Inception', recent)]);
    render(<ExternalWatchDialog watches={[watch('Inception', recent)]} onChanged={() => {}} />);
    const input = await openDialog();
    await userEvent.upload(input, new File(['Title,Date\nInception,4/12/23'], 'netflix.csv', { type: 'text/csv' }));

    await waitFor(async () => expect(await getExternalWatches()).toHaveLength(1));
    expect((await getExternalWatches())[0].ts).toBe(recent);
  });

  it('efface les visionnages après confirmation', async () => {
    const existing = [watch('Dune', 5_000)];
    await saveExternalWatches(existing);
    const onChanged = vi.fn();
    render(<ExternalWatchDialog watches={existing} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: /Vu ailleurs/i }));

    await userEvent.click(await screen.findByRole('button', { name: /Effacer ces visionnages/i }));
    await userEvent.click(screen.getByRole('button', { name: /Confirmer l'effacement/i }));

    await waitFor(async () => expect(await getExternalWatches()).toHaveLength(0));
    expect(onChanged).toHaveBeenCalled();
  });

  it('refuse un fichier illisible sans rien modifier', async () => {
    await saveExternalWatches([watch('Dune', 5_000)]);
    render(<ExternalWatchDialog watches={[watch('Dune', 5_000)]} onChanged={() => {}} />);
    const input = await openDialog();
    await userEvent.upload(input, new File(['n’importe quoi\nsans colonne'], 'notes.csv', { type: 'text/csv' }));

    await waitFor(() => expect(getExternalWatches).toBeDefined());
    expect(await getExternalWatches()).toHaveLength(1);
  });
});
