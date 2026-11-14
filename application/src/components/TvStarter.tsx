import type { LucideIcon } from 'lucide-react';

export interface TvStarterAction {
  key: string;
  label: string;
  hint: string;
  Icon: LucideIcon;
  onSelect: () => void;
}

/**
 * TV : écran d'une rubrique qui n'a encore rien à montrer (premier lancement, pas d'abonnement).
 * Dit ce qui manque et propose les étapes en tuiles, au lieu d'un message d'erreur ou d'un vide :
 * la première tuile reçoit la télécommande. Même tuile que la rubrique Plus.
 */
export function TvStarter({ eyebrow, title, text, actions, discover = false }: { eyebrow?: string; title: string; text: string; actions: TvStarterAction[]; /** Dans Découvrir : les tuiles suivent la navigation en rangées de l'accueil. */ discover?: boolean }) {
  return <section data-tv-starter aria-label={title} className="mx-auto max-w-[860px] space-y-5 py-4">
    <div className="space-y-1.5">
      {eyebrow && <p className="text-[12px] font-semibold uppercase tracking-wide text-[#FF8A6E]">{eyebrow}</p>}
      <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">{title}</h2>
      <p className="max-w-[640px] text-[16px] leading-snug text-muted-foreground">{text}</p>
    </div>
    {actions.length > 0 && <ul {...(discover ? { 'data-discover-row': true } : {})} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(actions.length, 3)}, minmax(0, 1fr))` }}>
      {actions.map(({ key, label, hint, Icon, onSelect }, index) => <li key={key}>
        <button
          type="button"
          onClick={onSelect}
          {...(index === 0 ? { 'data-remote-start': true } : {})}
          {...(discover ? { 'data-discover-card': true } : {})}
          className="tv-tile flex h-full min-h-[132px] w-full flex-col items-start gap-3 rounded-2xl border border-neutral-900 bg-neutral-950 p-4 text-left"
        >
          <span className="tv-tile-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
            <Icon aria-hidden="true" className="h-[18px] w-[18px] stroke-[1.8]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] font-medium leading-6">{label}</span>
            <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">{hint}</span>
          </span>
        </button>
      </li>)}
    </ul>}
  </section>;
}
