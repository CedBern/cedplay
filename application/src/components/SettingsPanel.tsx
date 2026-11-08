import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AppSettings, StorageManager } from '@/utils/storage';
import { getSettingsChangeLog, getSettingsMigrationStats } from '@/utils/idb';
import { hashPin, isHashedPin, maybeUpgradePin } from '@/utils/pinHash';
import { redactChangeLog } from '@/utils/redact';
import { isValidPin } from '@/utils/parentalControl';
import { toast } from 'sonner';
import { ParentalPinDialog } from '@/components/ParentalPinDialog';
import { getLoadedEpg } from '@/utils/nativePlayer';
import { epgMemoryStats, jsHeap, megabytes } from '@/utils/epgStats';

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSettings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}
export function SettingsPanel({ open, onOpenChange, currentSettings, onSettingsChange }: SettingsPanelProps) {
  const [draft, setDraft] = useState(currentSettings);
  const [saving, setSaving] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [details, setDetails] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [parentalEditAuthorized, setParentalEditAuthorized] = useState(false);
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
  const toggle = (key: ToggleKey, label: string, hint?: string) => <label key={key} className="flex min-h-12 cursor-pointer items-center justify-between gap-4 py-2">
    <span className="min-w-0">
      <span className="block text-sm text-foreground">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </span>
    <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={draft[key] ?? false} onChange={e => setDraft({ ...draft, [key]: e.target.checked })} />
  </label>;
  const field = 'block w-full mt-1.5 min-h-11 rounded-xl border border-neutral-800 bg-background px-3 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary';
  const section = (title: string, children: React.ReactNode) => <section className="rounded-2xl border border-neutral-900 bg-card px-4 py-2">
    <h3 className="pt-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
    <div className="divide-y divide-neutral-900">{children}</div>
  </section>;
  const check = (checked: boolean, onChange: (value: boolean) => void, label: string, hint?: string) => <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 py-2">
    <span className="min-w-0">
      <span className="block text-sm text-foreground">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </span>
    <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={checked} onChange={e => onChange(e.target.checked)} />
  </label>;
  return <><Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-[20px]">
      <DialogHeader><DialogTitle>Réglages</DialogTitle>
        <DialogDescription>Préférences enregistrées sur cet appareil.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {section('Lecture', <>
          {toggle('autoplay', 'Lire automatiquement la chaîne sélectionnée')}
          {toggle('muteOnStart', 'Démarrer sans son')}
          {toggle('autoReconnect', 'Relancer la lecture après une coupure réseau')}
          {toggle('autoNextEpisode', 'Enchaîner automatiquement l’épisode suivant (VOD)')}
          <label className="block py-3">
            <span className="flex justify-between text-sm text-foreground">Volume de départ <span className="font-mono text-muted-foreground">{Math.round(draft.volume * 100)} %</span></span>
            <input className="mt-2 block w-full accent-primary" type="range" min="0" max="1" step="0.05" value={draft.volume} onChange={e => setDraft({ ...draft, volume: Number(e.target.value) })} />
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
            <input className={field} type="url" placeholder="https://…/guide.xml (facultatif)" value={draft.epgUrl ?? ''} onChange={e => setDraft({ ...draft, epgUrl: e.target.value })} />
            <span className="mt-1 block text-xs text-muted-foreground">Utilisée pour les listes sans compte Xtream. Le guide Xtream est détecté automatiquement.</span>
          </label>
        </>)}

        {section('Films et séries', <label className="block py-3">
          <span className="text-sm text-foreground">Clé ou jeton TMDB (fiches films enrichies)</span>
          <input className={field} type="text" placeholder="Clé API v3 ou API Read Access Token (facultatif)" value={draft.tmdbApiKey ?? ''} onChange={e => setDraft({ ...draft, tmdbApiKey: e.target.value })} />
          <span className="mt-1 block text-xs text-muted-foreground">Compte gratuit sur themoviedb.org › Paramètres › API. Clé courte ou long jeton de lecture acceptés. Synopsis, casting, notes et films similaires ; les sous-titres utilisent OpenSubtitles.</span>
        </label>)}

        {section('Sous-titres', <>
          {check(draft.subtitlesEnabled ?? true, v => setDraft({ ...draft, subtitlesEnabled: v }), 'Recherche automatique des sous-titres', 'Français d’abord, puis anglais ou espagnol.')}
          {check(draft.subtitleAutoTranslate ?? true, v => setDraft({ ...draft, subtitleAutoTranslate: v }), 'Traduction automatique vers le français si non disponible')}
          <label className="block py-3">
            <span className="text-sm text-foreground">Clé API DeepL (traduction de secours, facultatif)</span>
            <input className={field} type="text" placeholder="Clé DeepL API Free (facultatif)" value={draft.deeplApiKey ?? ''} onChange={e => setDraft({ ...draft, deeplApiKey: e.target.value })} />
          </label>
          <label className="block py-3">
            <span className="text-sm text-foreground">Clé API OpenSubtitles v3 (facultatif)</span>
            <input className={field} type="text" placeholder="Clé personnelle OpenSubtitles (facultatif)" value={draft.openSubtitlesApiKey ?? ''} onChange={e => setDraft({ ...draft, openSubtitlesApiKey: e.target.value })} />
          </label>
        </>)}

        {section('Contrôle parental', <>
          {check(draft.parentalControlEnabled ?? false, v => setDraft({ ...draft, parentalControlEnabled: v }), 'Verrouiller les groupes adultes derrière un code')}
          {(draft.parentalControlEnabled ?? false) && (
            <label className="block py-3">
              <span className="text-sm text-foreground">Code PIN (4 à 8 chiffres)</span>
              <input className={field} type="password" inputMode="numeric" placeholder="••••" value={draft.parentalPin ?? ''} onChange={e => setDraft({ ...draft, parentalPin: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
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
            <input className={field} type="url" placeholder="https://mon-relais.example.com (facultatif)" value={draft.proxyUrl ?? ''} onChange={e => setDraft({ ...draft, proxyUrl: e.target.value })} />
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

        <p className="py-3 text-center text-xs text-muted-foreground">CedPlay · 1.12.8 · Direct, films et séries</p>
        <div className="sticky -bottom-6 -mx-6 flex justify-end gap-2 border-t border-neutral-900 bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={saving} onClick={save}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog><ParentalPinDialog open={pinOpen} pin={currentSettings.parentalPin ?? ''} onOpenChange={setPinOpen}
    onUnlock={() => { setParentalEditAuthorized(true); void maybeUpgradePin(currentSettings.parentalPin, p => StorageManager.saveSettings(p)); }} /></>;
}
