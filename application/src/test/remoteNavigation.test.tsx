import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import userEvent from '@testing-library/user-event';

function Navigation({ modal = false, remove = false }: { modal?: boolean; remove?: boolean }) {
  useRemoteNavigation();
  return <>
    <button data-x="0" data-y="0" data-remote-start>Accueil</button>
    {!remove && <button data-x="100" data-y="0">Xtream</button>}
    <button data-x="100" data-y="100" disabled>Interdit</button>
    <input data-x="100" data-y="200" aria-label="Serveur" />
    <button data-x="100" data-y="300">Importer</button>
    {modal && <div role="dialog" data-state="open"><button data-x="0" data-y="400">Fermer</button><button data-x="100" data-y="400">Valider</button></div>}
  </>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function geometry() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const x = Number(this.dataset.x ?? 0), y = Number(this.dataset.y ?? 0);
    return { x, y, left: x, top: y, right: x + 80, bottom: y + 40, width: 80, height: 40, toJSON() {} };
  });
}
it('les flèches initialisent le focus, déplacent entre contrôles et préservent la saisie gauche/droite', () => {
  geometry(); render(<Navigation />);
  fireEvent.keyDown(document.body, { key: 'ArrowDown' });
  expect(screen.getByText('Accueil')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(screen.getByText('Xtream')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByLabelText('Serveur')).toHaveFocus();
  const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(left);
  expect(left.defaultPrevented).toBe(false);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByText('Importer')).toHaveFocus();
});
it('garde le focus dans un dialogue et le rétablit après disparition du contrôle courant', async () => {
  geometry(); const view = render(<Navigation />);
  fireEvent.keyDown(document.body, { key: 'ArrowDown' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  view.rerender(<Navigation remove />);
  await waitFor(() => expect(screen.getByText('Accueil')).toHaveFocus());
  view.rerender(<Navigation modal />);
  screen.getByText('Fermer').focus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(screen.getByText('Valider')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(screen.getByText('Valider')).toHaveFocus();
});
it('respecte les événements déjà traités et transmet le retour sans modifier un champ de saisie', () => {
  geometry(); render(<Navigation />);
  const back = vi.fn((e: Event) => e.preventDefault());
  window.addEventListener('iptv-back', back);
  screen.getByLabelText('Serveur').focus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(back).not.toHaveBeenCalled();
  screen.getByText('Accueil').focus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(back).toHaveBeenCalledTimes(1);
  const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  handled.preventDefault();
  document.activeElement!.dispatchEvent(handled);
  expect(screen.getByText('Accueil')).toHaveFocus();
  window.removeEventListener('iptv-back', back);
});

it('saute les cadres focusables et traverse les composants qui arrêtent la propagation des flèches', () => {
  geometry();
  function Controls() {
    useRemoteNavigation();
    return <div onKeyDown={e => e.stopPropagation()}>
      <button data-x="0" data-y="0">Première ligne</button>
      <div tabIndex={0} data-x="0" data-y="50">Cadre sans action</div>
      <button data-x="0" data-y="100">Deuxième ligne</button>
    </div>;
  }
  render(<Controls />);
  screen.getByText('Première ligne').focus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByText('Deuxième ligne')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(screen.getByText('Première ligne')).toHaveFocus();
});

it('redirige immédiatement un focus natif sur un cadre vers son bouton utilisable', () => {
  geometry();
  function Panel() {
    useRemoteNavigation();
    return <><button data-remote-start>Démarrer</button><div role="tabpanel" tabIndex={0}>
      <button>Lire la chaîne</button>
    </div></>;
  }
  render(<Panel />);
  fireEvent.keyDown(document.body, { key: 'ArrowDown' });
  screen.getByRole('tabpanel').focus();
  expect(screen.getByText('Lire la chaîne')).toHaveFocus();
});

it('les panneaux Radix ne constituent plus un arrêt de navigation clavier ou TV', async () => {
  render(<Tabs defaultValue="direct"><TabsList><TabsTrigger value="direct">Direct</TabsTrigger></TabsList>
    <TabsContent value="direct"><button>Lire</button></TabsContent>
  </Tabs>);
  expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '-1');
  await userEvent.tab();
  expect(screen.getByRole('tab')).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Lire' })).toHaveFocus();
});
