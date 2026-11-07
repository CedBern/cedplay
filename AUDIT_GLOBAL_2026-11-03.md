# Audit global — Lecteur IPTV — 3 novembre 2026

État vérifié : **88/88 tests** Vitest, TypeScript, Vite et Gradle compilent. APK 1.1.1 (code 5) en production sur téléphone.
Rapport concentré sur : complétude fonctionnelle, performance, poids mort. Sans jugement sur les preuves terrain déjà documentées.

---

## Résultats de la mise en œuvre (1.2.0 / code 6) — même soir

| Mesure | Avant | Après |
|---|---|---|
| Bundle JS principal | 1 576 Ko | **578 Ko** (gzip 177 Ko) |
| APK | 11,9 Mo | **6,5 Mo** (−42 %, R8 + shrinkResources) |
| hls.js / recharts / mpegts.js | chargés au démarrage | **chargés à la demande** |
| Import M3U 200k chaînes | bloquait l'interface | **Web Worker** (repli auto) |
| EPG | synthétique et non raccordé | **XMLTV réel** (Xtream `xmltv.php` ou URL personnalisée, gzip, cache 12 h) |
| Doublons de listes | chaque réimport créait une copie | **remplacement par source** + bouton ↻ de rafraîchissement |
| Zapping | absent | web (‹ › + PageUp/PageDown) et natif (flèches dans le lecteur Android) |
| Coupure réseau | flux perdu | **reprise automatique** (réglable) |
| Dépendances | 76 | **58** (−18) |
| Composants `ui/` | 50 | **18** |
| Tests | 88 | **83** (20 fichiers, +9 cas EPG) |

Vérifications finales : TypeScript ✓, 83/83 tests ✓, `assembleRelease` ✓, APK signé v1/v2 avec **le même certificat** que 1.1.1 (mise à jour USB sans réinstaller), **19/19 fichiers web identiques** à `dist/`. APK racine : SHA-256 `9A45F819B3FC672FCA4C5465C24680AA55886FBB244A5AC374105DBA3BBFA9CC`. Preuve : `preuves/apk-1.2.0-signature.txt`.

Restent à valider **sur téléphone** : installation de 1.2.0, EPG réel sur l'abonnement, zapping natif, reprise réseau. Aucun flux d'abonnement contacté pendant cette passe.

---

## 1. Constat santé (ce qui va bien)

- Architecture claire : `components/` (UI), `hooks/useVideoPlayer` (moteur web), `utils/` (persistance, parsers), Android natif (Media3) pour lecteur, mosaïque et VOD.
- Cycle de vie vidéo solide (générations, annulation zapping, reprises limitées à 5, backoff exponentiel).
- Passation web → natif verrouillée (`playbackOwnership`), APK signé avec certificat stable.
- Persistance IndexedDB propre (playlists, favoris, méta, historique), restauration additive atomique, schéma Zod.
- Virtualisation de la liste (200 000 chaînes → 18 lignes DOM), index de recherche Unicode.
- Proxy local durci (routes limitées, User-Agent, pas de relais public).

## 2. Poids mort (à supprimer — aucun impact fonctionnel)

### 2.1 Dépendances inutilisées dans le bundle de l'application

