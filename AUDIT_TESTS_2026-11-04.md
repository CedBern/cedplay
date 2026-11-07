# Audit des tests — Lecteur IPTV (2026-11-04)

## Périmètre et méthode

Audit de `application/src/test/` : exécution de la suite, évaluation de la pertinence de
chaque fichier de test face au code source (lecture croisée code ↔ tests), identification
des modules non couverts, création de nouveaux tests. Conformité vérifiée : lint ESLint,
typecheck `tsc -p tsconfig.app.json --noEmit`, exécution vitest.

## Résultat global

| | Avant | Après |
|---|---|---|
| Fichiers de test | 43 | 57 |
| Tests | 209 | 315 |
| Statut | 100 % verts | 100 % verts (17 s) |

**Conclusion sur les tests existants : pertinents, fonctionnels, non bidons.** Aucun test
de complaisance détecté : les 43 fichiers testent de vrais comportements (dédup M3U,
verrouillage parental, régressions documentées, navigation EPG…). Le problème était la
**couverture**, pas la qualité.

## Couvertures faibles identifiées (avant audit)

- `m3uParser.ts` (327 l.) : 2 tests seulement pour le cœur de l'application.
- `m3uExport.ts` (99 l.) : **aucun test** (export utilisateur).
- `proxy.ts` / `memoFetch.ts` : **aucun test**.
- `subtitles.ts` : `searchSubtitles` (fonction centrale) jamais exécutée en test.
- `epg.ts` : `getEPGUrl` et le TTL de 12 h non testés.
- `useDebounce` / `useKeyboardNavigation` : **aucun test** (impact UX direct).
- `XtreamLoginDialog.tsx` (424 l.), `SubtitleSelector.tsx` (364 l.), coquille UI de
  `VideoPlayer.tsx` (762 l.), `NetworkNotifications`, `ErrorBoundary` : **0 % direct**.

## 14 nouveaux fichiers de test (106 tests, tous verts)

