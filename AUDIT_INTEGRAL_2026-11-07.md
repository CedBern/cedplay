# Audit intégral — CedPlay 1.11.7 (7 novembre 2026)

> **Mise à jour du 07/11 après-midi — Lot A réalisé et livré (1.11.8 / code 37).** Recommandations VOD optimisées et mesurées : **4 200–7 700 ms → 287 ms (premier calcul) / ~140 ms (recalculs)** sur le cas 20 000 × 50, et plus aucun recalcul pendant une lecture (signature d'historique stable). Réglages paresseux (`IPTVPlayer`) et sous-titres VOD désormais lus depuis IndexedDB (`VodLibrary`) — 4 mocks de tests complétés. Natif : garde `resumed`/PiP dans `reconnectLive`, incidents d'enregistrement signalés « interrompu » (nouveau callback `onRecordInterrupted`, fichier vide supprimé). Médias de vérification sortis de `public/` → **APK 8,71 → 4,57 Mo (−48 %)**, `tmp/` gitignoré. `testTimeout: 15000` + script `pnpm verify`. Vérifié : tsc 0, eslint 0, **vitest 516/516** avec couverture, javac 0, build, cap sync, `assembleRelease` → `CedPlay-1.11.8.apk` à la racine. Modifications **non committées** (décision utilisateur à venir).

> **Mise à jour du 07/11 — Lot B réalisé et livré (1.11.9 / code 38).** Fluidité : (7) **index HashMap des numéros** natif (`rebuildNumberIndex`, `putIfAbsent` garde le premier doublon) — plus aucun scan de 20 000 entrées ni regex par chiffre tapé ; (8) **`zaplist.tsv` lu hors thread UI** (`adoptFullListAsync` + `publishFullList` : exécuteur dédié coupé à `onDestroy`, fenêtre de 300 chaînes conservée pour la première image, index courante/précédente/cible de rafale transposés à la publication, restauration après rotation toujours bloquante) ; (9) **mémoïsation réelle des cartes** : `handleNativeChannelSelect`/`handleRecordRequest` stables dans `IPTVPlayer`, `toggleFavorite` stable par ref des derniers favoris, cartes alimentées par `favoriteSet` (Set mémoïsé) et `debouncedSearch` au lieu du tableau brut et du terme tapé, `downloadPlaylistAdvanced` élargi à `Iterable<string>` ; (10) **grille EPG** : cellules `ProgramCell` mémoïsées (état en props primitives), filtre temporel de la fenêtre visible **avant** `layoutProgram`, `Intl.DateTimeFormat` en cache module (`formatTime`, libellés de jour), `catchupDays` lu une fois par ligne, `toggleReminder` mémoïsé ; (11) **progression podcasts écrite au plus toutes les 5 s** (immédiate à la pause/fin/changement d'épisode et après un seek, `forceSave` sur `seekTo`), panneau relisant la table seulement au changement d'épisode ; libellés et bouton « Depuis le début » VOD partagés le même cache (`cachedProgress`, invalidations inchangées). Vérifié : tsc 0, eslint 0, **vitest 516/516** (85 fichiers), javac 0, build (paquet principal 624,62 kB), cap sync 0, `assembleRelease` 0 → **`CedPlay-1.11.9.apk` (4,57 Mo) à la racine**, « CedPlay · 1.11.9 » dans le bundle, 0 média de vérification. Mesure box attendue : `zap_full_list load_ms` inchangé côté lecture mais **hors du chemin de la première image** ; saisie de numéro O(1). Modifications **non committées**.

> **Mise à jour du 07/11 — Lot C réalisé et livré (1.11.10 / code 39).** Sécurité et hygiène : (12) **secrets masqués dans le journal de réglages** — `redact.ts` (`tmdbApiKey`, `deeplApiKey`, `openSubtitlesApiKey`, `subdlApiKey`, `parentalPin` → `••••`) appliqué à l'écriture du diff (`storage.saveSettings`, seule l'occurrence du changement est journalisée) **et à l'affichage des Diagnostics** (`redactChangeLog`, couvre les entrées écrites avant le masquage) ; l'avertissement de sauvegarde nomme désormais explicitement identifiants Xtream et clés API en clair ; (13) **CSP activée** dans `index.html` (fini le commentaire « disabled for development ») : barrière **partielle** — réductions réelles (`object-src 'none'`, `base-uri 'self'`, pas de frame distante, worker `blob:` du parseur M3U) mais `unsafe-inline`/`unsafe-eval` conservés (script de thème, vieux webviews) et connexion/médias ouvertes : ce n'est pas une garantie « scripts limités au bundle » — le lecteur natif et CapacitorHttp ne passent pas par le webview ; (14) **PIN parental haché** : `pinHash.ts` (SHA-256 salé au format `sha256:<sel>:<empreinte>`, comparaison à durée constante), stockage uniquement haché au prochain enregistrement, **migration silencieuse** d'un ancien PIN en clair après un déverrouillage réussi (`maybeUpgradePin` dans `IPTVPlayer` et `SettingsPanel`), champ réglages « vide = code inchangé » (l'empreinte n'est jamais réécrite par erreur) ; (15) **CapacitorHttp sur les derniers chemins natifs sujets au CORS** : `httpGetJson` (catégories/flux Xtream live **et** connexion du dialog — un panneau sans en-têtes CORS répond enfin sur box), `CORSProxy.fetchWithProxy` natif (import M3U sans User-Agent, HEAD compris, et plus de fausse erreur mixed-content en natif) — EPG, catalogue VOD et podcasts utilisaient déjà le chemin natif ; (16) **signature release** : décision documentée de garder le certificat debug (mises à jour sans réinstaller), avec bascule automatique vers un keystore dédié si `android/keystore.properties` apparaît (hors git, `.gitignore` complété `keystore.properties`/`*.keystore`/`*.jks`) ; pensez à **sauvegarder `~/.android/debug.keystore`** : perdu = plus aucune mise à jour sans désinstallation ; docs : le README de l'application pointait vers `verification.m3u` déplacé → `flux-legaux.m3u`. Tests : +19 (`secretsRedaction`, `pinHash` avec webcrypto, `nativeHttp` branches CapacitorHttp). Vérifié : tsc 0, eslint 0, **vitest 535/535** (88 fichiers), javac 0, build (paquet principal 626,81 kB), cap sync 0, `assembleRelease` 0 (metadata code 39 / 1.11.10) → **`CedPlay-1.11.10.apk` (4 572 820 octets) à la racine**, « CedPlay · 1.11.10 » dans le chunk SettingsPanel, CSP dans les assets embarqués, 0 média de vérification. Modifications **non committées**.

> **Mise à jour du 07/11 — corrections de revue (1.11.11 / code 40).** Trois défauts du lot C trouvés en relecture, corrigés : (1) **empreinte PIN tronquée** — la validation de stockage plafonnait `parentalPin` à 20 caractères (`z.string().max(20)` + repli `slice(0, 20)`), détruisant l'empreinte de 104 caractères à chaque `saveSettings`/rechargement ; plafond porté à 128 (`MAX_PARENTAL_PIN_LENGTH` aux deux endroits de `storage.ts`), test du **cycle complet création → sauvegarde → rechargement → déverrouillage** (`pinLifecycle.test.ts`) qui prouve aussi l'absence de « réparation » au rechargement, et survie d'un ancien code en clair ; (2) **« champ vide = code inchangé » inopérant** — la validation de `SettingsPanel.save()` refusait le champ vide même quand un code exploitable était déjà stocké, bloquant l'enregistrement des autres réglages ; le vide est maintenant admis si le code stocké est haché ou valide (saisie exigée seulement à l'activation sans code stocké), deux tests composant ajoutés (`reviewRegressions`) ; (3) **HEAD réellement émis en GET** — `CapacitorHttp.get()` force GET côté Android malgré `method: 'HEAD'` ; `CORSProxy.fetchWithProxy` passe par `CapacitorHttp.request()` qui respecte la méthode, le mock expose désormais `request` et les tests vérifient `method: 'HEAD'` transmis (et `get` non appelé) ; (4) **nouveau code trop court accepté** (seconde passe de revue) — la validation n'exigeait une saisie valable que faute de code stocké exploitable : après déverrouillage, remplacer le code par « 12 » passait et écrasait l'empreinte par un haché de 2 chiffres ; règle symétrique désormais — **champ rempli = 4 à 8 chiffres obligatoires** (vérifié avant même la porte de déverrouillage), champ vide = code inchangé ; test composant reproduisant le scénario complet (changement de code → déverrouillage → « 12 » → refus, rien enregistré), validé aussi par mutation (le test échoue sans le correctif). Nuances traitées : commentaire CSP du Lot C reformulé (barrière partielle, pas « scripts limités au bundle »), et **README** enrichi d'une section « Signature APK et mises à jour » qui prépare explicitement la bascule de certificat : un APK signé avec un nouveau keystore ne s'installe pas par-dessus une installation signée debug (désinstallation + réinstallation, export de sauvegarde avant). L'APK 1.11.10 défectueux a été retiré de la racine, remplacé par **`CedPlay-1.11.11.apk` (4 579 467 octets)** — reconstruit à version inchangée (1.11.11 / code 40, jamais installée) après le défaut (4), puis encore après deux retouches de dernière minute passées inaperçues : `parentalPin` optionnel géré à la comparaison d'activation (`tsc` : `isValidPin(currentSettings.parentalPin ?? '')`) et deux `catch` vides de `podcastSearch.ts` explicités (premier `eslint` sur `./src` **complet** — préexistants au commit podcasts 29587d4, hors lots ; les vérifications eslint précédentes portaient sur les seuls fichiers touchés). Vérifié : tsc app+node 0, **eslint `./src` 0**, **vitest 544/544** (89 fichiers, +9), build (9,36 s), cap sync 0, `assembleRelease` 0 (metadata code 40 / 1.11.11), « CedPlay · 1.11.11 » et le nouveau message de validation dans le chunk SettingsPanel, CSP dans les assets, 0 média de vérification. Lots A+B+C+corrections **committés** sur `consolidate/v1.11.4` (commit `3fd7cd0`, 44 fichiers, +1 107/−223 ; rapport d'audit en commit séparé).

Audit en lecture seule : aucun fichier de l'application n'a été modifié. Les seules écritures sont ce rapport, les journaux de vérification dans `tmp/` et un script de mesure dans `tmp/audit-bench/`.

---

## 1. Synthèse

L'application est **saine et fonctionnellement riche** : 85 fichiers de tests, 514 tests verts sur 515, TypeScript et ESLint sans erreur, build en 13 s, découpage de code déjà sérieux (HLS 599 kB et MPEG-TS 277 kB hors paquet principal). Les fonctions attendues d'un lecteur IPTV sont là et réellement implémentées : Xtream, M3U, Stalker, catch-up, guide XMLTV, mosaïque 2–8 flux, DVR, PiP, Chromecast, podcasts, bibliothèque USB/SD, fiches TMDb, reprise de lecture.

Les problèmes restants ne sont donc **pas des manques de fonctionnalités**, mais des **points chauds de performance non mesurés jusqu'ici**, quelques **défauts de fiabilité natifs** et une **hygiène de livraison** perfectible.

### Les cinq actions à plus fort rendement

| # | Action | Gain | Effort |
|---|---|---|---|
| 1 | **Recalcul des recommandations VOD** : sortir la normalisation des titres de la double boucle et ne recalculer que sur un vrai changement d'historique | Supprime un gel mesuré de **4 à 8 s** (catalogue 20 000 films) qui se reproduit toutes les 15 s pendant une lecture web et à chaque pause | 0,5 j |
| 2 | **Démarrage natif** : charger la liste complète (`zaplist.tsv`) et le JSON de zapping hors du thread principal | Démarrage lecteur TV plus rapide, risque d'ANR écarté sur box lente | 1 j |
| 3 | **Index des numéros de chaîne** natif, au lieu d'un scan avec regex à chaque chiffre tapé | Saisie de numéro instantanée sur 20 000 chaînes | 0,5 j |
| 4 | **Fiabilité native** : garde de cycle de vie sur `reconnectLive`, erreur d'écriture d'enregistrement remontée à l'utilisateur, surcouches masquées en PiP | Plus de son fantôme en arrière-plan, plus de faux « enregistrement terminé » | 0,5–1 j |
| 5 | **APK** : sortir les 4,1 Mo de médias de test de `public/` | APK ~8,6 Mo → ~4,5 Mo (−48 %), installation et mise à jour USB plus rapides | 0,25 j |

---

## 2. Méthode et mesures reproduites

Environnement : Windows 11, Node 24.18, binaires locaux (`./node_modules/.bin`), aucun appareil ADB connecté, aucun abonnement contacté.

| Vérification | Résultat |
|---|---|
| `tsc -p tsconfig.app.json --noEmit` et `tsc -p tsconfig.node.json --noEmit` | 0 erreur sur les deux configurations |
| `eslint ./src` | 0 erreur, **20 avertissements** (directives `eslint-disable` inutiles, variables non utilisées) |
| `vitest run --coverage` | **514/515** — 1 échec : `vodTvScreen.test.tsx` « Afficher davantage… » **timeout 5 s** sous charge ; relancé seul : **24/24 en 4,0 s** |
| `vite build` | 13,2 s — paquet principal **624,30 kB** (gzip 188,62), HLS **599,03 kB** (gzip 187,04), MPEG-TS **276,65 kB** (gzip 64,08), CSS 73,32 kB (gzip 14,17) |
| `dist/` | 4,6 Mo dont **4,1 Mo de médias de vérification** (`verification-video.mp4` 2,0 Mo, `verification-hls-*.ts` 2,1 Mo) |
| Dernier APK livré | `CedPlay-1.11.7.apk` = 8,6 Mo (les médias ci-dessus représentent ~48 % du poids) |
| Volumétrie | ~20 800 lignes TS/TSX de production, ~7 600 lignes de tests, 8 667 lignes Java |
| Mesure ciblée | simulation fidèle de `recommendForHistory` (fonctions recopiées) : **4,2–7,7 s** pour 20 000 films × 50 visionnages ; **0,37–0,43 s** pour 5 000 × 20 |

Limites : pas de mesure sur la box ni sur le vrai fournisseur ; les chiffres de performance web sont des mesures de chemin chaud, pas des mesures d'image (le protocole rAF existant reste l'arbitre sur appareil).

