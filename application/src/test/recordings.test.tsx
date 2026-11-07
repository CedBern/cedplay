import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Recordings } from '@/components/Recordings';
const mocks = vi.hoisted(() => ({ getFolder: vi.fn() }));
vi.mock('@/utils/nativePlayer', () => ({ RecordingsBridge: { getFolder: mocks.getFolder, list: async () => [], listScheduled: async () => [] }, LocalLibraryBridge: {} }));
afterEach(cleanup);
it.each([false, true])('programme uniquement avec un dossier de destination disponible : %s', async hasFolder => {
  mocks.getFolder.mockResolvedValue(hasFolder ? { uri: 'content://fixture', name: 'Dossier' } : null);
  const channel = { id: '1', name: 'Chaîne', url: 'https://example.test/live.ts' };
  render(<Recordings channels={[channel]} initialChannel={channel} />);
  await screen.findByRole('heading', { name: 'Programmer un enregistrement' });
  await screen.findByRole('button', { name: hasFolder ? 'Changer' : 'Choisir un dossier' });
  fireEvent.change(screen.getByLabelText('Début'), { target: { value: '2099-01-01T20:00' } });
  if (hasFolder) expect(screen.getByRole('button', { name: 'Programmer' })).toBeEnabled();
  else expect(screen.getByRole('button', { name: 'Programmer' })).toBeDisabled();
});
