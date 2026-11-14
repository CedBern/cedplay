import React, { useEffect, useId, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppSettings, StorageManager } from '@/utils/storage';
import { getSettingsChangeLog, getSettingsMigrationStats } from '@/utils/idb';
import { hashPin, isHashedPin, maybeUpgradePin } from '@/utils/pinHash';
import { redactChangeLog } from '@/utils/redact';
import { isValidPin } from '@/utils/parentalControl';
import { toast } from 'sonner';
import { ParentalPinDialog } from '@/components/ParentalPinDialog';
import { WatchSubscriptions } from '@/components/WatchSubscriptions';
import { WATCH_REGIONS, normalizeWatchRegion } from '@/data/watchRegions';
import { getLoadedEpg } from '@/utils/nativePlayer';
import { epgMemoryStats, jsHeap, megabytes } from '@/utils/epgStats';
import { TraktAuthDialog } from '@/components/TraktAuthDialog';
import { LanSyncSection } from '@/components/LanSyncSection';
import { syncTraktHistory, getValidTraktAccessToken } from '@/utils/trakt';
import { useSettingsLayout } from '@/hooks/useSettingsLayout';
import { focusRemote, remoteNeighbor, remoteTargets } from '@/utils/remoteNavigation';

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSettings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  tvMode?: boolean;
}
export function SettingsPanel({ open, onOpenChange, currentSettings, onSettingsChange, tvMode = false }: SettingsPanelProps) {
  const layout = useSettingsLayout(open, tvMode);
  const collapsible = layout.mobile || tvMode;
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const sectionPrefix = useId();
  const keepFieldVisible = () => {
    const body = bodyRef.current;
    const active = document.activeElement;
    if (!body || !(active instanceof HTMLElement) || !body.contains(active)) return;
    const bounds = body.getBoundingClientRect();
    const fieldBounds = active.getBoundingClientRect();
    if (fieldBounds.bottom > bounds.bottom - 12) body.scrollTop += fieldBounds.bottom - bounds.bottom + 12;
    else if (fieldBounds.top < bounds.top + 12) body.scrollTop -= bounds.top + 12 - fieldBounds.top;
  };
  useEffect(() => { setExpandedSection(null); }, [open]);
  useEffect(() => {
    if (!open || !layout.mobile) return;
    const frame = requestAnimationFrame(keepFieldVisible);
    return () => cancelAnimationFrame(frame);
  }, [open, layout.mobile, layout.height, layout.top]);
  const [draft, setDraft] = useState(currentSettings);
  const [saving, setSaving] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [details, setDetails] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [parentalEditAuthorized, setParentalEditAuthorized] = useState(false);
  const [traktDialogOpen, setTraktDialogOpen] = useState(false);
  const [traktSyncing, setTraktSyncing] = useState(false);
  const watchRegion = normalizeWatchRegion(draft.watchRegion);
  useEffect(() => { if (open) setParentalEditAuthorized(false); else setPinOpen(false); }, [open]);
  // Code PIN haché : le champ démarre vide, « vide = code inchangé ».
  useEffect(() => { if (open) setDraft(isHashedPin(currentSettings.parentalPin) ? { ...currentSettings, parentalPin: '' } : currentSettings); }, [open, currentSettings]);
  useEffect(() => {
    let cancelled = false;
    if (open && diagnostics) {
      Promise.all([getSettingsChangeLog(), getSettingsMigrationStats()])
        // Masquage à l'affichage aussi : couvre les entrées écrites avant l'introduction du masquage.
        .then(([changes, migrations]) => { if (!cancelled) setDetails(JSON.stringify({ changes: redactChangeLog(changes), migrations }, null, 2)); })
        .catch(() => { if (!cancelled) setDetails('Diagnostics indisponibles.'); });
    }
    return () => { cancelled = true; };
  }, [open, diagnostics]);
  const save = async () => {
    const pinDraft = draft.parentalPin ?? '';
    // Champ rempli : la saisie doit valoir 4 à 8 chiffres (ou être une empreinte résiduelle),
    // vérifiée avant la porte de déverrouillage — une saisie invalide ne doit jamais être
    // enregistrée, même quand un ancien code exploitable existe déjà.
    if (pinDraft !== '' && !isHashedPin(pinDraft) && !isValidPin(pinDraft)) {
      toast.error('Le code PIN doit contenir de 4 à 8 chiffres.');
      return;
    }
    // Champ vide = code inchangé (l'empreinte stockée est conservée) ; sans code exploitable
    // déjà stocké, activer la protection exige d'en saisir un.
    if (pinDraft === '' && draft.parentalControlEnabled &&
      !isHashedPin(currentSettings.parentalPin) && !isValidPin(currentSettings.parentalPin ?? '')) {
      toast.error('Saisis un code PIN de 4 à 8 chiffres pour activer le contrôle parental.');
      return;
    }
    if (currentSettings.parentalControlEnabled && !parentalEditAuthorized &&
      ((pinDraft !== '' && pinDraft !== currentSettings.parentalPin) || !draft.parentalControlEnabled)) {
      setPinOpen(true);
      return;
    }
    setSaving(true);
    try {
      // Le code n'est stocké qu'haché : un nouveau code est haché ici, un champ vide ne réécrit pas l'empreinte.
      const { parentalPin, ...rest } = draft;
      const draftToSave: Partial<AppSettings> = parentalPin
        ? { ...draft, parentalPin: isHashedPin(parentalPin) ? parentalPin : await hashPin(parentalPin) }
        : rest;
      onSettingsChange(await StorageManager.saveSettings(draftToSave));
      onOpenChange(false);
      toast.success('Paramètres enregistrés');
    } catch { toast.error('Impossible d’enregistrer les paramètres'); }
    finally { setSaving(false); }
  };
  type ToggleKey = 'autoplay' | 'muteOnStart' | 'autoLoadLastPlaylist' | 'startOnLastChannel' |'autoReconnect' | 'autoNextEpisode' | 'keyboardNavigation' | 'compactModeDefault' | 'virtualizationEnabledDefault' | 'telemetryPersistence';
  const toggle = (key: ToggleKey, label: string, hint?: string, remoteStart?: boolean) => <label key={key} className="flex min-h-12 cursor-pointer items-center justify-between gap-4 py-2 px-2 -mx-2 rounded-xl transition-colors hover:bg-neutral-900/40 has-[:focus-visible]:bg-neutral-900/70 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-primary/60">
    <span className="min-w-0">
      <span className="block text-sm text-foreground">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </span>
    <input
      type="checkbox"
      className="h-5 w-5 shrink-0 accent-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      checked={draft[key] ?? false}
      {...(remoteStart && !collapsible ? { 'data-remote-start': true } : {})}
      onChange={e => setDraft({ ...draft, [key]: e.target.checked })}
    />
  </label>;
  const field = 'block w-full mt-1.5 min-h-11 rounded-xl border border-neutral-800 bg-background px-3 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary';
  const section = (title: string, children: React.ReactNode) => {
    const id = `${sectionPrefix}-${title.replace(/[^a-z0-9]/gi, '-')}`;
    const expanded = !collapsible || expandedSection === title;
    return <section className="rounded-2xl border border-neutral-900 bg-card px-4 py-2">
      <h3 className={collapsible ? '' : 'pt-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'}>
        {collapsible ? <button
          type="button"
          className="settings-section-trigger flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
          aria-expanded={expanded}
          aria-controls={id}
          {...(title === 'Lecture' ? { 'data-remote-start': true } : {})}
          onClick={() => setExpandedSection(expanded ? null : title)}
        >{title}<span aria-hidden="true" className="text-lg text-muted-foreground">{expanded ? '−' : '+'}</span></button> : title}
      </h3>
      <div id={id} hidden={!expanded} className="divide-y divide-neutral-900">{children}</div>
    </section>;
  };
  const check = (checked: boolean, onChange: (value: boolean) => void, label: string, hint?: string) => <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 py-2 px-2 -mx-2 rounded-xl transition-colors hover:bg-neutral-900/40 has-[:focus-visible]:bg-neutral-900/70 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-primary/60">
    <span className="min-w-0">
      <span className="block text-sm text-foreground">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </span>
    <input
      type="checkbox"
      className="h-5 w-5 shrink-0 accent-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
    />
  </label>;
  const footer = <div data-settings-footer className={layout.mobile ? 'settings-footer flex shrink-0 justify-end gap-2 border-t border-neutral-900 bg-background pt-3' : 'sticky -bottom-6 -mx-6 flex justify-end gap-2 border-t border-neutral-900 bg-background px-6 py-3'}>
    <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
    <Button disabled={saving} onClick={save}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Button>
  </div>;
  return <><Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      ref={dialogRef}
      data-remote-self={tvMode ? '' : undefined}
      onKeyDown={event => {
        if (!tvMode || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !bodyRef.current) return;
        const controls = remoteTargets(bodyRef.current).filter(control => !control.closest('[data-settings-footer]'));
        const inFooter = active.closest('[data-settings-footer]');
        if (!controls.includes(active) && !inFooter) return;
        // Le pied fixe ne doit pas prendre la place d'une option située plus bas dans le formulaire.
        const next = inFooter
          ? event.key === 'ArrowUp' ? controls.at(-1) : undefined
          : remoteNeighbor(active, controls, event.key) ?? (event.key === 'ArrowDown' ? dialogRef.current?.querySelector<HTMLElement>('[data-settings-footer] button:not(:disabled)') : undefined);
        event.preventDefault();
        event.stopPropagation();
        if (next) focusRemote(next);
      }}
      onEscapeKeyDown={event => {
        if (tvMode && document.activeElement?.matches('input[data-remote-input]:not([readonly])')) event.preventDefault();
      }}
      onOpenAutoFocus={e => {
        e.preventDefault();
        const content = layout.mobile ? bodyRef.current : dialogRef.current;
        if (content) content.scrollTop = 0;
        const first = content?.querySelector<HTMLElement>('[data-remote-start]');
        first?.focus({ preventScroll: true });
      }}
      className={layout.mobile ? 'settings-dialog max-w-xl rounded-[20px]' : 'max-h-[90dvh] max-w-xl overflow-y-auto rounded-[20px]'}
      data-settings-mobile={layout.mobile ? '' : undefined}
      style={layout.mobile ? { '--settings-viewport-height': `${layout.height}px`, '--settings-viewport-top': `${layout.top}px` } as React.CSSProperties : undefined}
    >
      <DialogHeader className={layout.mobile ? 'settings-header' : undefined}><DialogTitle>Réglages</DialogTitle>
        <DialogDescription>Préférences enregistrées sur cet appareil.</DialogDescription>
      </DialogHeader>
      <div ref={bodyRef} className={layout.mobile ? 'settings-body space-y-3' : 'space-y-3'} onFocusCapture={layout.mobile ? keepFieldVisible : undefined}>
        {section('Lecture', <>
          {toggle('autoplay', 'Lire automatiquement la chaîne sélectionnée', undefined, true)}
          {toggle('muteOnStart', 'Démarrer sans son')}
          {toggle('autoReconnect', 'Relancer la lecture après une coupure réseau')}
          {toggle('autoNextEpisode', 'Enchaîner automatiquement l’épisode suivant (VOD)')}
          <label className="block py-3 px-2 -mx-2 rounded-xl transition-colors hover:bg-neutral-900/40 has-[:focus-visible]:bg-neutral-900/70 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-primary/60">
            <span className="flex justify-between text-sm text-foreground">Volume de départ <span className="font-mono text-muted-foreground">{Math.round(draft.volume * 100)} %</span></span>
            <input
              aria-label="Volume de départ"
              className="mt-2 block w-full accent-primary rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={draft.volume}
              onChange={e => setDraft({ ...draft, volume: Number(e.target.value) })}
            />
          </label>
        </>)}

        {section('Listes et guide TV', <>
          {toggle('autoLoadLastPlaylist', 'Reprendre la dernière liste au démarrage')}
          {toggle('startOnLastChannel', 'Démarrer sur la dernière chaîne regardée', 'La chaîne se relance dès l’ouverture de l’application.')}
          <div className="py-3">
            <span className="block text-sm text-foreground">Actualiser la liste automatiquement</span>
            <span className="block text-xs text-muted-foreground">Listes M3U importées par adresse et connexions Xtream, quand aucune vidéo n’est en cours. Favoris et variantes sont conservés. Le guide TV se met déjà à jour tout seul.</span>
            <div role="group" aria-label="Actualiser la liste automatiquement" className="mt-2 flex flex-wrap gap-2">
              {([[0, 'Jamais'], [6, '6 h'], [12, '12 h'], [24, '24 h'], [72, '3 jours']] as const).map(([value, label]) => <Button
                key={value}
                type="button"
                size="sm"
                variant={(draft.playlistRefreshHours ?? 24) === value ? 'default' : 'outline'}
                aria-pressed={(draft.playlistRefreshHours ?? 24) === value}
                className="min-h-10 px-4"
                onClick={() => setDraft({ ...draft, playlistRefreshHours: value })}
              >{label}</Button>)}
            </div>
          </div>
          {toggle('compactModeDefault', 'Liste compacte par défaut')}
          {toggle('virtualizationEnabledDefault', 'Optimiser les grandes listes', 'Recommandé au-delà de quelques centaines de chaînes.')}
          <label className="block py-3">
            <span className="text-sm text-foreground">Adresse du guide des programmes (XMLTV)</span>
            <Input remoteActivation={tvMode} className={field} type="url" placeholder="https://…/guide.xml (facultatif)" value={draft.epgUrl ?? ''} onChange={e => setDraft({ ...draft, epgUrl: e.target.value })} />
            <span className="mt-1 block text-xs text-muted-foreground">Utilisée pour les listes sans compte Xtream. Le guide Xtream est détecté automatiquement.</span>
          </label>
        </>)}

        {section('Films et séries', <>
          <label className="block py-3">
            <span className="text-sm text-foreground">Clé ou jeton TMDB (fiches films enrichies)</span>
            <Input remoteActivation={tvMode} className={field} type="text" placeholder="Clé API v3 ou API Read Access Token (facultatif)" value={draft.tmdbApiKey ?? ''} onChange={e => setDraft({ ...draft, tmdbApiKey: e.target.value })} />
            <span className="mt-1 block text-xs text-muted-foreground">Compte gratuit sur themoviedb.org › Paramètres › API. Clé courte ou long jeton de lecture acceptés. Synopsis, casting, notes et films similaires ; les sous-titres utilisent OpenSubtitles.</span>
          </label>
          <div className="py-3">
            <span className="block text-sm text-foreground">Pays des offres légales</span>
            <span className="block text-xs text-muted-foreground">Les catalogues diffèrent d’un pays à l’autre : « où regarder » affiche les plateformes qui diffusent le film dans le pays choisi. Changer de pays remet à zéro la sélection d’abonnements.</span>
            <div role="group" aria-label="Pays des offres légales" className="mt-2 flex flex-wrap gap-2">
              {WATCH_REGIONS.map(region => (
                <Button
                  key={region.code}
                  type="button"
                  size="sm"
                  variant={watchRegion === region.code ? 'default' : 'outline'}
                  aria-pressed={watchRegion === region.code}
                  className="min-h-10 px-3"
                  onClick={() => {
                    // Recliquer le pays déjà choisi ne doit pas effacer les abonnements cochés.
                    if (watchRegion === region.code) return;
                    setDraft({ ...draft, watchRegion: region.code, watchProviderIds: [] });
                  }}
                >
                  {region.label}
                </Button>
              ))}
            </div>
          </div>
          <WatchSubscriptions
            apiKey={draft.tmdbApiKey ?? ''}
            region={watchRegion}
            selected={draft.watchProviderIds ?? []}
            onChange={ids => setDraft({ ...draft, watchProviderIds: ids })}
          />
        </>)}

        {section('Trakt.tv', <>
          {draft.traktToken ? (
            <div className="space-y-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate">Connecté : @{draft.traktUsername || 'utilisateur'}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">Scrobble actif et synchronisation des visionnages.</span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 shrink-0 px-3 text-xs"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      traktToken: '',
                      traktRefreshToken: '',
                      traktUsername: '',
                      traktExpiresAt: 0,
                    });
                    toast.info('Compte Trakt déconnecté.');
                  }}
                >
                  Déconnecter
                </Button>
              </div>

              {check(
                draft.traktScrobble ?? true,
                v => setDraft({ ...draft, traktScrobble: v }),
                'Scrobbler la lecture en direct',
                'Enregistre automatiquement les films et épisodes regardés sur ton compte Trakt.'
              )}

              {check(
                draft.traktSync ?? true,
                v => {
                  setDraft({ ...draft, traktSync: v });
                  if (v && draft.traktToken) {
                    void syncTraktHistory(draft.traktToken, draft.traktClientId)
                      .then(res => { if (res.added > 0) toast.success(`${res.added} visionnage(s) synchronisé(s).`); })
                      .catch(() => {});
                  }
                },
                'Synchroniser l’historique avec « Vu ailleurs »',
                'Alimente les recommandations et les épisodes suivants avec tes visionnages Trakt.'
              )}

              <div className="pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={traktSyncing}
                  className="gap-2"
                  onClick={async () => {
                    setTraktSyncing(true);
                    try {
                      const validToken = await getValidTraktAccessToken(draft, patch => {
                        const next = { ...draft, ...patch };
                        setDraft(next);
                        void StorageManager.saveSettings(next);
                        onSettingsChange(next);
                      });
                      if (!validToken) throw new Error('Aucun jeton Trakt disponible.');
                      const res = await syncTraktHistory(validToken, draft.traktClientId);
                      toast.success(`${res.added} visionnage(s) synchronisé(s) (${res.total} au total).`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Échec de la synchronisation Trakt.');
                    } finally {
                      setTraktSyncing(false);
                    }
                  }}
                >
                  {traktSyncing ? 'Synchronisation…' : 'Synchroniser l’historique maintenant'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-3">
              <div>
                <span className="block text-sm text-foreground">Associer un compte Trakt.tv</span>
                <span className="block text-xs text-muted-foreground">
                  Synchronise tes films et séries vus pour enrichir l’accueil et scrobbler en temps réel depuis le canapé.
                </span>
              </div>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="gap-2"
                onClick={() => setTraktDialogOpen(true)}
              >
                Connecter mon compte Trakt
              </Button>
            </div>
          )}
        </>)}

        {section('Synchronisation locale (TV / Téléphone)', <LanSyncSection fieldClass={field} remoteActivation={tvMode} />)}

        {section('Sous-titres', <>
          {check(draft.subtitlesEnabled ?? true, v => setDraft({ ...draft, subtitlesEnabled: v }), 'Recherche automatique des sous-titres', 'Français d’abord, puis anglais ou espagnol.')}
          {check(draft.subtitleAutoTranslate ?? true, v => setDraft({ ...draft, subtitleAutoTranslate: v }), 'Traduction automatique vers le français si non disponible')}
          <label className="block py-3">
            <span className="text-sm text-foreground">Clé API DeepL (traduction de secours, facultatif)</span>
            <Input remoteActivation={tvMode} className={field} type="text" placeholder="Clé DeepL API Free (facultatif)" value={draft.deeplApiKey ?? ''} onChange={e => setDraft({ ...draft, deeplApiKey: e.target.value })} />
          </label>
          <label className="block py-3">
            <span className="text-sm text-foreground">Clé API OpenSubtitles v3 (facultatif)</span>
            <Input remoteActivation={tvMode} className={field} type="text" placeholder="Clé personnelle OpenSubtitles (facultatif)" value={draft.openSubtitlesApiKey ?? ''} onChange={e => setDraft({ ...draft, openSubtitlesApiKey: e.target.value })} />
          </label>
        </>)}

        {section('Contrôle parental', <>
          {check(draft.parentalControlEnabled ?? false, v => setDraft({ ...draft, parentalControlEnabled: v }), 'Verrouiller les groupes adultes derrière un code')}
          {(draft.parentalControlEnabled ?? false) && (
            <label className="block py-3">
              <span className="text-sm text-foreground">Code PIN (4 à 8 chiffres)</span>
              <Input remoteActivation={tvMode} className={field} type="password" inputMode="numeric" placeholder="••••" value={draft.parentalPin ?? ''} onChange={e => setDraft({ ...draft, parentalPin: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
              <span className="mt-1 block text-xs text-muted-foreground">Nécessaire pour afficher les groupes détectés comme adultes.{isHashedPin(currentSettings.parentalPin) && ' Laisse le champ vide pour conserver le code actuel.'}</span>
            </label>
          )}
        </>)}

        {section('Affichage', <><div className="py-3">
          <span className="block text-sm text-foreground">Interface</span>
          <span className="block text-xs text-muted-foreground">TV : écran en colonnes pensé pour la télécommande. Automatique la choisit sur un téléviseur ou une box Android TV.</span>
          <div role="group" aria-label="Interface" className="mt-2 flex flex-wrap gap-2">
            {([['auto', 'Automatique'], ['tv', 'TV'], ['mobile', 'Mobile']] as const).map(([value, label]) => <Button
              key={value}
              type="button"
              size="sm"
              variant={(draft.interfaceMode ?? 'auto') === value ? 'default' : 'outline'}
              aria-pressed={(draft.interfaceMode ?? 'auto') === value}
              className="min-h-10 px-4"
              onClick={() => setDraft({ ...draft, interfaceMode: value })}
            >{label}</Button>)}
          </div>
        </div>
        <div className="py-3">
          <span className="block text-sm text-foreground">Aperçu vidéo dans la liste des chaînes</span>
          <span className="block text-xs text-muted-foreground">Interface TV : la chaîne surlignée démarre en petit à droite. Automatique après un court instant ; Manuel : seulement via le bouton « Aperçu », à renouveler après chaque changement de chaîne (utile pour les petites box et les abonnements limités en connexions) ; Désactivé n’ouvre aucun flux.</span>
          <div role="group" aria-label="Aperçu vidéo" className="mt-2 flex flex-wrap gap-2">
            {([['auto', 'Automatique'], ['manual', 'Manuel'], ['off', 'Désactivé']] as const).map(([value, label]) => {
              const active = (draft.tvPreviewMode ?? (draft.tvPreview === false ? 'off' : 'auto')) === value;
              return <Button
                key={value}
                type="button"
                size="sm"
                variant={active ? 'default' : 'outline'}
                aria-pressed={active}
                className="min-h-10 px-4"
                onClick={() => setDraft({ ...draft, tvPreviewMode: value, tvPreview: value !== 'off' })}
              >{label}</Button>;
            })}
          </div>
        </div>
        </>)}

        {section('Lecteur Android', <>
          <div className="py-3">
            <span className="block text-sm text-foreground">Mémoire tampon du direct</span>
            <span className="block text-xs text-muted-foreground">Plus grande : moins de coupures sur une connexion instable, mais un démarrage et un zapping un peu plus lents.</span>
            <div role="group" aria-label="Mémoire tampon" className="mt-2 flex flex-wrap gap-2">
              {([['small', 'Petite'], ['normal', 'Normale'], ['large', 'Grande'], ['max', 'Très grande']] as const).map(([value, label]) => {
                const active = (draft.playerBuffer ?? 'normal') === value;
                return <Button key={value} type="button" size="sm" variant={active ? 'default' : 'outline'} aria-pressed={active} className="min-h-10 px-4" onClick={() => setDraft({ ...draft, playerBuffer: value })}>{label}</Button>;
              })}
            </div>
          </div>
          <div className="py-3">
            <span className="block text-sm text-foreground">Décodage vidéo</span>
            <span className="block text-xs text-muted-foreground">Matériel : le plus fluide sur une box. Logiciel : à essayer si l’image saccade, reste noire ou montre des artefacts sur certaines chaînes ; le processeur travaille davantage.</span>
            <div role="group" aria-label="Décodage vidéo" className="mt-2 flex flex-wrap gap-2">
              {([['hardware', 'Matériel'], ['software', 'Logiciel']] as const).map(([value, label]) => {
                const active = (draft.playerDecoder ?? 'hardware') === value;
                return <Button key={value} type="button" size="sm" variant={active ? 'default' : 'outline'} aria-pressed={active} className="min-h-10 px-4" onClick={() => setDraft({ ...draft, playerDecoder: value })}>{label}</Button>;
              })}
            </div>
          </div>
          {check(draft.playerAfr === true, value => setDraft({ ...draft, playerAfr: value }), 'Fréquence d’affichage automatique (AFR)', 'Le téléviseur passe à 50 Hz pour une chaîne en 25 ou 50 images/s, à 60 Hz pour 30 ou 60 : mouvements sans saccades. L’écran peut devenir noir une seconde au changement.')}
          <p className="py-2 text-xs text-muted-foreground">Désentrelacement : sur Android, il est fait par le décodeur de la box quand celui-ci le prend en charge ; le lecteur n’a pas de réglage séparé.</p>
        </>)}

        {section('Avancé', <>
          {toggle('keyboardNavigation', 'Navigation au clavier', 'Flèches, Entrée et chiffres dans la liste et le lecteur.')}
          {toggle('telemetryPersistence', 'Conserver les diagnostics sur cet appareil')}
          <label className="block py-3">
            <span className="text-sm text-foreground">Relais web (proxy CORS)</span>
            <Input remoteActivation={tvMode} className={field} type="url" placeholder="https://mon-relais.example.com (facultatif)" value={draft.proxyUrl ?? ''} onChange={e => setDraft({ ...draft, proxyUrl: e.target.value })} />
            <span className="mt-1 block text-xs text-muted-foreground">Uniquement pour la version web hébergée. Laisse vide pour le relais local de développement.</span>
          </label>
          <div className="py-3">
            <Button variant="outline" size="sm" onClick={() => setDiagnostics(!diagnostics)}>Diagnostics</Button>
            {diagnostics && <div data-testid="settings-diagnostics" className="mt-3 text-xs text-muted-foreground">
              <p>Version: {currentSettings.__version ?? 1}</p>
              {(() => {
                const epg = epgMemoryStats(getLoadedEpg());
                const heap = jsHeap();
                return <p data-testid="epg-memory">Guide en mémoire : {epg.channels.toLocaleString('fr-FR')} chaînes, {epg.programmes.toLocaleString('fr-FR')} programmes, environ {megabytes(epg.estimatedBytes)}{heap ? ` · mémoire de la page : ${megabytes(heap.used)}${heap.limit ? ` sur ${megabytes(heap.limit)}` : ''}` : ''}</p>;
              })()}
              <p>Changements récents</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{details}</pre>
            </div>}
          </div>
        </>)}

        <p className="py-3 text-center text-xs text-muted-foreground">CedPlay · 1.12.64 · Direct, films et séries</p>
        {!layout.mobile && footer}
      </div>
      {layout.mobile && footer}
    </DialogContent>
  </Dialog><ParentalPinDialog open={pinOpen} pin={currentSettings.parentalPin ?? ''} onOpenChange={setPinOpen}
    onUnlock={() => { setParentalEditAuthorized(true); void maybeUpgradePin(currentSettings.parentalPin, p => StorageManager.saveSettings(p)); }} />
  <TraktAuthDialog
    open={traktDialogOpen}
    onOpenChange={setTraktDialogOpen}
    clientId={draft.traktClientId}
    clientSecret={draft.traktClientSecret}
    onSuccess={async ({ tokens, user }) => {
      const updated = {
        ...draft,
        traktToken: tokens.access_token,
        traktRefreshToken: tokens.refresh_token,
        traktExpiresAt: (tokens.created_at + tokens.expires_in) * 1000,
        traktUsername: user.username,
      };
      setDraft(updated);
      await StorageManager.saveSettings(updated);
      onSettingsChange(updated);
    }}
  /></>;
}