| Paquet | Usage réel | Verdict |
|---|---|---|
| `@supabase/supabase-js` | 0 import | supprimer |
| `@tanstack/react-query` | `QueryClientProvider` monté, **0** `useQuery`/`useMutation` | supprimer |
| `react-hook-form` + `@hookform/resolvers` | seulement `ui/form.tsx` (mort) | supprimer |
| `next-themes` | seulement `ui/sonner.tsx` (theme fictif) | supprimer |
| `vaul`, `cmdk`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `date-fns` | seulement dans des composants `ui/` morts | supprimer |
| `express`, `cors`, `http-proxy-middleware` | seulement `proxy-server.js` **hérité et inutilisé** (l'actif est `proxy-server.mjs`) | supprimer + supprimer `proxy-server.js` |
| `@types/uuid` | uuid ≥ 9 embarque ses types | supprimer |

### 2.2 Composants `ui/` morts (template shadcn initial)

~35 fichiers jamais importés hors du dossier `ui/` : accordion, alert-dialog, aspect-ratio, avatar, breadcrumb, calendar, carousel, command, drawer, form, hover-card, input-otp, menubar, navigation-menu, pagination, popover, radio-group, resizable, select, separator, sheet, sidebar, skeleton, switch, table, textarea, toast, toaster, toggle, toggle-group, use-toast…

**Utilisés** (à garder) : alert, badge, button, card, chart, checkbox, collapsible, context-menu, dialog, dropdown-menu, input, label, progress, scroll-area, slider, tabs, tooltip, sonner.

### 2.3 Code applicatif mort

- `PerformanceDashboard`, `PlaylistAnalyzer`, `ConnectivityTroubleshooter`, `MixedContentHelper`, `ConfigurationManager`, `PerformanceMonitor` : importés **nulle part** dans l'app (seulement dans des tests). À supprimer ou à raccorder volontairement.
- `workers/m3uParserWorker.ts` : jamais instancié (aucun `new Worker`).
- EPG synthétique : `epgGenerator.ts` génère des programmes **faux** ; `ChannelList` attend une prop `epgData` que `IPTVPlayer` ne fournit jamais → l'affichage EPG est mort. Cf. §4.

## 3. Performance (constats mesurés)

1. **Bundle principal : 1,6 Mo** (`dist/assets/index-*.js`). Contient `hls.js` (~500 Ko) et `recharts` (~400 Ko) importés statiquement dès le démarrage, même si on ne regarde que des flux MPEG-TS ou natif. `mpegts.js`, lui, est déjà chargé dynamiquement (bon exemple à généraliser).
   → **Chargement dynamique de `hls.js` et `recharts`** (recharts seulement à l'ouverture des graphiques télémétrie). Gain estimé : démarrage ~2 à 3× plus léger.
2. **Import M3U sur le fil principal** : `PlaylistLoader` appelle `M3UParser.parseFromFileWithProgress` directement. Le worker existe mais n'est pas branché. Sur une liste de 200 000 lignes, l'UI gèle pendant le parse.
   → **Brancher le worker** (ou découper le parse en tranches asynchrones si le worker pose problème sous Capacitor).
3. **Réimport d'une liste = doublon** : chaque import crée un nouvel `id` (uuidv4) ; la restauration déduplique par signature, mais rien ne propose de **rafraîchir** une liste par URL en conservant favoris et identifiants.
4. **APK en `assembleDebug`** (minify désactivé) : taille ~12 Mo. `minifyEnabled true` + R8 + `resourceShrinking` sur une variante release signée avec le même certificat réduirait ~30-40 % et accélérerait l'installation par USB.
5. Détails mineurs : `pushPlayHistory` lit-écrit la méta à chaque zapping (coût faible, acceptable) ; hydratation `ChannelList` relit 7 clés méta (acceptable) ; `StorageManager` garde `localStorage` pour le nom de dernière liste en double de `lastPlaylistId` (à harmoniser un jour).

## 4. Complétude fonctionnelle (ce qui manque pour un vrai lecteur IPTV)

Priorisé par valeur utilisateur :

1. **EPG réel (XMLTV)** — le générateur synthétique actuel est mort. Remplacer par :
   - un parseur XMLTV (`<programme>`, `channel`, fuseaux horaires) dans `utils/epgXmltv.ts`,
   - l'URL `xmltv.php?username=…&password=…` fournie par Xtream (stockée avec les accès Xtream),
   - affichage « en ce moment / ensuite » dans la liste des chaînes (déjà prévu côté UI) + mini-guide par chaîne.
2. **Rafraîchir une liste** : bouton « Mettre à jour » pour les listes importées par URL (Xtream ou M3U) : re-télécharge, fusionne en conservant l'`id`, les favoris et les préférences de variante (déduplication par signature déjà prête).
3. **Zapping complet** : chaîne précédente/suivante dans le lecteur (web et natif), saisie du numéro de chaîne, OSD automatique. Le natif (Media3) peut recevoir les chaînes voisines via le plugin et afficher des flèches.
4. **Reprise automatique après coupure réseau** : `useNetworkStatus` existe ; quand `online` revient, relancer le dernier flux (réglage activable). Le backoff actuel ne couvre pas la perte de réseau en cours de lecture.
5. **Reprise VOD** : déjà mémorisée côté natif ; ajouter « Reprendre à XX:XX » au web (repli HLS/MP4) pour la parité.
6. Confettis à corriger : toasts mi-français/mi-anglais (« Switched to playlist », « Failed to persist playlist ») ; coquille d'indentation sans gravité dans `IPTVPlayer.tsx`.

## 5. Hygiène projet

- **Git absent** à la racine alors qu'un bundle d'historique existe : initialiser un dépôt (le dossier est prêt : `.gitignore` dans `application/`), commits réguliers, tag par version d'APK. Éviterait de nouveaux épisodes « récupération sur G: ».
- Versionner `CURRENT_MISSION.md` à chaque passe (déjà la pratique).
- Scripts `.cmd` : remplacer `npm run build` par `pnpm` (cohérence avec `corepack pnpm` ailleurs) et vérifier `JAVA_HOME` si le JDK bouge.

## 6. Propositions d'ordre de mise en œuvre

**Phase 1 — allègement (sans risque, gains immédiats, aucune fonctionnalité touchée)**
1. Supprimer les ~18 dépendances inutiles + `proxy-server.js` + ~35 composants `ui/` morts + 6 composants de diagnostic morts.
2. Import dynamique de `hls.js` et `recharts`.
3. Reconstruire, relancer typecheck/tests (88 verts attendus), reconstruire l'APK.
→ Démarrage plus rapide, bundle ~3× plus léger, moins de surface de bugs.

**Phase 2 — performance perceptible**
4. Brancher le worker M3U (import 200k chaînes sans gel).
5. Variante release signée + R8 pour l'APK.

**Phase 3 — complétude fonctionnelle**
6. EPG XMLTV réel (supprime l'EPG synthétique mort).
7. Rafraîchissement de liste par URL (anti-doublons).
8. Zapping précédent/suivant + reprise automatique réseau.

**Hors périmètre volontaire** (superflu pour un usage perso) : comptes multi-utilisateurs, cloud de synchronisation, DRM/widevine, enregistrement PVR, Chromecast, thèmes multiples.
