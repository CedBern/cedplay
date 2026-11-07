import { useEffect } from 'react';
import { focusRemote, remoteNeighbor, remoteTargets, type Direction } from '@/utils/remoteNavigation';

/** Activé dès la première flèche ; clavier, télécommande Android TV et navigateur TV. */
export function useRemoteNavigation() {
  useEffect(() => {
    let remote = false;
    let lastFocused: HTMLElement | null = null;
    const scope = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') ?? document;
    const initial = () => {
      const targets = remoteTargets(scope());
      return targets.find(el => el.matches('[data-remote-start]')) ?? targets.find(el => el.matches('[aria-selected="true"][role="tab"]')) ?? targets[0];
    };
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const target = event.target;
      lastFocused = target;
      // Un moteur TV peut encore viser un conteneur : rejoindre son action sans appui supplémentaire.
      if (!remote || !target.matches('[tabindex], [role="tabpanel"]')) return;
      // Écrans qui gèrent eux-mêmes leurs flèches (Direct TV, catalogue) : ils posent le focus
      // sur des boutons, jamais besoin de les rediriger. Sortir avant le scan, qui fait
      // getBoundingClientRect + getComputedStyle sur tout élément focalisable du document
      // à chaque déplacement — le coût dominant d'un appui prolongé.
      if (target.closest('[data-remote-self]')) return;
      const targets = remoteTargets(scope());
      if (targets.includes(target)) return;
      const next = targets.find(el => target.contains(el) && el.matches('[data-channel-play]'))
        ?? targets.find(el => target.contains(el)) ?? initial();
      if (next) focusRemote(next);
    };
    const observer = new MutationObserver(() => {
      if (remote && lastFocused && !lastFocused.isConnected && (document.activeElement === document.body || !document.activeElement)) {
        const next = initial();
        if (next) focusRemote(next);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Activer le mode avant les gestionnaires locaux.
    const activate = (event: KeyboardEvent) => {
      if (!event.key.startsWith('Arrow') || event.ctrlKey || event.altKey || event.metaKey) return;
      remote = true;
      document.documentElement.classList.add('remote-navigation');
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const editing = active?.matches('input, textarea, select, [contenteditable="true"], [role="slider"]');
      if ((event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'GoBack') && !editing && !document.querySelector('[role="dialog"], [role="menu"]')) {
        const back = new Event('iptv-back', { cancelable: true });
        window.dispatchEvent(back);
        if (back.defaultPrevented) event.preventDefault();
        return;
      }
      if (!event.key.startsWith('Arrow')) return;
      // La saisie garde gauche/droite ; haut/bas permet de quitter un champ simple.
      if (editing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || active?.matches('textarea, select, input[type="range"], input[type="number"], [contenteditable="true"], [role="slider"]'))) return;
      if (active?.closest('[role="menu"], [role="listbox"]')) return;
      // Sortie explicite des rubriques : une télécommande doit pouvoir descendre même
      // quand la géométrie (barre fixe, défilement ou écran étroit) n'offre aucun voisin.
      const navigation = active?.closest('[data-main-navigation]');
      if (navigation && event.key === 'ArrowDown') {
        const selected = navigation.querySelector('[role="tab"][aria-selected="true"]');
        const panel = document.getElementById(selected?.getAttribute('aria-controls') ?? '');
        const next = panel?.querySelector<HTMLElement>('[data-remote-entry]') ?? (panel ? remoteTargets(panel)[0] : undefined);
        if (next) {
          event.preventDefault(); event.stopPropagation(); focusRemote(next); return;
        }
      }
      // La première action de l'écran rend Haut à sa rubrique, sans chercher une
      // cible au-dessus d'une barre qui peut elle-même être fixe.
      if (event.key === 'ArrowUp' && active?.hasAttribute('data-remote-entry')) {
        const panel = active.closest('[role="tabpanel"]');
        const tab = document.getElementById(panel?.getAttribute('aria-labelledby') ?? '');
        if (tab?.closest('[data-main-navigation]')) {
          event.preventDefault(); event.stopPropagation(); focusRemote(tab); return;
        }
      }
      const targets = remoteTargets(scope());
      const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
      // Arriver par Haut/Bas ne choisit pas un autre pays ou Favoris à la place de l'onglet actif.
      const candidates = vertical ? targets.filter(el => !el.matches('[role="tab"]') || el.getAttribute('aria-selected') === 'true') : targets;
      const next = active && targets.includes(active) ? remoteNeighbor(active, candidates, event.key as Direction) : initial();
      event.preventDefault();
      event.stopPropagation();
      if (next) {
        const row = next.closest('[data-channel-id]');
        const play = row && !active?.closest('[data-channel-id]') ? row.querySelector<HTMLElement>('[data-channel-play]') : null;
        focusRemote(play ?? next);
      }
    };
    const capture = (event: KeyboardEvent) => {
      if (!event.key.startsWith('Arrow')) return;
      // La liste garde son déplacement par index, y compris hors de la fenêtre virtualisée.
      // Haut sur la première ligne retombera sur le gestionnaire général en phase de remontée.
      const active = document.activeElement;
      // Les écrans qui gèrent eux-mêmes leurs flèches (écran Direct TV) passent en premier ;
      // ce qu'ils laissent passer revient au gestionnaire général en phase de remontée.
      if (active instanceof HTMLElement && active.closest('[data-remote-self]')) return;
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && active instanceof HTMLElement && active.closest('[data-channel-actions]')) return;
      keydown(event);
    };
    window.addEventListener('keydown', activate, true);
    window.addEventListener('keydown', capture, true);
    window.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focus);
    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', activate, true);
      window.removeEventListener('keydown', capture, true);
      window.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focus);
      document.documentElement.classList.remove('remote-navigation');
    };
  }, []);
}