---

## 3. Performance

### P0 — gel mesuré des recommandations VOD

`src/utils/recommendations.ts:28-44` — la boucle parcourt **tous** les films et, pour chaque couple (film, visionnage), re-normalise le titre du visionnage :

```ts
for (const item of items) {
  const name = normalizeForCompare(normalizeTitle(item.name).title);
  for (const w of watched) {
    ...
    s += titleSimilarity(name, normalizeForCompare(normalizeTitle(w.name as string).title)) * TITLE_BOOST;
```

`normalizeTitle` applique une regex de qualité d'environ 40 alternatives, `normalizeForCompare` fait une normalisation NFD, `titleSimilarity` alloue deux `Set`. Le résultat est mémoïsé (`VodLibrary.tsx:181-184`) mais recalculé à chaque `historyRevision`, et `updateVodHistoryProgress` (`idb.ts:339-356`) émet `vod-history-updated` dès que la position avance de 4 s. Or le lecteur VOD web appelle `save()` toutes les **15 s**, à chaque pause et à la fin (`VodLibrary.tsx:49-68`) : pendant une lecture, le catalogue entier est rescanné toutes les 15 s, et le gel dure plus longtemps que l'intervalle dans le cas 20 000 × 50.

Mesuré sur le code recopié à l'identique : **4,2 / 5,9 / 7,7 s** (20 000 × 50) et **0,37 / 0,39 / 0,43 s** (5 000 × 20).

