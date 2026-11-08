import { useEffect, useId, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { getProxyBase } from '@/utils/proxy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import type { PlaylistInfo } from '@/types/channel';
import { fetchXtreamLimits, saveXtreamAccount } from '@/utils/xtreamCatalog';
import { fetchLiveChannels, saveLiveSelection } from '@/utils/xtreamLive';
import { httpGetJson } from '@/utils/userAgent';
import { focusRemote } from '@/utils/remoteNavigation';

interface Category {
  category_id: string;
  category_name: string;
  parent_id?: number;
}

interface XtreamLoginDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  tvMode?: boolean;
  onPlaylistLoaded: (playlist: PlaylistInfo) => void | Promise<void>;
}

interface ErrorDetails {
  message: string;
  hints?: string[];
}

export function XtreamLoginDialog({ onPlaylistLoaded, open: controlledOpen, onOpenChange, hideTrigger = false, tvMode = false }: XtreamLoginDialogProps) {
  const fieldId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const lastCategory = useRef<string | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const [server, setServer] = useState(() => localStorage.getItem('xtream_last_server') || '');
  const [username, setUsername] = useState(() => localStorage.getItem('xtream_last_user') || '');
  const [password, setPassword] = useState(() => localStorage.getItem('xtream_last_pass') || '');
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [lastError, setLastError] = useState<ErrorDetails | null>(null);
  const [streamFormat, setStreamFormat] = useState<'m3u8' | 'ts'>('m3u8');

  useEffect(() => {
    if (open && categories.length && !busy) {
      // Le bouton de connexion vient de disparaître : rejoindre explicitement
      // la nouvelle étape plutôt que laisser le focus repartir dans les champs.
      const first = selectionRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      if (first) focusRemote(first);
    }
  }, [open, categories.length, busy]);

  const fetchCategories = async () => {
    const cleanServer = server.trim().replace(/\/+$/, '');
    const cleanUser = username.trim();
    const cleanPass = password.trim();
    if (!cleanServer || !cleanUser || !cleanPass) {
      toast.error('Veuillez renseigner le serveur, l’identifiant et le mot de passe.');
      return;
    }
    setBusy(true);
    setLastError(null);
    try {
      try {
        localStorage.setItem('xtream_last_server', cleanServer);
        localStorage.setItem('xtream_last_user', cleanUser);
        localStorage.setItem('xtream_last_pass', cleanPass);
      } catch { /* La connexion reste possible si le stockage local est indisponible. */ }
      const isNative = Capacitor.isNativePlatform();

      const url = isNative
        ? `${cleanServer}/player_api.php?username=${encodeURIComponent(cleanUser)}&password=${encodeURIComponent(cleanPass)}&action=get_live_categories`
        : `${getProxyBase()}/xtream/categories?server=${encodeURIComponent(cleanServer)}&username=${encodeURIComponent(cleanUser)}&password=${encodeURIComponent(cleanPass)}`;
      // Android : requête native (httpGetJson) — le webview bloque un fetch direct
      // vers un panneau Xtream qui n'envoie pas d'en-têtes CORS.
      const { ok, status, data } = await httpGetJson(url);
      if (!ok) {
        const errData: { error?: string; detail?: string; hints?: string[] } =
          data && typeof data === 'object' && !Array.isArray(data) ? data as { error?: string; detail?: string; hints?: string[] } : {};
        const errorMsg = errData.error
          ? `${errData.error}${errData.detail ? ` (${errData.detail})` : ''}`
          : `Erreur ${isNative ? 'serveur' : 'proxy/serveur'} (${status})`;
        setLastError({
          message: errorMsg,
          ...(errData.hints ? { hints: errData.hints } : {}),
        });
        throw new Error(errorMsg);
      }
      if (!Array.isArray(data)) {
        throw new Error('Réponse inattendue du fournisseur. Vérifiez vos identifiants.');
      }
      if (!data.length) throw new Error('Aucune catégorie renvoyée par le fournisseur.');
      const available = data.map(c => ({ ...c, category_id: String(c.category_id) })) as Category[];
      setCategories(available);
      // Un compte international doit conserver tous ses pays par défaut.
      setSelectedCats(new Set(available.map(c => c.category_id)));
      toast.success(`${data.length} catégories chargées.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connexion impossible au serveur Xtream.');
    } finally {
      setBusy(false);
    }
  };

  const selectFrenchOnly = () => {
    const frIds = categories.filter(c => /^FR\b|FRANCE/i.test(c.category_name)).map(c => c.category_id);
    setSelectedCats(new Set(frIds));
  };

  const selectAll = () => {
    setSelectedCats(new Set(categories.map(c => c.category_id)));
  };

  const deselectAll = () => {
    setSelectedCats(new Set());
  };

  const toggleCategory = (id: string) => {
    const next = new Set(selectedCats);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCats(next);
  };

  const importChannels = async () => {
    if (selectedCats.size === 0) {
      toast.error('Sélectionnez au moins une catégorie à importer.');
      return;
    }
    setBusy(true);
    setImportProgress(0);
    setLastError(null);
    const cleanServer = server.trim().replace(/\/+$/, '');
    const cleanUser = username.trim();
    const cleanPass = password.trim();

    const selectedList = categories.filter(c => selectedCats.has(c.category_id));
    const account = { server: cleanServer, username: cleanUser, password: cleanPass };

    try {
      // Import parallèle à concurrence limitée (5 catégories à la fois), partagé avec
      // l'actualisation automatique : mêmes chaînes, mêmes identifiants.
      const { channels: allChannels, groups, failed: failedCategories } = await fetchLiveChannels(
        account, selectedList, streamFormat, (done, total) => setImportProgress(Math.round((done / total) * 100)),
      );

      if (allChannels.length === 0) {
        throw new Error('Aucune chaîne récupérée dans les catégories sélectionnées.');
      }

      const playlist: PlaylistInfo = {
        id: uuidv4(),
        name: `Xtream: ${cleanUser}`,
        channels: allChannels,
        groups,
        totalChannelsBeforeDedup: allChannels.length,
      };

      saveXtreamAccount(playlist.id, account);
      saveLiveSelection(playlist.id, { categoryIds: selectedList.map(c => c.category_id), format: streamFormat });
      // Limites du compte (lectures simultanées) pour l'avertissement de la mosaïque,
      // lues en arrière-plan : une réponse lente du panneau ne doit pas retarder la fin
      // de l'import. En échec ou en attente indéfinie, la mosaïque relira la valeur plus tard.
      void fetchXtreamLimits(playlist.id, account).catch(() => {});
      await onPlaylistLoaded(playlist);
      toast.success(`${allChannels.length} chaînes importées avec succès !${failedCategories.length ? ` (${failedCategories.length} catégorie(s) en échec)` : ''}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de l’importation des chaînes.');
    } finally {
      setBusy(false);
      setImportProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">
          Connexion Xtream
        </Button>
      </DialogTrigger>}
      <DialogContent className="max-w-xl bg-neutral-950 text-white border-neutral-800 max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={event => {
          if (tvMode && document.activeElement?.matches('input[data-remote-input]:not([readonly])')) event.preventDefault();
        }}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => {
          if (!hideTrigger) return;
          const target = returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLElement>('header [aria-label="Connexion Xtream"]');
          if (target) { event.preventDefault(); target.focus(); }
        }}
      >
        <DialogHeader>
          <DialogTitle>Connexion Xtream Codes</DialogTitle>
          <DialogDescription className="text-neutral-400">
            {categories.length ? 'Choisis les catégories de ton abonnement. Tous les pays sont sélectionnés au départ.' : 'Connecte-toi à ton fournisseur, puis choisis les catégories à importer.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {categories.length === 0 && <>
          <div className="space-y-1">
            <label htmlFor={`${fieldId}-server`} className="text-xs text-neutral-300">Adresse du serveur (avec port)</label>
            <Input
              remoteActivation={tvMode}
              id={`${fieldId}-server`}
              value={server}
              onChange={e => setServer(e.target.value)}
              placeholder="http://serveur.com:8080"
              disabled={busy}
              className="bg-neutral-900 border-neutral-800 text-white"
            />
          </div>

          <div className="grid gap-3">
            <div className="space-y-1">
              <label htmlFor={`${fieldId}-user`} className="text-xs text-neutral-300">Nom d'utilisateur</label>
              <Input
                remoteActivation={tvMode}
                id={`${fieldId}-user`}
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Identifiant"
                disabled={busy}
                autoComplete="off"
                className="bg-neutral-900 border-neutral-800 text-white"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${fieldId}-password`} className="text-xs text-neutral-300">Mot de passe</label>
              <Input
                remoteActivation={tvMode}
                id={`${fieldId}-password`}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mot de passe"
                disabled={busy}
                autoComplete="off"
                className="bg-neutral-900 border-neutral-800 text-white"
              />
            </div>
          </div>

          <div className="space-y-1.5 rounded-md border border-neutral-800 bg-neutral-900/40 p-2.5">
            <label className="text-xs font-medium text-neutral-200">Format de flux (Protocole de sortie)</label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={streamFormat === 'm3u8' ? 'default' : 'outline'}
                className={streamFormat === 'm3u8' ? 'bg-primary text-primary-foreground text-xs h-8' : 'bg-neutral-900 border-neutral-700 text-neutral-300 text-xs h-8'}
                onClick={() => setStreamFormat('m3u8')}
              >
                HLS (.m3u8)
              </Button>
              <Button
                type="button"
                size="sm"
                variant={streamFormat === 'ts' ? 'default' : 'outline'}
                className={streamFormat === 'ts' ? 'bg-primary text-primary-foreground text-xs h-8' : 'bg-neutral-900 border-neutral-700 text-neutral-300 text-xs h-8'}
                onClick={() => setStreamFormat('ts')}
              >
                MPEG-TS (.ts) — Standard
              </Button>
            </div>
            <p className="text-[11px] text-neutral-400">
              Choisis le format accepté par ton fournisseur. Le lecteur Android prend en charge HLS et MPEG-TS ; chaque chaîne conserve le format alternatif en secours.
            </p>
          </div>

          <p className="rounded-md border border-neutral-800 p-3 text-xs text-neutral-400">
            Le nombre de lectures simultanées dépend de ton abonnement. En cas d’échec, vérifie les identifiants, la connexion réseau et les connexions déjà ouvertes.
          </p>
          </>}

          {lastError && (
            <div className="rounded-md border border-rose-900/70 bg-rose-950/40 p-3 text-xs text-rose-200 space-y-2">
              <div className="font-semibold text-rose-400">Erreur : {lastError.message}</div>
              {lastError.hints && lastError.hints.length > 0 && (
                <ul className="list-disc pl-4 space-y-1 text-neutral-300">
                  {lastError.hints.map((hint, idx) => (
                    <li key={idx}>{hint}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {categories.length === 0 ? (
            <Button
              className="w-full bg-blue-600 hover:bg-blue-500"
              disabled={busy || !server.trim() || !username.trim() || !password.trim()}
              onClick={fetchCategories}
            >
              {busy ? 'Connexion en cours…' : 'Se connecter & charger les catégories'}
            </Button>
          ) : (
            <div ref={selectionRef} data-remote-self className="space-y-3 pt-2"
              onKeyDown={event => {
                if (!event.key.startsWith('Arrow')) return;
                const active = document.activeElement as HTMLButtonElement | null;
                const region = active?.closest<HTMLElement>('[data-xtream-region]');
                if (!region) return;
                const controls = Array.from(region.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                const index = controls.indexOf(active!);
                if (index < 0) return;
                event.preventDefault(); event.stopPropagation();
                const root = event.currentTarget;
                const filters = root.querySelector<HTMLButtonElement>('[data-xtream-region="filters"] button:not(:disabled)') ?? undefined;
                const importer = root.querySelector<HTMLButtonElement>('[data-xtream-import]:not(:disabled)') ?? undefined;
                const action = importer ?? root.querySelector<HTMLButtonElement>('[data-xtream-region="actions"] button:not(:disabled)') ?? undefined;
                let next: HTMLButtonElement | undefined;
                if (region.dataset.xtreamRegion === 'categories') {
                  // Sortir immédiatement de la liste, même au milieu de 289 lignes.
                  if (event.key === 'ArrowRight') next = action;
                  else if (event.key === 'ArrowLeft') next = filters;
                  else if (event.key === 'ArrowUp') next = controls[index - 1] ?? filters;
                  else if (event.key === 'ArrowDown') next = controls[index + 1] ?? action;
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  next = controls[index + (event.key === 'ArrowLeft' ? -1 : 1)];
                } else if ((region.dataset.xtreamRegion === 'filters' && event.key === 'ArrowDown') ||
                  (region.dataset.xtreamRegion === 'actions' && event.key === 'ArrowUp')) {
                  const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]:not(:disabled)'));
                  next = rows.find(row => row.dataset.categoryId === lastCategory.current) ?? rows[0];
                }
                if (next) focusRemote(next);
              }}>
              <p className="text-xs text-neutral-400">Dans la liste : ↑ ↓ parcourir · → Importer · OK cocher ou décocher</p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-neutral-200">
                  {categories.length} catégories trouvées ({selectedCats.size} sélectionnée(s))
                </span>
                <div data-xtream-region="filters" className="flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" onClick={selectAll} disabled={busy} className="min-h-10 text-xs">
                    Tout
                  </Button>
                  <Button variant="ghost" size="sm" onClick={selectFrenchOnly} disabled={busy} className="min-h-10 text-xs">
                    France uniquement
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll} disabled={busy} className="min-h-10 text-xs">
                    Aucun
                  </Button>
                </div>
              </div>

              <div data-xtream-region="categories" role="group" aria-label="Catégories à importer" className="dark-surface max-h-[35vh] overflow-y-auto border border-neutral-800 rounded-md p-2 bg-black">
                <div className="space-y-2">
                  {categories.map(cat => {
                    const checked = selectedCats.has(cat.category_id);
                    return (
                      <button
                        key={cat.category_id}
                        type="button"
                        role="checkbox"
                        data-category-id={cat.category_id}
                        aria-checked={checked}
                        disabled={busy}
                        onClick={() => toggleCategory(cat.category_id)}
                        onFocus={() => { lastCategory.current = cat.category_id; }}
                        onKeyDown={event => {
                          // Radix Checkbox ignore Entrée. Les télécommandes Android
                          // envoient précisément Entrée pour OK : le traiter ici.
                          if (event.key === 'Enter') {
                            event.preventDefault(); event.stopPropagation();
                            if (!event.repeat) toggleCategory(cat.category_id);
                          }
                        }}
                        className="flex w-full min-h-11 items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-neutral-900/60 focus-visible:bg-white focus-visible:text-black focus-visible:outline-none"
                      >
                        <span aria-hidden="true" className="w-5 shrink-0 text-center">{checked ? '✓' : '□'}</span>
                        <span>
                          {cat.category_name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {importProgress !== null && (
                <div className="space-y-1">
                  <Progress value={importProgress} className="h-2" />
                  <p className="text-xs text-neutral-400 text-center">Importation : {importProgress}%</p>
                </div>
              )}

              <div data-xtream-region="actions" className="flex space-x-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setCategories([])}
                  disabled={busy}
                  className="w-1/3 border-neutral-800"
                >
                  Changer de compte
                </Button>
                <Button
                  data-xtream-import
                  className="w-2/3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                  disabled={busy || selectedCats.size === 0}
                  onClick={importChannels}
                >
                  {busy ? 'Importation…' : `Importer les chaînes sélectionnées`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
