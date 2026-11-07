import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Info, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { streamingPlatforms, type StreamingPlatform } from '@/data/streamingPlatforms';
import { PlatformLogo } from '@/components/PlatformLogo';

type CategoryFilter = 'all' | 'svod' | 'free' | 'tv' | 'anime' | 'sport';

const filterCategories: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'svod', label: 'SVOD & Cinéma' },
  { key: 'free', label: 'Gratuit & FAST' },
  { key: 'tv', label: 'TV & Replay' },
  { key: 'anime', label: 'Anime' },
  { key: 'sport', label: 'Sport' },
];

/**
 * Accès direct aux plateformes de streaming officielles avec logos vectoriels haute fidélité.
 *
 * Le bouton « Ouvrir » déclenche `openWeb`, qui lance l'application officielle via
 * ACTION_VIEW si elle est installée (deep link), sinon le navigateur par défaut.
 * Aucune lecture embarquée : on reste sur les plateformes légales du diffuseur.
 */
export function StreamingPanel() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');

  const open = (platform: StreamingPlatform) => {
    if (NativePlayerBridge.isAvailable()) {
      void NativePlayerBridge.openWeb(platform.url, platform.name).catch(() =>
        toast.error(`Impossible d'ouvrir ${platform.name}.`)
      );
    } else {
      const win = window.open(platform.url, '_blank', 'noopener');
      if (!win) toast.error(`Impossible d'ouvrir ${platform.name} (bloqueur de fenêtres).`);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return streamingPlatforms.filter(p => {
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.note && p.note.toLowerCase().includes(q)) ||
        (p.badge && p.badge.toLowerCase().includes(q))
      );
    });
  }, [search, selectedCategory]);

  return (
    <section className="space-y-4 text-white">
      {/* En-tête informatif */}
      <Card className="bg-primary/10 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-white flex items-center gap-2">
            <Info aria-hidden="true" className="h-4 w-4 text-primary" />
            Plateformes de streaming officielles
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-neutral-300">
          <p>
            Chaque plateforme s'ouvre dans son <strong>application officielle</strong> si elle est installée sur le téléphone, sinon dans le navigateur.
          </p>
          <p className="text-xs text-neutral-400">
            Accès 100 % légal : la lecture et l'abonnement se font directement sur la plateforme. Aucun flux piraté ni contournement de DRM.
          </p>
        </CardContent>
      </Card>

      {/* Barre de recherche et filtres de catégories */}
      <div className="space-y-2">
        <div className="relative">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher une plateforme (Netflix, Disney+, Crunchyroll, TF1+...)…"
            className="pl-9 bg-neutral-900/80 border-neutral-800 text-white placeholder:text-neutral-500 rounded-lg"
            aria-label="Rechercher une plateforme"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          {filterCategories.map(cat => {
            const count =
              cat.key === 'all'
                ? streamingPlatforms.length
                : streamingPlatforms.filter(p => p.category === cat.key).length;
            const isActive = selectedCategory === cat.key;
            return (
              <Button
                key={cat.key}
                size="sm"
                variant={isActive ? 'default' : 'secondary'}
                onClick={() => setSelectedCategory(cat.key)}
                className={`text-xs h-8 px-2.5 rounded-full transition-colors ${
                  isActive
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                    : 'bg-white/5 hover:bg-white/10 text-neutral-300 border border-neutral-800'
                }`}
              >
                {cat.label}
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white/20' : 'bg-neutral-800 text-neutral-400'}`}>
                  {count}
                </span>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Grille des plateformes */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-neutral-400 space-y-2">
          <p>Aucune plateforme ne correspond à votre recherche « {search} ».</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setSearch('');
              setSelectedCategory('all');
            }}
          >
            Réinitialiser les filtres
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map(platform => (
            <div
              key={platform.id}
              className="group relative rounded-xl border border-neutral-800/80 bg-neutral-900/60 hover:bg-neutral-900 hover:border-neutral-700 p-3 flex flex-col justify-between space-y-3 transition-all duration-200 hover:shadow-lg hover:shadow-black/40"
            >
              <div className="space-y-2.5">
                {/* Logo officiel vectoriel + En-tête */}
                <div className="flex items-start justify-between gap-2">
                  <PlatformLogo
                    platformId={platform.id}
                    name={platform.name}
                    size="lg"
                    className="w-12 h-12 rounded-xl shadow-md transition-transform duration-200 group-hover:scale-105"
                  />
                  {platform.badge && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0.5 border-neutral-700 text-neutral-300 bg-white/5 shrink-0"
                    >
                      {platform.badge}
                    </Badge>
                  )}
                </div>

                {/* Nom & mention */}
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white truncate group-hover:text-primary transition-colors" title={platform.name}>
                    {platform.name}
                  </h3>
                  {platform.note && (
                    <p className="text-[11px] text-neutral-400 leading-tight line-clamp-2 mt-0.5" title={platform.note}>
                      {platform.note}
                    </p>
                  )}
                </div>
              </div>

              {/* Action ouvrir */}
              <Button
                size="sm"
                variant="secondary"
                className="w-full min-h-9 bg-white/10 hover:bg-white/20 text-white border border-neutral-700/60 font-medium text-xs flex items-center justify-center gap-1.5 rounded-lg transition-colors"
                onClick={() => open(platform)}
              >
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                Ouvrir
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Note de pied de page */}
      <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 pt-2">
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-primary shrink-0" />
        <span>Les logos vectoriels intégrés s'affichent instantanément et fonctionnent hors-connexion.</span>
      </div>
    </section>
  );
}