Correctif :
1. Normaliser les `watched` **une fois** avant la boucle (50 entrées, pas 1 000 000).
2. Précalculer le nom normalisé des films une fois par catalogue (déjà fait pour l'index de recherche).
3. Sortir l'historique de progression de la clé de mémoïsation : ne recalculer que si l'ensemble des œuvres vues change (identifiants + statut), pas à chaque tick de position.
4. Éventuellement, ne calculer que lorsque la rangée « Pour toi » est visible.

Gain attendu : de quelques secondes à quelques millisecondes.

### P1 — démarrage natif sur le thread principal

`NativePlayerActivity.java:369-397` lit et parse `zap-*.json` (chaînes, groupes, programmes, numéros, logos) dans `onCreate`, puis `adoptFullList()` (`:916-958`) relit `zaplist.tsv` ligne par ligne et alloue **quatre listes de la taille du catalogue** avant `buildUI()`. Sur 20 000 chaînes, cela représente ~80 000 chaînes de caractères allouées et plusieurs dizaines de millisecondes à plusieurs centaines sur une box Amlogic ; le log `zap_full_list … load_ms=` existe déjà et permettra de trancher.

Correctif : charger les deux fichiers dans un executor et publier les listes par `Handler` ; garder la fenêtre de 300 chaînes immédiatement disponible pour afficher la première image sans attendre. Vérifier ensuite `zap_full_list load_ms` et le délai d'apparition de l'image.

### P1 — saisie de numéro de chaîne : scan + regex par chiffre

`NativePlayerActivity.java:2539-2545` :

```java
private int indexOfNumber(String typed) {
    for (int i = 0; i < channelNumbers.size(); i++) {
        if (typed.equals(normalizeNumber(channelNumbers.get(i)))) return i;
    }
```

`normalizeNumber` fait `String.matches("\\d+")` + `replaceFirst` **par chaîne**. Sur 20 000 chaînes, chaque chiffre tapé exécute 20 000 regex sur le thread UI. Correctif : construire une `HashMap<String,Integer>` (numéro normalisé → index) après `adoptFullList`, et la réutiliser.

### P1 — mémoïsation des cartes de la liste web contournée

`ChannelList.tsx:95` déclare `ChannelCard` en `React.memo`, mais :
- `IPTVPlayer.tsx:950` et `:958` passent des fonctions inline (`onNativeChannelSelect={channel => …}`, `onRecord={channel => {…}}`) recréées à chaque rendu du parent ;
- `ChannelList.tsx:97-98` passe le tableau `favorites` complet et le terme de recherche brut à chaque carte ;
- `toggleFavorite` change d'identité à chaque modification de favoris.

Conséquence : chaque zapping, changement d'onglet ou favori re-rend les ~30 cartes montées (jusqu'à 400 quand la virtualisation est désactivée). Correctif : `useCallback` sur les deux handlers d'`IPTVPlayer`, props `isFavorite`/`favoriteNumber` déjà calculées (ne plus passer `favorites`), `toggleFavorite` stable via une `ref`, et `debouncedSearch` plutôt que `searchTerm` dans les cartes.

