import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocalLibraryBridge, type LocalFolder, type LocalMedia } from '@/utils/nativePlayer';
import { formatFileSize, parseLocalFilename } from '@/utils/localLibrary';
import { pickBestMatch, searchTmdb, tmdbImageUrl } from '@/utils/tmdb';
import {
  Captions, Film, FolderPlus, HardDrive, Loader2, Play, RefreshCw, Search, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

interface LocalLibraryProps {
  tmdbApiKey?: string | null;
}

// Cache d'affiches par session + limite de requêtes simultanées vers TMDB (politesse).
const artworkCache = new Map<string, string | null>();
let inFlight = 0;
const pending: (() => void)[] = [];
async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= 4) await new Promise<void>(resolve => pending.push(resolve));
  inFlight += 1;
  try { return await fn(); }
  finally { inFlight -= 1; pending.shift()?.(); }
}

function LocalArtwork({ title, year, apiKey }: { title: string; year: string; apiKey?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setInView(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || !apiKey) return;
    let cancelled = false;
    const key = `${title}|${year}`;
    (async () => {
      if (artworkCache.has(key)) {
        const hit = artworkCache.get(key);
        if (!cancelled && hit) setPoster(hit);
        return;
      }
      try {
        const results = await withLimit(() => searchTmdb(title, year, 'movie', apiKey));
        const best = pickBestMatch(title, results, year);
        const url = best?.posterPath ? tmdbImageUrl(best.posterPath, 'w200') : null;
        artworkCache.set(key, url);
        if (!cancelled && url) setPoster(url);
      } catch {
        artworkCache.set(key, null);
      }
    })();
    return () => { cancelled = true; };
  }, [inView, title, year, apiKey]);

  return (
    <div ref={ref} className="aspect-video w-full bg-neutral-900 flex items-center justify-center overflow-hidden">
      {poster
        ? <img src={poster} alt="" loading="lazy" className="w-full h-full object-cover" />
        : <Film className="h-8 w-8 text-primary" aria-hidden="true" />}
    </div>
  );
}

export function LocalLibrary({ tmdbApiKey }: LocalLibraryProps) {
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  const [files, setFiles] = useState<LocalMedia[]>([]);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [initialized, setInitialized] = useState(false);

  const scan = useCallback(async (uri?: string) => {
    setScanning(true);
    const result = await LocalLibraryBridge.scanLibrary(uri);
    if (result) {
      setFiles(result.files);
      if (result.truncated) toast.info('Bibliothèque très volumineuse : 2000 fichiers affichés (parcours complet quand même possible).');
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await LocalLibraryBridge.listFolders();
      if (cancelled) return;
      setFolders(list);
      if (list.length) await scan();
      if (!cancelled) setInitialized(true);
    })();
    return () => { cancelled = true; };
  }, [scan]);

  const addFolder = async () => {
    const folder = await LocalLibraryBridge.pickFolder();
    if (!folder) return;
    setScanning(true);
    const result = await LocalLibraryBridge.scanLibrary(folder.uri);
    if (result) {
      setFiles(prev => {
        const seen = new Set(prev.map(f => f.uri));
        return [...prev, ...result.files.filter(f => !seen.has(f.uri))];
      });
    }
    setFolders(await LocalLibraryBridge.listFolders());
    setScanning(false);
  };

  const removeFolder = async (uri: string) => {
    if (!(await LocalLibraryBridge.removeFolder(uri))) return;
    setFolders(prev => prev.filter(f => f.uri !== uri));
    await scan();
  };

  const play = async (file: LocalMedia) => {
    const { title } = parseLocalFilename(file.name);
    await LocalLibraryBridge.playLocal(file.uri, title, file.subtitleUri);
  };

  // Recherche débouncée + index des noms en minuscules : le tri « fr » de 2000
  // fichiers ne doit pas tourner à chaque frappe.
  const debouncedSearch = useDebounce(search, 150);
  const nameIndex = useMemo(() => new Map(files.map(f => [f, f.name.toLowerCase()])), [files]);
  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const base = q ? files.filter(f => (nameIndex.get(f) ?? '').includes(q)) : files;
    return [...base].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }, [files, debouncedSearch, nameIndex]);

  if (!initialized && scanning) {
    return <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 className="h-6 w-6 animate-spin mr-2" aria-hidden="true" /> Analyse du stockage…</div>;
  }

  if (folders.length === 0) {
    return (
      <div className="text-center py-20">
        <HardDrive className="h-14 w-14 mx-auto text-muted-foreground mb-4" aria-hidden="true" />
        <h2 className="text-white text-lg font-semibold mb-1">Ta bibliothèque locale</h2>
        <p className="text-neutral-400 max-w-md mx-auto mb-6">
          Connecte une clé USB, un disque dur ou une carte SD et choisis un dossier pour lire tes propres films et vidéos.
        </p>
        <Button onClick={() => { void addFolder(); }} className="gap-2">
          <FolderPlus className="h-4 w-4" aria-hidden="true" /> Ajouter un dossier
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Rechercher un fichier"
            placeholder="Rechercher un fichier…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button onClick={() => { void addFolder(); }} variant="outline" className="border-neutral-800 text-white hover:bg-neutral-900 gap-2">
          <FolderPlus className="h-4 w-4" aria-hidden="true" /> Ajouter
        </Button>
        <Button onClick={() => { void scan(); }} variant="outline" className="border-neutral-800 text-white hover:bg-neutral-900 gap-2" disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} Analyser
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {folders.map(folder => (
          <span key={folder.uri} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900 pl-3 pr-1.5 py-1 text-xs text-neutral-200">
            <HardDrive className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {folder.name}
            <button
              type="button"
              onClick={() => { void removeFolder(folder.uri); }}
              className="rounded-full p-1 hover:bg-red-500/20 hover:text-red-300"
              aria-label={`Retirer ${folder.name}`}
              title={`Retirer ${folder.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <span className="text-xs text-neutral-500">{files.length} fichier{files.length > 1 ? 's' : ''}</span>
      </div>

      {visible.length === 0 ? (
        <p className="text-neutral-400 py-16 text-center">Aucune vidéo trouvée dans ce dossier.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {visible.map(file => {
            const { title, year } = parseLocalFilename(file.name);
            const size = formatFileSize(file.size);
            return (
              <button
                key={file.uri}
                type="button"
                onClick={() => { void play(file); }}
                className="group relative text-left rounded-lg overflow-hidden bg-white/5 border border-neutral-900 hover:border-primary focus-visible:ring-2 ring-primary"
              >
                <LocalArtwork title={title} year={year} apiKey={tmdbApiKey ?? null} />
                <div className="p-2">
                  <p className="text-xs line-clamp-2 min-h-[2rem]">{title}</p>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-neutral-400">
                    {year && <span>{year}</span>}
                    {file.subtitleUri && <span className="inline-flex items-center gap-0.5 text-emerald-300" title="Sous-titres inclus"><Captions className="h-3 w-3" aria-hidden="true" />ST</span>}
                    {size && <span>{size}</span>}
                  </div>
                </div>
                <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/40" aria-hidden="true">
                  <Play className="h-8 w-8 text-white" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
