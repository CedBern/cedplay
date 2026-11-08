import { Activity, ChevronRight, CircleDot, CirclePlay, History, ListVideo, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type MoreDestination = 'free' | 'replay' | 'recordings' | 'lists' | 'xtream' | 'health' | 'settings';

const entries: { key: MoreDestination; label: string; hint: string; Icon: LucideIcon }[] = [
  { key: 'free', label: 'Chaînes gratuites', hint: 'Ouvrir la sélection de chaînes officielles, dont le Mexique', Icon: CirclePlay },
  { key: 'xtream', label: 'Connexion Xtream', hint: 'Ajouter un abonnement : serveur, identifiant, mot de passe', Icon: ListVideo },
  { key: 'replay', label: 'Replay et plateformes', hint: 'Revoir les émissions, ouvrir Netflix, france.tv…', Icon: History },
  { key: 'recordings', label: 'Enregistrements', hint: 'Programmés et terminés', Icon: CircleDot },
  { key: 'lists', label: 'Mes listes', hint: 'Ajouter, mettre à jour, exporter', Icon: ListVideo },
  { key: 'health', label: 'Vérifier les chaînes', hint: 'Repérer et masquer les liens hors service', Icon: Activity },
  { key: 'settings', label: 'Réglages', hint: 'Lecture, guide, sous-titres, contrôle parental', Icon: Settings },
];

/** Rubrique « Plus » : tout ce qui ne sert pas à chaque visionnage. */
export function MorePanel({ onOpen }: { onOpen: (destination: MoreDestination) => void }) {
  return <nav aria-label="Autres rubriques" className="mx-auto max-w-2xl">
    <h2 className="mb-3 px-1 text-[26px] font-semibold tracking-tight text-foreground">Plus</h2>
    <ul className="overflow-hidden rounded-[20px] border border-neutral-900 bg-card">
      {entries.map(({ key, label, hint, Icon }, index) => <li key={key} className={index > 0 ? 'border-t border-neutral-900' : ''}>
        <button
          type="button"
          onClick={() => onOpen(key)}
          className="flex min-h-[64px] w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
            <Icon aria-hidden="true" className="h-[18px] w-[18px] stroke-[1.8]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-foreground">{label}</span>
            <span className="block truncate text-[13px] text-muted-foreground">{hint}</span>
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </li>)}
    </ul>
  </nav>;
}