### P1 — grille EPG : travail complet par image de défilement

`EPGGrid.tsx:226-242` : chaque `scroll` déclenche un `setView` dans `requestAnimationFrame`, donc un rendu de la grille. Le rendu des lignes mappe **tous** les programmes de chaque chaîne visible, appelle `layoutProgram` **avant** le filtre de fenêtre, puis `formatTime` (qui appelle `toLocaleTimeString` à chaque fois) plusieurs fois par programme.

Correctif : cellules `React.memo` par programme (id + `isCurrent`), filtre temporel avant `layoutProgram`, et `Intl.DateTimeFormat` mis en cache au niveau module. Le guide est l'écran le plus lourd de l'application ; c'est là que se joue la fluidité TV.

### P2 — autres points chauds vérifiés

| Point | Référence | Détail | Correctif |
|---|---|---|---|
| Réglages relus à chaque rendu | `IPTVPlayer.tsx:71` | `useState(StorageManager.getSettings())` évalue le getter à **chaque** rendu : `localStorage.getItem` + `JSON.parse` + objet de ~30 clés | `useState(() => StorageManager.getCachedSettings())` |
| Recherche globale non indexée | `GlobalSearchDialog.tsx:86-99` | `playlist.channels.filter(... toLowerCase() ...)` sur la requête brute, à chaque frappe, deux fois (chaînes + verrouillées) | réutiliser `createSearchIndex`/`searchChannels`, ou filtrer sur `debouncedQuery` |
| Progression podcasts écrite ~4×/s | `nativePlayer.ts:579-593`, `PodcastsPanel.tsx:85-88` | `saveEpisodeProgress` relit et réécrit toute la table à chaque `timeupdate`, puis le panneau relit tout et re-rend | throttle 5–10 s + écriture sur pause/seek ; ne notifier que si l'épisode change |
| Reprises VOD lues dans le rendu | `VodLibrary.tsx:531,534` | `readVodProgress` (localStorage + JSON.parse) pour le film et **chaque épisode** de la saison, alors que `progressLabel` a déjà un cache | utiliser le cache existant |
| Écouteur `tv-*-back` réabonné à chaque rendu | `TvLiveScreen.tsx:462-471`, `TvVodScreen.tsx:409-418` | `useEffect` sans tableau de dépendances : `removeEventListener` + `addEventListener` à chaque flèche | dépendre de `column` ou passer par une `ref` |
| Réinitialisation des filtres à chaque édition | `ChannelList.tsx:426-463` | l'effet d'hydratation dépend de `groups` (nouvelle identité après édition/rafraîchissement) : `setSearchTerm('')`, filtres remis à zéro et ~10 lectures IndexedDB | ne dépendre que de `playlistId` |
| `failedLogos` non borné | `ChannelLogo.tsx:6` | une entrée par logo cassé, jamais purgée | plafonner (~500) ou indexer par hôte |
| EPG brut stocké dans `meta` | `epg.ts:83-96` | XMLTV complet (plusieurs Mo) dans le même magasin que les réglages ; relu et cloné à chaque chargement | magasin dédié ou fichier de cache, métadonnées séparées |
| Signature de cache EPG trop large | `useEPG.ts:18-19` | `channelsSignature` inclut `channels.length` : tout changement de nombre de chaînes invalide le guide parsé | clé sur les URL + `fetchedAt`, pas sur le catalogue |