### Utilitaires et hooks (11 fichiers, 95 tests)
| Fichier | Contenu |
|---|---|
| `m3uParserCoverage.test.ts` (18) | virgules quotées, attributs fallback, durée, sanitisation HTML (limite documentée), détection qualité nom/URL, Ungrouped, `totalChannelsBeforeDedup`, fusion par qualité, `batchSize` invalide, progression 0→100 %, import par URL (HTML rejeté, hostname seul en nom de liste, IDs stables uuidv5) |
| `m3uExport.test.ts` (10) | reconstruction M3U, attributs conditionnels, variantes + annotations `variant-of`/`variant-index`, `onlyFavorites`, `favorite="true"`, sanitisation du nom de fichier, `createObjectURL`/`revokeObjectURL` |
| `epgUrl.test.ts` (13) | `getEPGUrl` (Xtream avec credentials encodés, XMLTV personnalisé, invalides), cache 12 h, cache périmé, changement de source, repli cache périmé, échec sans cache, cache du résultat parsé (round-trip, clés invalidées) |
| `subtitlesSearch.test.ts` (11) | `searchSubtitles` (pas d'IMDb → `[]`, match ambigu refusé, mapping bridge + tri FR, endpoint série `tt:2:5`), `downloadSubtitleText` (clé requise, lien absent, CDN sans clé), cache srt/vtt (round-trip, vtt manquant) |
| `corsProxy.test.ts` (7) | URLs invalides/protocoles interdits, succès (no-referrer), échec catch-all, timeout 15 s via fake timers, signal externe aborté, `convertToHttps`, `testConnectivity` |
| `useKeyboardNavigation.test.tsx` (9) | wrap-around, Enter/Espace, Escape, désactivé/liste vide, modificateurs, ignore input/button/dialog, re-clamp quand la liste rétrécit |
| `useDebounce.test.ts` (4) | valeur initiale, propagation après délai, re-programmation, délai personnalisé |
| `proxy.test.ts` (6) | défaut, origine (chemin strippé), préfixe https, invalide → défaut, réglages indisponibles, limite « host:port » documentée |
| `memoFetch.test.ts` (4) | partage concurrent, clés distinctes, pas de cache après résolution, purge après rejet |
| `networkNotifications.test.tsx` (7) | référence initiale sans toast, perte/rétablissement, cooldown 5 s, transitions dégradée/améliorée, `enabled=false`, rétablissement pendant cooldown perdu (limite documentée) |
| `errorBoundary.test.tsx` (2) | repli d'erreur + message + « Réessayer » fonctionnel, enfants sains |

### Composants lourds (3 fichiers, 11 tests)
| Fichier | Contenu |
|---|---|
| `xtreamLoginDialog.test.tsx` (4) | bouton désactivé sans identifiants complets, chargement catégories + présélection France (`^FR\b|FRANCE`), erreur fournisseur + hints, import complet (playlist `Xtream: user`, `.m3u8` + variante `.ts`, `tvgId`, `saveXtreamAccount`, fermeture) |
| `subtitleSelector.test.tsx` (4) | cache appliqué au montage (« (Enregistré) »), auto-sélection FR (parseSrt/cuesToVtt réels), traduction auto EN→FR (+ `saveCachedSubtitle`), ajustement synchro « +0.5 s » |
| `videoPlayer.test.tsx` (3) | placeholder sans chaîne, zapping numérique (overlay, Enter → `onZapToNumber`, Escape), raccourcis clavier (m/PageUp/PageDown) avec hls.js mocké |

Tous les tests : lint OK, typecheck OK, aucun `.skip/.only`, aucun fichier de production
modifié, mocks isolés par fichier.

## Anomalies détectées dans le code de production (à évaluer séparément)

1. **`@vitest/coverage-v8` manquant** — `pnpm test:coverage` échoue (`MISSING DEPENDENCY`)
   alors que `vitest.config.ts` définit des seuils 80/80/70/80. Fix : `pnpm add -D @vitest/coverage-v8@2.0.5`.
2. **`CORSProxy.fetchWithProxy`** (corsProxy.ts:15) : le throw `HTTP ${status}` est
   inatteignable — rattrapé par le `catch` et remplacé par le message générique ; l'utilisateur
   ne voit jamais le code HTTP réel.
3. **`NetworkNotifications`** : un rétablissement survenant pendant le cooldown de 5 s est
   **définitivement perdu** (le `previousStatus` est écrasé sans notification).
4. **`getProxyBase`** (proxy.ts:14) : une adresse `host:port` sans schéma est interprétée
   comme un protocole non spécial → renvoie la string `'null'` au lieu de préfixer `http://`.
5. **`XtreamLoginDialog`** : deux toasts de validation inatteignables (condition identique au
   `disabled` du bouton) ; et des identifiants remplis d'espaces contournent la validation.
6. **`defaultSettings()`** : tamponné `__version: 8` alors que `migrateIfNeeded` plafonne à 7.
7. **`VideoPlayer`** : timer de zapping numérique (1 500 ms) non nettoyé au démontage
   (no-op bénin en React 18) ; `PageUp` = chaîne *précédente* (mapping contre-intuitif figé par test).

## Reste non couvert (volontairement, pour une prochaine passe)

- `useVideoPlayer` : branche MPEG-TS (`mpegts.js`), récupération HLS différenciée
  (`startLoad`/`recoverMediaError`), backoff exponentiel, circuit breaker complet.
- `ChannelList` (712 l.) : favoris, raccourcis clavier (`/`, `f`, `q`, `r`…), menu contextuel,
  exports par bandeau.
- `ReplayPanel`, `PlaylistManager`, `PlaylistLoader`, `MosaicPicker`, `BackupPanel`,
  `TelemetryGraphs` : logique métier couverte via utils, UI non testée.
- Workers (`epgWorker`, `m3uParserWorker`) et `use-mobile`.

## Commandes

```bash
cd application
./node_modules/.bin/vitest run          # 315 tests, ~17 s
./node_modules/.bin/eslint --quiet ./src
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
```
