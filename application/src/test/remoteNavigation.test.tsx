import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { Input } from '@/components/ui/input';
import { MainNavigation } from '@/components/MainNavigation';
import { TvLiveScreen } from '@/components/TvLiveScreen';

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

it('ne redirige pas les écrans autogérés (data-remote-self) : leur focus reste en place', () => {
  // Ces écrans posent eux-mêmes le focus à chaque flèche ; la redirection natif→bouton
  // y est inutile et son scan document-entier coûtait une passe par déplacement.
  geometry();
  function Screen() {
    useRemoteNavigation();
    return <div data-remote-self>
      <button data-remote-start>Démarrer</button>
      <div role="tabpanel" tabIndex={0}><button>Action interne</button></div>
    </div>;
  }
  render(<Screen />);
  fireEvent.keyDown(document.body, { key: 'ArrowDown' });
  screen.getByRole('tabpanel').focus();
  expect(screen.getByRole('tabpanel')).toHaveFocus();
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

it('Bas depuis Direct rejoint Rechercher, puis Guide TV et Organiser sans lancer de chaîne', () => {
  geometry();
  const channel = { id: 'test', name: 'Chaîne test', url: 'https://example.test/live' };
  const onPlay = vi.fn(), onSearch = vi.fn(), onGuide = vi.fn(), onOrganize = vi.fn();
  function Direct() {
    useRemoteNavigation();
    return <Tabs value="channels" activationMode="manual">
      <MainNavigation onNavigate={() => {}} />
      <TabsContent value="channels"><TvLiveScreen playlistId="remote-entry-test"
        groups={[{ name: 'Test', channels: [channel] }]} favoriteIds={[]} onPlay={onPlay}
        onSearch={onSearch} onGuide={onGuide} onOrganize={onOrganize} /></TabsContent>
    </Tabs>;
  }
  render(<Direct />);
  screen.getByRole('tab', { name: 'Direct' }).focus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: 'Rechercher' })).toHaveFocus();
  fireEvent.click(document.activeElement!);
  expect(onSearch).toHaveBeenCalledOnce();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: 'Guide TV' })).toHaveFocus();
  fireEvent.click(document.activeElement!);
  expect(onGuide).toHaveBeenCalledOnce();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: 'Organiser' })).toHaveFocus();
  fireEvent.click(document.activeElement!);
  expect(onOrganize).toHaveBeenCalledOnce();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(screen.getByRole('tab', { name: 'Direct' })).toHaveFocus();
  expect(onPlay).not.toHaveBeenCalled();
});

it.each(['continue', 'vod', 'more'])('Bas entre dans le contenu de %s même sans voisin géométrique', section => {
  geometry();
  function Page() {
    useRemoteNavigation();
    return <Tabs value={section} activationMode="manual"><MainNavigation onNavigate={() => {}} />
      <TabsContent value={section}><button>Première action</button></TabsContent></Tabs>;
  }
  render(<Page />);
  screen.getByRole('tab', { selected: true }).focus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: 'Première action' })).toHaveFocus();
});

it('une recherche TV se traverse dans les quatre directions sans saisir ; OK active la saisie, Retour la quitte', () => {
  geometry();
  function Page() {
    useRemoteNavigation();
    return <><button data-x="0" data-y="0">Avant</button>
      <Input remoteActivation aria-label="Recherche TV" data-x="100" data-y="0" />
      <button data-x="200" data-y="0">Après</button>
      <button data-x="100" data-y="100">Résultat</button></>;
  }
  render(<Page />);
  const input = screen.getByRole('textbox', { name: 'Recherche TV' });
  screen.getByText('Avant').focus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute('readonly');
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  expect(screen.getByText('Après')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).not.toHaveAttribute('readonly');
  const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
  input.dispatchEvent(left);
  expect(left.defaultPrevented).toBe(false);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute('readonly');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getByText('Résultat')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getByText('Résultat')).toHaveFocus();
  expect(input).toHaveAttribute('readonly');
});

it('le parcours horizontal des rubriques ne mesure pas les cartes du catalogue', () => {
  geometry();
  function Page() {
    useRemoteNavigation();
    return <Tabs value="continue" activationMode="manual"><MainNavigation tv onNavigate={() => {}} />
      <TabsContent value="continue">{Array.from({ length: 200 }, (_, i) => <button key={i} data-card>{i}</button>)}</TabsContent>
    </Tabs>;
  }
  const { container } = render(<Page />);
  const measured = vi.fn();
  container.querySelectorAll<HTMLElement>('[data-card]').forEach(el => { el.getBoundingClientRect = measured; });
  screen.getByRole('tab', { name: 'Accueil' }).focus();
  for (let i = 0; i < 5; i++) fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Plus' })).toHaveFocus();
  for (let i = 0; i < 5; i++) fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: 'Accueil' })).toHaveFocus();
  expect(measured).not.toHaveBeenCalled();
});