---

## 4. Fiabilité et bugs

### P1 — lecteur fantôme après mise en arrière-plan (natif)

`NativePlayerActivity.java:1923-1928` poste un `reconnectLive()` sur `playerView` quand le direct se termine ; `onPause` (`:2170-2186`) a déjà appelé `releasePlayer()` (`:2751-2764`). `reconnectLive` (`:3040-3045`) fait :

```java
if (player != null) prepareMedia(streamUrl); else initPlayer(streamUrl);
```

sans garde `resumed`/`isFinishing`/`isDestroyed`. Un nouveau `ExoPlayer` peut donc être créé et jouer **en arrière-plan**, jusqu'à `onDestroy`. Correctif : sortir immédiatement si l'activité n'est plus reprise, et retirer les `post` de reconnexion dans `onPause`.

### P1 — enregistrement interrompu présenté comme terminé

`Recorder.java:196-208` : le corps d'écriture est dans `catch (Exception ignored)`, puis `finally` appelle `postStopped(name, total)` dès que le fichier a été ouvert. `postStopped` considère `total > 0` comme un succès. Une coupure réseau ou un disque plein en milieu d'enregistrement produit donc « Enregistrement terminé » avec un fichier tronqué ; `RecordService` relaie le même message.

Correctif : distinguer arrêt volontaire et erreur d'écriture, marquer le fichier partiel, et afficher « Enregistrement interrompu (stockage plein ou réseau) ». Le fichier partiel peut rester lisible — c'est le message qui est faux.

### P2 — surcouches non masquées en PiP

`NativePlayerActivity.java:1776-1786` masque la barre du haut, l'info-bulle, les contrôles, le panneau et la feuille d'options, mais oublie `errorPanel`, `nextEpisodePanel`, `zapOverlay` et `numberOverlay`. Une erreur ou un compte à rebours d'épisode peut recouvrir toute la vignette. Correctif : ajouter ces quatre vues à la branche PiP.

### P2 — canal de notification `recordings` contradictoire

`RecordService.java:40,230` le crée en `IMPORTANCE_LOW`, `ScheduledRecordReceiver.java:24,99-100` en `IMPORTANCE_HIGH` : le premier créateur gagne. Selon l'ordre d'exécution, les notifications DVR deviennent sonores ou silencieuses. Correctif : un seul propriétaire du canal, une seule constante.

### P2 — notification de lecture audio invisible sur Android 13+

`POST_NOTIFICATIONS` n'est demandé que pour l'enregistrement et la programmation (`NativePlayerActivity.java:2463-2468`, `NativePlayerPlugin.java:657-665`). Le service de podcast crée bien une notification média, mais sans permission elle n'apparaît pas. Correctif : demander la permission au premier lancement audio.

### P2 — réglages des sous-titres ignorés dans la fiche VOD

