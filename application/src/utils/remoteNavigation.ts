export type Direction = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
const controls = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role^="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="combobox"], [role="option"], [data-remote-control]';

export function remoteTargets(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(el => {
    if (!el.matches(controls) || el.matches(':disabled, [aria-disabled="true"], [role="tabpanel"]') || el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (el.tabIndex < 0 && !el.matches('[role="tab"], [role^="menuitem"]')) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/** Priorité aux contrôles alignés : les flèches suivent la disposition à l'écran. */
export function remoteNeighbor(current: HTMLElement, targets: HTMLElement[], key: Direction): HTMLElement | undefined {
  const origin = current.getBoundingClientRect();
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1;
  const x = origin.left + origin.width / 2, y = origin.top + origin.height / 2;
  let best: HTMLElement | undefined, score = Infinity;
  for (const el of targets) {
    if (el === current || current.contains(el) || el.contains(current)) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y;
    const forward = (horizontal ? dx : dy) * sign;
    if (forward < 1) continue;
    const aligned = horizontal ? r.bottom > origin.top && r.top < origin.bottom : r.right > origin.left && r.left < origin.right;
    // Un champ large reste la rangée suivante même si son centre est éloigné.
    const gap = horizontal ? Math.max(0, sign > 0 ? r.left - origin.right : origin.left - r.right) : Math.max(0, sign > 0 ? r.top - origin.bottom : origin.top - r.bottom);
    const candidateScore = gap * 10 + Math.abs(horizontal ? dy : dx) * 0.1 + (aligned ? 0 : 100000);
    if (candidateScore < score) { score = candidateScore; best = el; }
  }
  return best;
}

export function focusRemote(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  if (document.documentElement.classList.contains('tv-mode') && el.closest('[data-main-navigation]')) {
    document.documentElement.classList.remove('tv-chrome-hidden');
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    window.scrollTo(0, 0);
    return;
  }

  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
}

/** Sortie déterministe d'un écran TV, sans remonter toutes ses catégories une par une. */
export function focusMainNavigation(from?: Element | null): boolean {
  const panel = from?.closest('[role="tabpanel"]');
  const tab = document.getElementById(panel?.getAttribute('aria-labelledby') ?? '')
    ?? document.querySelector<HTMLElement>('[data-main-navigation] [role="tab"][aria-selected="true"]');
  if (!tab) return false;
  focusRemote(tab);
  return true;
}
