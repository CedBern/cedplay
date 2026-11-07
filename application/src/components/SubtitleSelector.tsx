import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  searchSubtitles,
  downloadSubtitleText,
  getCachedSubtitle,
  saveCachedSubtitle,
  type SubtitleTrack,
  type SubtitleApiKeys,
} from '@/utils/subtitles';
import { translateSrt, shiftCues, parseSrt, cuesToSrt, cuesToVtt } from '@/utils/subtitleTranslator';
import { toast } from 'sonner';

export interface ReadySubtitle {
  url?: string | undefined;
  srtContent?: string | undefined;
  vttContent?: string | undefined;
  label: string;
  isTranslated?: boolean | undefined;
}

interface SubtitleSelectorProps {
  mediaTitle: string;
  year?: string | number | undefined;
  kind: 'movie' | 'series';
  season?: number | undefined;
  episode?: number | undefined;
  mediaKey: string;
  imdbId?: string | undefined;
  autoTranslate?: boolean | undefined;
  apiKeys?: SubtitleApiKeys | undefined;
  /** Langue cible de la traduction automatique (défaut : français). */
  targetLang?: string | undefined;
  onSubtitleReady?: ((sub: ReadySubtitle | null) => void) | undefined;
}

export function SubtitleSelector({
  mediaTitle,
  year,
  kind,
  season,
  episode,
  mediaKey,
  imdbId,
  autoTranslate = true,
  apiKeys,
  targetLang = 'fr',
  onSubtitleReady,
}: SubtitleSelectorProps) {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedTrack, setSelectedTrack] = useState<SubtitleTrack | null>(null);
  const [activeSub, setActiveSub] = useState<ReadySubtitle | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // Ref « dernier état » : l'effet de recherche lit cette valeur au lieu d'une
  // closure, sinon le cache peut écraser une piste fraîchement activée.
  const activeSubRef = useRef<ReadySubtitle | null>(null);
  activeSubRef.current = activeSub;
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setTracks([]); setActiveSub(null); setSelectedTrack(null); setOffsetMs(0);
    activeSubRef.current = null;
    onSubtitleReady?.(null);
    return () => { generation.current++; };
  }, [mediaKey, targetLang, onSubtitleReady]);

  const activateTrack = async (track: SubtitleTrack) => {
    const run = generation.current;
    const raw = await downloadSubtitleText(track.url, apiKeys);
    const cues = parseSrt(raw);
    if (!cues.length) throw new Error('Sous-titre illisible');
    if (run !== generation.current) return;
    const ready: ReadySubtitle = { srtContent: cuesToSrt(cues), vttContent: cuesToVtt(cues), label: track.name, isTranslated: false };
    setSelectedTrack(track); setActiveSub(ready); activeSubRef.current = ready;
    onSubtitleReady?.(ready);
    setOffsetMs(0);
  };

  // Vérifier d'abord le cache local (sous-titre déjà téléchargé ou traduit)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await getCachedSubtitle(mediaKey, targetLang);
      if (cached && !cancelled) {
        const ready: ReadySubtitle = {
          srtContent: cached.srt,
          vttContent: cached.vtt,
          label: 'Français (Enregistré)',
          isTranslated: true,
        };
        setActiveSub(ready);
        onSubtitleReady?.(ready);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaKey, targetLang, onSubtitleReady]);

  // Recherche des sous-titres en ligne
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const results = await searchSubtitles(
          {
            title: mediaTitle,
            year,
            kind,
            season,
            episode,
            imdbId,
          },
          apiKeys
        );

        if (cancelled) return;
        setTracks(results);

        // Sélection automatique intelligente selon vos priorités :
        // 1. Français direct si présent
        // 2. Repli Anglais ou Espagnol mexicain
        const frTrack = results.find((t) => t.lang === 'fr');
        const fallbackTrack = results.find((t) => t.lang === 'en' || t.lang === 'es');

        if (frTrack) {
          setSelectedTrack(frTrack);
          // Si aucun sous-titre n'est encore actif depuis le cache, activer la piste FR
          if (!activeSubRef.current) {
            await activateTrack(frTrack);
          }
        } else if (fallbackTrack) {
          setSelectedTrack(fallbackTrack);
          // Si la traduction automatique est activée et qu'aucun sous-titre français n'existe en cache
          if (autoTranslate && !activeSubRef.current) {
            void handleAutoTranslate(fallbackTrack);
          }
        }
      } catch {
        // Recherche non bloquante
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaTitle, year, kind, season, episode, imdbId, mediaKey]);

  // Traduction automatique d'une piste vers le français
  const handleAutoTranslate = async (track: SubtitleTrack) => {
    if (translating) return;
    const run = generation.current;
    setTranslating(true);
    setProgress(5);
    try {
      const rawText = await downloadSubtitleText(track.url, apiKeys);
      setProgress(25);
      const translated = await translateSrt(rawText, targetLang, {
        deeplApiKey: apiKeys?.deeplApiKey,
        offsetMs,
        onProgress: (pct) => setProgress(Math.min(95, Math.max(25, pct))),
      });
      setProgress(100);

      if (run !== generation.current) return;
      // Sauvegarder seulement une traduction complète pour le média courant.
      await saveCachedSubtitle(mediaKey, targetLang, translated.srt, translated.vtt);

      const ready: ReadySubtitle = {
        srtContent: translated.srt,
        vttContent: translated.vtt,
        label: `Français (Traduit de ${track.langLabel})`,
        isTranslated: true,
      };
      setActiveSub(ready);
      onSubtitleReady?.(ready);
      toast.success(`Sous-titres traduits en français avec succès (${translated.cueCount} répliques).`);
    } catch (e) {
      if (run !== generation.current) return;
      toast.error('La traduction a échoué. Essai du sous-titre d’origine.');
      // Repli sur la VO (anglais ou espagnol)
      await activateTrack(track).catch(() => toast.error('Sous-titre d’origine indisponible.'));
    } finally {
      setTranslating(false);
    }
  };

  // Ajustement du décalage (synchro +/-)
  const adjustSync = (deltaMs: number) => {
    const nextOffset = offsetMs + deltaMs;
    setOffsetMs(nextOffset);

    if (activeSub?.srtContent) {
      const cues = parseSrt(activeSub.srtContent);
      const shifted = shiftCues(cues, deltaMs);
      const newSrt = cuesToSrt(shifted);
      const newVtt = cuesToVtt(shifted);

      const updated: ReadySubtitle = {
        ...activeSub,
        srtContent: newSrt,
        vttContent: newVtt,
      };
      setActiveSub(updated);
      onSubtitleReady?.(updated);
      void saveCachedSubtitle(mediaKey, targetLang, newSrt, newVtt);
      toast.info(`Synchronisation ajustée : ${nextOffset >= 0 ? '+' : ''}${(nextOffset / 1000).toFixed(1)} s`);
    }
  };

  const frAvailable = tracks.some((t) => t.lang === 'fr');
  const enOrEsAvailable = tracks.find((t) => t.lang === 'en' || t.lang === 'es');

  return (
    <div className="bg-white/5 border border-neutral-800 rounded-lg p-3 space-y-3 text-xs text-neutral-300">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">💬</span>
          <span className="font-semibold text-white">Sous-titres</span>
          {activeSub ? (
            <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 bg-emerald-950/40">
              {activeSub.label}
            </Badge>
          ) : loading ? (
            <Badge variant="secondary">Recherche…</Badge>
          ) : (
            <Badge variant="secondary">Aucun</Badge>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-primary hover:underline"
        >
          {expanded ? 'Masquer les options' : 'Choisir / Régler'}
        </button>
      </div>

      {/* Alerte si le français manque mais qu'une conversion est prête */}
      {!frAvailable && enOrEsAvailable && !activeSub?.isTranslated && !loading && (
        <div className="bg-blue-950/40 border border-blue-800/40 rounded p-2 flex items-center justify-between gap-2">
          <div>
            <p className="font-medium text-blue-200">Pas de sous-titres français officiels</p>
            <p className="text-[11px] text-blue-300/80">
              Piste disponible : {enOrEsAvailable.langLabel}. Conversion automatique possible.
            </p>
          </div>
          <Button
            size="sm"
            disabled={translating}
            onClick={() => void handleAutoTranslate(enOrEsAvailable)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0 text-xs"
          >
            {translating ? `Traduction ${progress}%` : '⚡ Traduire en FR'}
          </Button>
        </div>
      )}

      {/* Barre de progression pendant la traduction */}
      {translating && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-neutral-400">
            <span>Traduction en français en cours…</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Panneau déroulant : réglage synchro et choix des pistes */}
      {expanded && (
        <div className="space-y-3 pt-2 border-t border-neutral-800">
          {/* Synchronisation temporelle */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Décalage des sous-titres :</span>
              <span className="font-mono text-white text-[11px]">
                {offsetMs >= 0 ? '+' : ''}{(offsetMs / 1000).toFixed(1)} s
              </span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <Button size="sm" variant="secondary" className="h-8 text-xs px-2" onClick={() => adjustSync(-1000)}>
                -1.0 s
              </Button>
              <Button size="sm" variant="secondary" className="h-8 text-xs px-2" onClick={() => adjustSync(-500)}>
                -0.5 s
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs px-2" onClick={() => adjustSync(-offsetMs)}>
                0 s
              </Button>
              <Button size="sm" variant="secondary" className="h-8 text-xs px-2" onClick={() => adjustSync(500)}>
                +0.5 s
              </Button>
              <Button size="sm" variant="secondary" className="h-8 text-xs px-2" onClick={() => adjustSync(1000)}>
                +1.0 s
              </Button>
            </div>
          </div>

          {/* Liste des pistes trouvées */}
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            <p className="text-[11px] text-neutral-400">Pistes trouvées ({tracks.length}) :</p>
            {tracks.length === 0 && !loading && (
              <p className="text-[11px] text-neutral-500 italic">Aucune piste externe trouvée.</p>
            )}
            {tracks.map((track) => {
              const isSelected = selectedTrack?.id === track.id;
              return (
                <div
                  key={track.id}
                  className={`flex items-center justify-between p-2 rounded border text-[11px] ${
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : 'border-neutral-800 bg-white/5'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <p className="truncate font-medium text-white">{track.name}</p>
                    <p className="text-neutral-400">{track.langLabel}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {track.lang !== 'fr' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-6 text-[10px] px-2"
                        disabled={translating}
                        onClick={() => void handleAutoTranslate(track)}
                      >
                        Traduire en FR
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={isSelected ? 'default' : 'outline'}
                      className="h-6 text-[10px] px-2"
                      onClick={() => { void activateTrack(track).catch(() => toast.error('Sous-titre indisponible.')); }}
                    >
                      Utiliser
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