`VodLibrary.tsx:427` lit `StorageManager.getSettings()`, qui lit l'ancien `localStorage['iptv_settings']` (`storage.ts:173`). Or plus rien n'écrit cette clé depuis la migration vers IndexedDB : les réglages de sous-titres (`subtitlesEnabled`, clés DeepL/OpenSubtitles/SubDL) modifiés après la migration ne sont **jamais** appliqués à la fiche VOD. Correctif : `StorageManager.getCachedSettings()` ou transmettre `appSettings`. Même remarque pour le script inline de `index.html` qui applique le thème avant le premier rendu : il lit la même clé morte (sans effet visible tant que le thème clair n'est pas exposé).

### P2 — PIN parental qui annule l'action

`IPTVPlayer.tsx:403-405,420-422` : sélectionner une chaîne verrouillée ouvre le dialogue PIN puis revient ; `onUnlock` (`:1140`) se contente de poser `parentalUnlocked`, l'utilisateur doit **resélectionner** la chaîne. Correctif : mémoriser l'action demandée (chaîne ou groupe) et la rejouer après déverrouillage.

### P2 — échec d'enregistrement de liste annoncé comme un succès

`IPTVPlayer.tsx:244-251` : `toast.error('Enregistrement de la liste impossible')` dans le `catch`, puis **toujours** `toast.success('Liste chargée…')`. De même, `refreshPlaylist` (`:649-650`) sort par `return` quand la liste a disparu, sans fermer le `toast.loading`, qui reste indéfiniment. Correctif : drapeau `saved` et toast conditionnel ; `dismiss(toastId)` sur tous les chemins.

### P2 — suite de tests non fiable sous charge

Un test sur 515 échoue par timeout (5 s) quand toute la suite tourne en parallèle avec couverture ; il passe en 1,65 s isolé. Il n'y a pas de CI : rien n'empêche cet état de devenir la norme. Correctif : `testTimeout: 15000` dans `vitest.config.ts`, ou fake timers dans ce test ; et une commande `verify` (`tsc && eslint && vitest run && vite build`) utilisée avant chaque livraison.

### Points mineurs

- `TvVodScreen`/`IPTVPlayer` : dialogues Mosaïque et Enregistrements sans `DialogDescription` (avertissement Radix).
- `ListOrganizers.tsx:108` : « 1 groupe sur 5 visible » au lieu de « visibles ».
- `ErrorBoundary.tsx:25` affiche `error.message` brut (voir §5).
- 14 `console.warn/error` restent dans des chemins de production.

---

## 5. Sécurité et vie privée

### P1 — secrets dans le journal des réglages et dans les sauvegardes

`storage.ts:241-251` enregistre dans le journal de changement (`SettingsChangeLogEntry`) **toute** valeur modifiée, y compris `tmdbApiKey`, `deeplApiKey`, `openSubtitlesApiKey`, `subdlApiKey` et `parentalPin`. `SettingsPanel.tsx:31` relit ce journal et l'affiche **en clair** dans le panneau Diagnostics de production (`:217-225`). Les 25 dernières entrées conservent donc d'anciennes clés après changement.

`idb.ts:76-99` exporte par ailleurs les comptes Xtream (serveur, utilisateur, **mot de passe**) et les positions VOD dans un fichier JSON non chiffré. `BackupPanel.tsx:62` parle génériquement d'« identifiants », sans prévenir qu'il s'agit de mots de passe et de clés d'API en clair.

Correctifs : masquer les champs sensibles (`***`) dans le journal et les diagnostics ; ne jamais journaliser les secrets ; avertissement explicite dans la sauvegarde (« ce fichier contient tes identifiants en clair, conserve-le comme un mot de passe ») ; option de sauvegarde sans identifiants.

### P2 — CSP désactivée

`index.html:31-32` : la CSP est commentée « Disabled for development », alors que `DOCUMENTATION.md:354` affirme qu'elle est configurée. Le build de production en hérite. Correctif : activer une CSP compatible avec les flux (voir la politique déjà écrite dans le commentaire) et la tester sur les chemins HLS/MPEG-TS, TMDB et le proxy.

### P2 — PIN parental en clair

`parentalPin` est stocké tel quel dans les réglages et dans les sauvegardes. Pour une app personnelle, le risque est faible, mais un simple SHA-256 salé (ou PBKDF2) coûte peu et évite qu'un PIN réutilisé ailleurs soit lisible dans un export.

### P2 — import Xtream/M3U sur Android dépendant du CORS du fournisseur

`XtreamLoginDialog.tsx:77-79` et `xtreamLive.ts:45,96` utilisent `fetch` depuis la WebView ; `PlaylistLoader.tsx:34` passe par `CORSProxy`, qui fait aussi un `fetch` direct. Les chemins guide (`epg.ts:44-59`) et User-Agent (`userAgent.ts:27-30`) utilisent pourtant `CapacitorHttp`, qui ignore le CORS. Un fournisseur sans en-tête `Access-Control-Allow-Origin` fera donc échouer **l'import** alors que le reste fonctionne. Correctif : router aussi ces trois appels par `CapacitorHttp` sur natif (le helper existe déjà).

### P2 — APK release signée avec la clé de debug

`android/app/build.gradle:23` : `signingConfig signingConfigs.debug` avec `minifyEnabled true`. C'est un choix assumé du projet (mises à jour USB sans désinstallation), mais la clé de debug est publique et jetable : toute personne ayant accès au keystore peut produire une mise à jour acceptée. Pour une app strictement personnelle, le risque est limité ; un keystore dédié, documenté et sauvegardé, serait préférable.

### Vérifié propre

Aucune URL, aucun identifiant, aucun jeton, aucune MAC dans les 13 sites `Log` natifs ; erreurs de lecture mappées en codes. `allowBackup="false"`, activités de lecture `exported="false"`, `ScheduledRecordReceiver` non exporté, types de service de premier plan déclarés, chemin de fichier temporaire validé (le parent canonique doit être `cacheDir`, nom `zap-*`/`zaplist.tsv`). Le proxy de développement écoute sur `127.0.0.1` uniquement. Les URL blob (sous-titres, sauvegardes, exports) sont révoquées.

---

## 6. Fonctionnalités : état réel et manques utiles

### Ce qui existe réellement

Direct (Xtream, M3U, Stalker), multi-listes, groupes, favoris et listes de favoris, variantes de qualité, filtre qualité, contrôle parental, numérotation canonique et zapping par chiffres, mosaïque 2–8, catch-up Xtream et M3U, DVR natif, guide XMLTV multi-sources avec recherche d'émissions, rappels, fiche programme, santé des chaînes, éditeur de chaînes et de groupes, mode TV 3 colonnes, PiP, Chromecast, aperçu natif, podcasts (service média + mini-lecteur), VOD Xtream avec fiches TMDb (casting, avis, similaires), ma liste, « Continuer à regarder », sous-titres externes et traduction, reprise, séries avec épisode suivant natif, bibliothèque USB/SD, sauvegarde/restauration, télémétrie locale.

### Écarts entre le README et le code

| Promesse | Réalité |
|---|---|
| « Aperçu vidéo instantané (ExoPlayer / **HLS.js sur le web**) » | L'aperçu est **natif uniquement** (`IPTVPlayer.tsx:76`, `NativePlayerBridge.isAvailable()`), aucun aperçu web |
| « **Picture-in-Picture** » | PiP Android seulement ; le « mini-lecteur » web est un élément DOM, pas la PiP navigateur |
| « Sous-titres intégrés et recherche externe » | Sélecteur monté **seulement en VOD** (`VodLibrary.tsx:513`) ; le direct web n'a aucune piste de sous-titres ; le natif lit les pistes intégrées |
| « Films & Séries … recherche temps réel » | Le catalogue VOD exige un compte **Xtream** ; les entrées VOD d'une M3U ne sont pas exposées |

Ces écarts sont documentaires, pas des régressions — mais ils trompent sur les capacités réelles.

### Cinq fonctionnalités à fort intérêt, dans l'ordre

1. **Rappels EPG en notification système.** Les rappels existent (`utils/reminders.ts`, `EPGGrid.tsx:474`), mais ne s'affichent qu'en **toast dans l'application ouverte** (`IPTVPlayer.tsx:605-613`). Un `AlarmManager` + `BroadcastReceiver` calqué sur `ScheduledRecordReceiver` rendrait le rappel utile quand on regarde autre chose. *Impact fort, effort moyen (1–1,5 j).*
2. **Sous-titres du direct web.** `hls.js` expose déjà les pistes texte ; le sélecteur VOD existe. Unifier le sélecteur pour le direct web comble l'écart le plus visible entre mobile et TV. *Impact moyen-fort, effort moyen.*
3. **Épisode suivant automatique côté web.** Le natif a un compte à rebours (`startNextEpisodeCountdown`), le web non (aucun appel trouvé dans `VideoPlayer.tsx`/`VodLibrary.tsx`). Parité attendue par l'utilisateur. *Impact moyen, effort faible-moyen.*
4. **Mosaïques enregistrées.** `MosaicPicker.tsx` ne conserve pas de composition ; « Sport », « Infos » ou une sélection personnelle seraient à rejouer en un clic. Le remplacement d'une seule case demande du natif, mais la sauvegarde/restauration de la sélection est purement web. *Impact moyen, effort faible pour les presets.*
5. **Statistiques de lecture (« stats for nerds »).** Les données existent déjà (débit, images perdues, coupures via `session_summary` et `RebufferTracker`), mais l'écran `TelemetryGraphs.tsx` est **mort** (importé nulle part). Soit le raccorder à un panneau de diagnostic, soit le supprimer avec `recharts`. *Impact faible-moyen, effort faible.*

### Non-objectifs raisonnables

Téléchargement hors-ligne de VOD, profils multi-utilisateurs, synchronisation cloud, DRM : hors du périmètre d'une app personnelle, et coûteux.

---

## 7. Architecture et maintenabilité

- **Fichiers géants** : `NativePlayerActivity.java` 3 585 lignes, `IPTVPlayer.tsx` 1 217, `nativePlayer.ts` 975, `ChannelList.tsx` 909. Ce n'est pas un défaut en soi — le code est commenté et cohérent — mais toute évolution du lecteur natif devient risquée. Une extraction progressive (contrôles, zap, PiP, cast, DVR) serait le prochain gain de maintenabilité.
- **Trois sources de version** : `package.json`, `android/app/build.gradle`, chaîne en dur `SettingsPanel.tsx:230`. Un script de synchronisation (ou une constante générée) éviterait l'oubli déjà rencontré.
- **Hygiène statique** : 20 avertissements ESLint, 7 `any`/`@ts-ignore`, 14 `console.*` en production. Rien de bloquant, mais `eslint --quiet` masque les avertissements dans le script `lint` : ils ne sont jamais vus.
- **Dépendances mortes** : `TelemetryGraphs.tsx` et `ui/chart.tsx` (seul consommateur de `recharts`), `ui/alert.tsx`, `ui/collapsible.tsx`, `ui/label.tsx` ; exports jamais utilisés (`fetchEPGXml`, `saveVodWatchlistToDB`, `writePodcastFeeds`, `getLastActiveEpisodeProgress`, `isStalkerUrl`, `platformOf`, `DAY_WIDTH`) ; `@metagptx/vite-plugin-source-locator`, `lovable-tagger`, `@tailwindcss/typography` non utilisés. `recharts` n'apparaît pas dans le bundle (tree-shaken) mais reste une dépendance installée et auditée.
- **Versions** : Capacitor 6.2, Media3 **1.2.1** (fin 2023), targetSdk 34, Vite 5.4, React 18.3. Media3 1.2.1 est ancien pour du HLS/direct ; une montée en 1.4/1.5 apporterait des correctifs de lecture, au prix d'une recette box sérieuse. À planifier comme lot dédié, pas en passant.
- **Pas de CI** : aucun garde-fou automatique entre le commit et l'APK. La suite est rapide (63 s avec couverture) ; un workflow local `verify` suffirait.
- **Package** : `package.json` sans `"type": "module"` provoque deux avertissements Node à chaque build ; `pnpm@8.10` declaré alors que Node 24 est utilisé.

---

## 8. Hygiène de livraison

| Constat | Détail | Action |
|---|---|---|
| **4,1 Mo de médias de test dans l'APK** | `public/verification-video.mp4` (2,0 Mo), `verification-hls-00/01.ts` (2,1 Mo), `flux-legaux.m3u` (404 Ko) copiés dans `dist/` puis dans l'APK | déplacer vers un dossier de fixtures hors `public/` (ou exclure au build) ; l'APK passe de ~8,6 à ~4,5 Mo |
| 26 APK + 35 captures à la racine | **235 Mo** d'APK, gitignorés mais présents | archiver dans `version-historique-zip/` ou supprimer |
| `tmp/` et `export-raster.ps1` non suivis | `git status` les montre en `??` ; `tmp/` n'est pas dans `.gitignore` | ajouter `tmp/` au `.gitignore` |
| Documentation périmée | `DOCUMENTATION.md` cite React Query, `ConnectivityTroubleshooter`, `PerformanceMonitor`, un fichier `LICENSE` absent, la version 1.0.0 ; `tests-verification.txt` annonce 61 tests/14 fichiers (réel : 515/85) ; `typecheck-initial.txt` cite des composants supprimés | mettre à jour ou supprimer ces fichiers |
| Fichiers de vérification suivis | `application/tests-verification.txt`, `typecheck-initial.txt`, `build-verification.txt` | sortir du dépôt |
| README sur-prometteur | voir §6 | corriger les quatre mentions |

---

## 9. Plan d'action proposé

### Lot A — correctifs chauds (0,5–1 j, aucun risque fonctionnel)

1. Recommandations VOD : normalisation hors boucle + clé d'historique stable.
2. `useState` paresseux pour les réglages (`IPTVPlayer.tsx:71`) et `getCachedSettings()` dans la fiche VOD (`VodLibrary.tsx:427`).
3. Garde `resumed`/`isFinishing` dans `reconnectLive` + purge des `post` en `onPause`.
4. Erreurs d'écriture d'enregistrement remontées ; message « interrompu ».
5. Sortir les médias de test de `public/` ; APK allégée.
6. `testTimeout` et commande `verify`.

**Vérification** : tests verts, benchmark de recommandations < 50 ms sur 20 000 × 50, build, `assembleDebug`, protocole box (démarrage, 20 zappings, 30 min, arrière-plan/reprise).

### Lot B — fluidité perçue (1–2 j)

7. Index des numéros natif.
8. Chargement de la liste complète hors thread UI (avec mesure `zap_full_list load_ms` avant/après).
9. Mémoïsation réelle des cartes `ChannelList` (callbacks stables, props minimales).
10. Cellules EPG mémoïsées + `Intl` en cache + filtre avant `layoutProgram`.
11. Throttle de la progression podcasts ; cache des libellés de reprise VOD.

**Vérification** : mesure rAF navigateur (protocole existant, 960×540, 65 appuis à 25 Hz) + `panel_scroll` sur box.

### Lot C — sécurité et hygiène (0,5 j)

12. Masquage des secrets dans le journal/diagnostics ; avertissement de sauvegarde.
13. CSP de production.
14. PIN parental haché (avec migration).
15. `CapacitorHttp` pour l'import Xtream/M3U natif.
16. Keystore release dédié (ou décision documentée de garder la clé debug) ; nettoyage docs/versions.

### Lot D — fonctionnalités (au choix, 1–2 j chacune)

17. Rappels EPG en notification système.
18. Sous-titres du direct web.
19. Épisode suivant automatique web.
20. Mosaïques enregistrées.
21. Stats de lecture (ou suppression de `TelemetryGraphs` + `recharts`).

---

## 10. Ce que cet audit ne prouve pas

- Aucune mesure sur la box ni sur un flux réel : les gains annoncés sont des attentes calculées, pas des mesures d'image.
- Le gel des recommandations est mesuré sur une copie fidèle des fonctions, pas dans l'application ; la taille réelle du catalogue et de l'historique du compte déterminera l'ampleur (0,4 s à 8 s selon 5 000 × 20 ou 20 000 × 50).
- Les défauts natifs sont établis par lecture du code, pas par reproduction sur appareil.
- Aucun test de charge longue (veille, changement de réseau, catalogue de 100 000 chaînes).
- Les six points validés lors des revues précédentes (EPG fenêtré, TMDB, numérotation, zapping, mémoïsation TV, tampons) n'ont pas été re-testés ici ; ils restent acquis.
