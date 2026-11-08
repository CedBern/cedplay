# Audit intégral CedPlay — 8 novembre 2026

Périmètre : `application/` (Web + Capacitor) et `application/android/`, version **1.12.6** (`versionCode 54`).
Nature : audit en vue de corrections. Aucun fichier de code n'a été modifié lors de l'audit.

## Suivi des corrections

**Lot A — sécurité fonctionnelle : livré le 8 novembre 2026** (code modifié, non versionné, aucun APK produit).

| Constat | État | Ce qui a changé |
|---|---|---|
| COR-01 contrôle parental VOD | **corrigé** | `src/utils/parentalVod.ts` (registre de session des catégories adultes), `src/hooks/useAdultVodCategories.ts`, filtrage des catégories, titres, Ma liste et « Pour toi » dans `VodLibrary.tsx`, des résultats VOD de `GlobalSearchDialog.tsx`, de « Continuer » (`ContinuePanel.tsx`), et des favoris publiés au lanceur TV (`IPTVPlayer.tsx`, filtre par `playableChannels`) |
| COR-02 quota / cache EPG | **corrigé** | `epg.ts` : un échec d'écriture n'est plus présenté comme une panne réseau, plafond de 12 M caractères pour la mise en cache ; `idb.ts` : `deletePlaylistFromDB` purge guides, index de replay et préférences de la liste ; `ChannelList.tsx` : échec d'enregistrement d'un favori annulé et signalé |
| P2-09 caches survivants | **corrigé** | même purge (11 familles de clés `meta`) |

Preuves après correction : `tsc` app + node 0 erreur, `eslint ./src` 0 erreur / 18 avertissements (inchangé), **685/685 tests** sur 106 fichiers (13 nouveaux), `vite build` OK (chunk principal 632,6 kB / 192,4 kB gzip), `dist/` 2,7 Mo.
Reste à faire pour ce lot : recette sur appareil avec une catégorie adulte Xtream réelle.

**Lot B — démarrage et robustesse : livré le 8 novembre 2026** (code modifié, non versionné, aucun APK produit).

| Constat | État | Ce qui a changé |
|---|---|---|
| COR-03 ouverture IDB mémorisée | **corrigé** | `idb.ts` : `blocked`/`blocking`/`terminated`, ouverture bornée à 10 s, un échec (`VersionError`, onglet concurrent) n'est plus conservé pour la session ; `storage.ts` : lecture des réglages bornée à 8 s avec repli sur les réglages synchrones au lieu d'un écran de chargement éternel |
| COR-04 re-parse EPG synchrone | **corrigé** | `epgWorker.ts` : au-delà de 4 M caractères, un timeout rend une erreur explicite au lieu de re-parser le XML sur le fil principal ; le repli synchrone reste réservé aux petits guides et aux erreurs immédiates du worker |
| COR-05 tailles et encodage | **corrigé** | `textImport.ts` : BOM, `encoding="…"`, repli windows-1252, plafonds 64 Mo pour les fichiers et 120 M caractères pour un guide décompressé ; appliqué dans `PlaylistLoader.tsx`, `corsProxy.ts`, `m3uParser.ts` et `epg.ts` |
| COR-06 mémoire du guide | **corrigé** | `epgXmltv.ts` : fenêtre temporelle appliquée pendant la boucle de `parseXmltv` (marge ±48 h pour les décalages) ; `useEPG.ts` : les guides complémentaires ne sont parsés que pour les chaînes restées sans programme |
| COR-07 import Xtream sans borne | **corrigé** | `userAgent.ts` : `httpGetJson` avec délai de 20 s et `AbortSignal` ; `xtreamCatalog.ts` : `catalogRequest` borné, identifiants refusés distingués d'une panne réseau ; `xtreamLive.ts` : import annulable ; `XtreamLoginDialog.tsx` : la fermeture du dialogue interrompt les requêtes en cours |

Preuves après correction (lots A + B) : `tsc` app + node 0 erreur, `eslint ./src` 0 erreur / 18 avertissements, **709/709 tests** sur 110 fichiers (37 nouveaux depuis l'audit), `vite build` OK (chunk principal 636,9 kB / 193,9 kB gzip), `dist/` 2,7 Mo.
Reste à vérifier sur appareil : guide volumineux (> 4 M caractères), liste M3U Latin-1 réelle, fermeture du dialogue Xtream pendant un import muet. Les sources complémentaires sont encore toutes téléchargées ; seule leur analyse est conditionnée aux trous de la source principale.

**Lot C — performance TV : livré le 8 novembre 2026** (code modifié, non versionné, aucun APK produit).

| Constat | État | Ce qui a changé |
|---|---|---|
| COR-08 défilement non throttlé | **corrigé** | `EPGGrid.tsx` : la relance de l'aperçu natif au défilement et au redimensionnement est coalescée en `requestAnimationFrame` (une mesure et un appel au pont par image), frame annulée au démontage |
| P2-07 props inline cassant les memos | **corrigé** | `IPTVPlayer.tsx` : `openSearch`, `showGuide`, `openGroupManager` et `toggleChannelSort` mémoïsés ; `onNativePlay`, `onNativeChannelSelect` et `onRecord` réutilisent les callbacks stables déjà présents. Le `useMemo` des catégories du Direct n'est plus reconstruit à chaque rendu du parent, donc son minuteur de catégorie n'est plus réarmé |
| P2-08 reflow et recherche effacée | **corrigé** | `ChannelList.tsx` : `useLayoutEffect` doté de dépendances explicites et `restoreRowFocus` mémoïsé — plus de parcours du DOM ni de `getBoundingClientRect()` après chaque frappe dans une liste virtualisée ; la recherche n'est remise à zéro que lors d'un changement de `playlistId`, plus lors d'un simple changement d'identité de `groups` |
| P2-10 caches d'affiches non bornés | **corrigé** | `vodPosterCache.ts` : `rememberLoadedPoster`/`rememberFailedPoster` avec plafonds (2 000 affiches chargées, 500 en échec) et éviction des plus anciennes ; `VodPoster.tsx` écrit désormais par ces fonctions |

Preuves après correction (lots A + B + C) : `tsc` app + node 0 erreur, `eslint ./src` 0 erreur / 18 avertissements, **717/717 tests** sur 113 fichiers (45 nouveaux depuis l'audit), `vite build` OK (chunk principal 637,6 kB / 194,0 kB gzip), `dist/` 2,7 Mo. Les 8 tests du lot C ont été vérifiés par mutation : chacun échoue sur le code d'avant correction.
Reste à vérifier sur appareil : fluidité du guide au défilement et de l'aperçu sur box, frappe dans une liste de ~2 000 chaînes, défilement d'un catalogue VOD de plusieurs milliers d'affiches.

**Lot E — couverture des chemins critiques : livré le 8 novembre 2026** (code modifié, non versionné, aucun APK produit).

| Constat | État | Ce qui a changé |
|---|---|---|
| P2-20 `stalker.ts` 12 % | **couvert** | `stalker.test.ts` (19 tests) : MAC, adresses candidates, commande `ffmpeg`, URL notée et son payload, connexion multi-adresses, réponses 401/illisibles, repli paginé, genres, dédoublonnage, logos — **100 %** |
| P2-20 `streamCheck.ts` 33 % | **couvert** | `streamCheck.test.ts` (12 tests) : flux lisible, page HTML, corps vide, refus HTTP, panne réseau, lots de 24, annulation, pont natif Android et repli web, chaînes masquées — **100 %** |
| P2-20 `parseWorker.ts` 47 % | **couvert** | `parseWorker.test.ts` (5 tests) : progression, résultat, erreur, plantage du worker, worker indisponible, délai de trois minutes — **100 %** |
| P2-20 `epgConfig.ts` 39 % | **couvert** | `epgConfig.test.ts` (7 tests) : normalisation d'adresse, nettoyage/plafonds/arrondis, contenu illisible, événement, empreinte de cache — **100 %** |
| P2-20 quota IndexedDB | **couvert** | `epgUrl.test.ts` : un `QuotaExceededError` à l'écriture du cache ne prive pas la session du guide téléchargé ; `epgConfig.test.ts` : un enregistrement bloqué par le quota est annoncé comme un échec, sans événement de succès |
| P2-20 encodages M3U/XMLTV | **complété** | `textImport.test.ts` : UTF-16 grand-boutiste et plafond d'un guide compressé — **100 %** |

Défaut trouvé en écrivant les tests : `portalCandidates('ftp://…')` préfixait `http://` et fabriquait des adresses `http://ftp//…`. Toute saisie portant un autre schéma (`ftp://`, `file://`) est désormais refusée (`stalker.ts`). Le test correspondant échouait avant ce correctif.

Preuves après correction (lots A + B + C + E) : `tsc` app + node 0 erreur, `eslint ./src` 0 erreur / 18 avertissements, **763/763 tests** sur 117 fichiers (46 nouveaux pour le lot E), `vite build` OK (chunk principal 637,7 kB / 194,1 kB gzip), `dist/` 2,7 Mo. Couverture globale 85,65 % → **88,82 %** ; `stalker`, `streamCheck`, `parseWorker`, `epgConfig` et `textImport` à 100 % des lignes. Le test de quota a été vérifié par mutation (il échoue si le `catch` d'écriture est retiré).

**Lot D — livraison et hygiène : livré le 8 novembre 2026** (code modifié, non versionné, aucun APK produit).

| Constat | État | Ce qui a changé |
|---|---|---|
| COR-09 flash sombre au lancement | **corrigé** | `storage.ts` : miroir synchrone `iptv_theme` (`setThemeMirror`/`getThemeMirror`, hors des clés purgées) ; `App.tsx` l'écrit à chaque changement et s'en sert pour l'état initial (il prime sur les réglages synchrones hérités, sinon le thème clair repassait en sombre le temps du chargement IndexedDB) ; `index.html` le lit avant le premier rendu et ne retombe sur `iptv_settings` que pour les installations héritées. Trois tests ajoutés dans `storageSettings.test.ts` |
| COR-10 proxy de dev SSRF/CORS | **corrigé** | `proxy-server.mjs` : `Access-Control-Allow-Origin` limité aux origines Vite (`127.0.0.1:5178`, `localhost:5178`, surcharge `IPTV_PROXY_ALLOWED_ORIGINS`), origine inconnue refusée en 403 ; `/proxy?url=` refuse loopback, lien local, CGNAT et plages privées, y compris via un nom DNS qui s'y résout ; validation http/https et refus des identifiants dans l'URL factorisés sur les trois routes Xtream ; commentaire périmé de `proxy.ts` corrigé et script `pnpm proxy` ajouté |
| COR-11 gouvernance de la référence | **corrigé** | `AGENTS.md` réécrit sur **1.12.8 / code 56 / 766 tests** avec l'outillage Android réel et **versionné** (`git add`, commit à venir) ; `pnpm verify` exécute désormais `eslint ./src` **sans** `--quiet` (seul `pnpm lint` reste silencieux) |
| P2-19 SDK et drapeaux | **corrigé, un point assumé** | AGP **8.9.1** + Gradle **8.11.1**, `compileSdk`/`targetSdk` **35**, opt-out du bord à bord Android 15 en attendant la recette ; `largeHeap` et `FLAG_KEEP_SCREEN_ON` conservés et désormais documentés (le lecteur web s'exécute dans `MainActivity`, il n'a pas d'autre moyen de garder l'écran allumé) |
| P2-18 signature release debug | **tracé** | `AGENTS.md` porte la garde explicite du certificat : `~/.android/debug.keystore` signe toutes les versions, sa perte interdit toute mise à jour sans désinstallation, une copie hors machine est obligatoire et il ne doit jamais être régénéré. Aucun keystore créé (décision inchangée) |
| P2-21 APK accumulés à la racine | **corrigé** | 42 APK supprimés (≈300 Mo) ; ne restent que `CedPlay-1.12.8.apk` et `CedPlay.apk`, recopié depuis la 1.12.8 |

Preuves après correction (lots A + B + C + D + E) : `tsc` app + node 0 erreur, `eslint ./src` 0 erreur / 18 avertissements, **766/766 tests** sur 117 fichiers, `vite build` OK (chunk principal 637,96 kB / 194,15 kB gzip), `dist/` 2,7 Mo. Android : `:app:compileDebugJavaWithJavac` puis `:app:assembleDebug` réussis avec AGP 8.9.1 ; `aapt2 dump badging` sur l'APK debug → `compileSdkVersion 35`, `targetSdkVersion 35`, `versionCode 56`, `versionName 1.12.8`. Relais de dev éprouvé au `curl` : 200 sur `/status` avec l'origine autorisée, 403 avec une origine inconnue, 403 sur `127.0.0.1`, `localhost` et `192.168.1.1`, 400 sur un serveur Xtream `ftp://`, 200 sur `https://example.com` via `/proxy`.
Reste à vérifier sur appareil : rendu bord à bord sur un téléphone Android 15 (l'opt-out est temporaire), absence du flash de thème sur une installation en thème clair, et cycle complet du relais depuis l'application web.

**Correctifs de la contre-vérification — 8 novembre 2026** (suite de `REVUE_LOTS_A_E_2026-11-08.md`).

| Défaut reproduit | État | Ce qui a changé |
|---|---|---|
| P1 Ma Liste adulte lisible sans PIN si les catégories tardent ou échouent | **corrigé** | `VodLibrary.tsx` : état `categoriesStatus` (`idle`/`loading`/`ready`/`error`). Un ensemble de catégories vide n'autorise plus rien : après un échec, Ma Liste n'expose aucun titre ; pendant l'attente, `play()` refuse la lecture (reprises « Continuer » et écran TV compris) jusqu'au verdict. « Réessayer » restaure la liste filtrée. 3 tests produit dans `vodLibrary.test.tsx` |
| P2 `[::ffff:127.0.0.1]` accepté par le relais et routes Xtream sans garde de cible | **corrigé** | Garde extraite dans `proxy-guards.mjs` (+ `proxy-guards.d.mts`) : `expandIpv6` décode les 16 octets (`::ffff:7f00:1`, `::/96`, ULA, lien local) ; `/xtream/catalog`, `/xtream/categories` et `/xtream/streams` appliquent `assertPublicTarget` et répondent 403 sur une cible locale. 6 tests dans `proxyGuards.test.ts` ; `preuves/revue-lot-d/proxy-repro.mjs` renvoie 403 sur les six sondes locales et n'atteint jamais le faux service |
| P2 délai et secours réservés au premier appelant des réglages | **corrigé** | `storage.ts` : `_loadingPromise` porte la promesse **protégée** (délai 8 s + repli) partagée par tous les appelants ; une erreur IndexedDB renvoie le même secours à chacun. 2 tests ajoutés (`storageSettings.test.ts`) |
| P2 secours écrasant le thème clair du miroir | **corrigé** | `storage.ts` : `getFallbackSettings()` réapplique le miroir `iptv_theme` au repli ; `App` ne réécrit plus un thème clair en sombre après 8 s. 1 test ajouté |

Effet de bord corrigé dans `TvVodScreen.tsx` : le partage des réglages décale les rendus et la restauration d'affiche pouvait laisser le focus sur les catégories ; la ligne mémorisée est refocalisée explicitement (`restoreFocusRow`).

Preuves après correction : `tsc` app + node 0 erreur, `eslint ./src` complet 0 erreur / 18 avertissements, **778/778 tests** sur 118 fichiers (12 nouveaux), `vite build` OK (chunk principal 638,15 kB / 194,20 kB gzip), `dist/` 72 fichiers / 2 616 573 octets ; rejeux de la revue 3/3 (Ma Liste), 4/4 (réglages/thème), relais 403 sur toutes les cibles locales et 200 sur `https://example.com`. Aucun essai physique ; aucun commit ni APK.

---

## 1. Méthode et preuves d'exécution

Commandes réellement exécutées depuis `application/`, sur l'état du dépôt au 8 novembre 2026 :

| Contrôle | Résultat |
|---|---|
| `tsc -p tsconfig.app.json --noEmit` | 0 erreur |
| `tsc -p tsconfig.node.json --noEmit` | 0 erreur |
| `eslint ./src` (**sans** `--quiet`) | 0 erreur, **18 warnings** |
| `vitest run` | **102 fichiers, 672/672 tests verts**, 51,6 s |
| `vitest run --coverage` | **84,9 %** de lignes — mais sur `src/utils/**` et `src/hooks/**` seulement |
| `vite build` | OK en 12,6 s, `dist/` = 2,7 Mo, aucun média de test copié |
| `aapt2 dump badging` sur `CedPlay-1.12.6.apk` | `versionCode 54`, `versionName 1.12.6`, `targetSdk 34` |
| `apksigner verify --print-certs` | signé `CN=Android Debug` (voir P2-17) |
| `git ls-files "*.apk"` | 0 — les APK ne sont pas versionnés |
| `pnpm audit` | non concluant (aucune sortie exploitable : registre/réseau indisponible) |

Trois audits spécialisés ont été menés en parallèle (sécurité/vie privée, robustesse réseau et persistance, React/performance, couche Android), puis **chaque constat P0/P1 a été revérifié ligne par ligne** dans le code avant d'être retenu ici.

Ce qui n'a **pas** été vérifié : exécution réelle sur téléphone, box Android TV, PiP, Cast, notifications programmées, flux IPTV réels. Ces points restent à valider sur appareil (§6).

---

## 2. Verdict

Le socle est sain : typage strict sans erreur, 672 tests verts, build propre, pas de XSS, pas de secret dans les journaux, virtualisation des listes massives en place, minification R8 correcte.

Les vrais défauts se concentrent sur quatre zones :

1. **Le contrôle parental ne couvre que le direct.** Le VOD et les séries du fournisseur sont accessibles sans code, et les favoris adultes sont publiés dans le lanceur Android TV.
2. **La persistance n'a aucune défense quand le stockage sature.** Les guides EPG ne sont jamais purgés ; au quota atteint, les favoris et les réglages cessent de s'écrire en silence, et l'erreur est présentée comme une panne réseau.
3. **Plusieurs chemins réseau n'ont ni timeout ni annulation** (import Xtream web, parsing M3U/XMLTV), ce qui produit des dialogues figés et des gels complets sur gros fichiers.
4. **La documentation de référence a divergé du code** : `AGENTS.md` annonce 1.12.3 / code 51 / 661 tests, le dépôt livre 1.12.6 / code 54 / 672 tests, et le fichier n'est pas versionné.

Aucun P0 au sens « exécution de code à distance » : il n'y a pas de serveur, pas de sink HTML, et le proxy de développement n'est pas embarqué dans l'APK.

Échelle utilisée : **P0** = à corriger avant la prochaine livraison (contournement de sécurité, perte de données silencieuse) ; **P1** = défaut fonctionnel reproductible, correctif court ; **P2** = robustesse, sécurité en profondeur, performance, dette ; **P3** = hygiène.

---

## 3. P0

### COR-01 — Contrôle parental absent sur tout le VOD / séries

**Preuve.**
- `src/components/VodLibrary.tsx:104` : la signature ne reçoit ni `lockedGroups` ni `unlocked`.
- `src/components/TvVodScreen.tsx:35-60` : `TvVodScreenProps` ne contient aucun verrou ; `:210` rend toutes les catégories.
- `src/components/GlobalSearchDialog.tsx:124-136` : `vodIndex` est construit sur le catalogue complet, `matchedVod` n'est jamais filtré, alors que les chaînes le sont (`:87-101`).
- `src/components/ContinuePanel.tsx:135-150` : la reprise VOD n'applique pas le verrou (seules les chaînes sont filtrées, `:106-133`).
- `src/components/IPTVPlayer.tsx:401-412` : `favoriteIds` est transmis à `setChannelShortcuts` / `setHomeFavorites` sans passer par `playableChannels`.

**Impact.** Contrôle parental activé, enfant sur la box : onglet Films → catégorie « XXX » du fournisseur → lecture immédiate. Une recherche « xxx » dans la recherche globale propose aussi les titres adultes. Le nom et l'affiche d'une chaîne adulte favorite apparaissent sur l'écran d'accueil du téléviseur. Le verrou du direct donne l'illusion d'une protection globale.

**Correctif minimal.** Ajouter une variante de `isAdultGroupName` acceptant un simple `string` (`src/utils/parentalControl.ts:12`), filtrer les `CatalogCategory` et les `CatalogItem` dans `VodLibrary`/`TvVodScreen` quand `parentalControlEnabled && !unlocked`, filtrer `vodIndex` dans `GlobalSearchDialog`, filtrer `inProgressVod` dans `ContinuePanel`, et filtrer `favorites` avant `setHomeFavorites`. Le `ParentalPinDialog` est déjà monté dans `IPTVPlayer`.

**Effort.** M (0,5 à 1 j avec tests).

---

### COR-02 — Cache EPG non borné, et erreur de stockage présentée comme panne réseau

**Preuve.**
```ts
// src/utils/epg.ts:83-97
const xml = await downloadXmltv(url);
if (!xml.includes('<tv') && !xml.includes('<programme')) throw new Error(...);
await setMeta(cacheKey, { fetchedAt, xml, source: url });   // :92  aucune limite de taille
} catch {
  if (cached?.xml) return { ...cached, stale: true };        // :95
  throw new Error('Guide indisponible. Vérifie la connexion et la source EPG.');  // :96
}
```
- Aucune purge : `epgCache_*` et `epgParsed_v2_*` sont créés (`epg.ts:107`, `:142`, `:152`) ; `deleteMeta` existe (`idb.ts:269`) mais n'est appelé que par un test. `deletePlaylistFromDB` (`idb.ts:56-59`) ne supprime que la playlist.
- `getSecondaryEPGUrls` autorise **10** sources en plus de la principale (`epg.ts:130`).
- `setMeta` écrit sans gérer le quota (`idb.ts:248-251`), et la bascule de favori ne protège pas l'écriture (`ChannelList.tsx:673-680` : `setFavorites(next)` puis `await saveFavoritesToDB(next)` sans `catch`).
- `navigator.storage.estimate()` / `persist()` n'apparaissent nulle part dans `src/`.

**Impact.** Trois listes avec guides de secours suffisent à saturer le quota du WebView. À partir de là, **toutes** les écritures `meta` échouent : favoris, réglages, historique, « Ma liste ». Simultanément, l'échec d'écriture est transformé en « Guide indisponible. Vérifie la connexion » alors que le guide a bien été téléchargé. L'utilisateur cherche une panne réseau inexistante pendant que ses favoris disparaissent au redémarrage.

**Correctif minimal.** (1) Distinguer dans `fetchCachedXmltv` l'échec de `downloadXmltv` de l'échec de `setMeta` : en cas d'échec de stockage, retourner le XML téléchargé pour la session. (2) Plafonner la taille mise en cache. (3) Purger les préfixes `epgCache_` / `epgParsed_` / `catchupIndex:` à la suppression d'une liste. (4) Ajouter un `catch` avec message explicite sur `saveFavoritesToDB`.

**Effort.** S (2 à 4 h).

---

## 4. P1

### COR-03 — `getDb()` mémorise à vie une ouverture bloquée ou échouée

**Preuve.** `src/utils/idb.ts:23-39` : `dbPromise` est créé une fois, sans `blocked`, sans `terminated`, et sans remise à `undefined` en cas de rejet.
**Impact.** Deux onglets pendant une migration : `openDB` reste en attente indéfiniment, `loadSettingsAsync()` ne rend jamais la main, l'écran de chargement est éternel. Retour à une version antérieure de la base : `VersionError`, promesse rejetée puis mémorisée pour toute la session.
**Correctif.** Fournir `blocked`/`blocking`/`terminated`, réinitialiser `dbPromise` dans un `.catch`, et borner `loadSettingsAsync` par un délai avec repli sur `defaultSettings()`.
**Effort.** S.

### COR-04 — Au timeout, l'EPG est re-parsé en synchrone sur le thread UI

**Preuve.** `src/utils/epgWorker.ts:23-27` (`fallback()` appelle `buildMergedEPGData(xmls.map(parseXmltv), …)`), `:47-53` (`fail()` fait `cleanup()` **avant** `fallback()`, ce qui retire l'écouteur `abort`), `:53` (délai de 60 s).
**Impact.** Guide de 40 Mo mal servi : le worker dépasse 60 s, puis le même XML est analysé sur le thread principal pendant 60 à 120 s. Télécommande morte, l'utilisateur force-ferme l'app. Le changement de liste ne peut plus annuler l'analyse.
**Correctif.** Ne basculer sur le thread principal qu'après une erreur immédiate du worker ; sur timeout, rejeter avec un message et laisser l'état `error` déjà géré par `useEPG.ts:87-88`. Garder le repli synchrone seulement sous un seuil de taille.
**Effort.** S.

### COR-05 — Import M3U/XMLTV sans plafond de taille ni détection d'encodage

**Preuve.** `src/components/PlaylistLoader.tsx:33` (`file.text()`), `src/utils/m3uParser.ts:71` et `:315-330`, `src/utils/epg.ts:62` (`new TextDecoder().decode(bytes)`). Aucun `MAX_PLAYLIST_BYTES` ni `MAX_XMLTV_BYTES` dans le périmètre.
**Impact.** (a) Un fichier de 400 Mo charge deux copies complètes et peut tuer l'app sans message. (b) Une liste en Latin-1 (fréquent chez les revendeurs) affiche « Chaîne Ã‰ » sur 1 988 chaînes et casse la recherche accentuée. (c) Un XMLTV `ISO-8859-1` produit des U+FFFD, le guide devient illisible et les chaînes ne s'associent plus.
**Correctif.** Refuser au-delà d'un seuil avant lecture (fichier et contenu), détecter BOM puis `encoding="…"` et décoder avec le bon label, repli `windows-1252` si le décodage UTF-8 produit des U+FFFD.
**Effort.** S.

### COR-06 — Le XMLTV est entièrement mis en mémoire avant le filtrage temporel

**Preuve.** `src/utils/epgXmltv.ts:93-127` : la boucle pousse tous les programmes dans `programmes[]` ; le filtre `keepFromMs`/`keepUntilMs` n'intervient qu'après (`:187-191`). `src/hooks/useEPG.ts:80` envoie **toutes** les sources d'un coup.
**Impact.** 3 guides de 12 Mo sur une box 1 Go : 250 à 400 Mo de pics avant le premier filtrage, donc `OutOfMemoryError` ou mort par le tueur de processus Android au moment du chargement du guide.
**Correctif.** Appliquer le filtre de fenêtre pendant la boucle (`:106`), et ne charger les sources secondaires qu'en cas de trous.
**Effort.** S.

### COR-07 — Aucun timeout ni annulation sur l'import Xtream en web

**Preuve.** `src/utils/userAgent.ts:41-48` : `const res = await fetch(url)` sans `AbortSignal` (le chemin natif, lui, a `connectTimeout`/`readTimeout`). `src/utils/xtreamLive.ts:113-116` : 5 workers parallèles sans signal. `src/utils/xtreamCatalog.ts:113-124` : `fetch` sans timeout par défaut, et toutes les erreurs réduites à « Catalogue indisponible ».
**Impact.** Fournisseur qui accepte la connexion sans répondre (saturation du soir) : le dialogue reste sur « Import en cours… », non annulable, et les workers continuent après fermeture. Un abonnement expiré affiche un message réseau au lieu de « identifiants refusés ».
**Correctif.** `AbortSignal.timeout(20_000)` par défaut dans `httpGetJson` et `catalogRequest`, `signal` propagé à `fetchLiveChannels`, annulation à la fermeture du dialogue, et conservation de la cause `auth` dans le message.
**Effort.** S.

### COR-08 — Écouteur de défilement non throttlé dans le guide TV

**Preuve.** `src/components/EPGGrid.tsx:256-262` : `window.addEventListener('scroll', relayout, true)` avec `relayout` qui appelle `sendPreview` (`:247-251`), lequel fait un `getBoundingClientRect()` **et** deux appels au pont natif (`showPreview`, `pauseForVideo`). Le handler horizontal voisin, lui, est correctement throttlé en `requestAnimationFrame` (`:340-350`).
**Impact.** Sur box, chaque événement de défilement du guide produit un layout forcé et deux appels Capacitor. Le geste saccade.
**Correctif.** Calquer le handler voisin (`cancelAnimationFrame` + `requestAnimationFrame`) et annuler la frame au démontage.
**Effort.** XS.

### COR-09 — Flash sombre au lancement pour les utilisateurs en thème clair

**Preuve.** `index.html:25` lit `localStorage.getItem('iptv_settings')` pour appliquer le thème avant le premier rendu. Or cette clé **n'est plus jamais écrite** : `saveSettings` n'écrit qu'en IndexedDB (`src/utils/storage.ts:244-270`), et le seul autre usage est un commentaire (`VodLibrary.tsx:515`).
**Impact.** Toute installation dont les réglages vivent en IndexedDB démarre en sombre, puis bascule en clair : flash à chaque lancement. Les installations migrées depuis l'ancienne version lisent en plus un thème figé.
**Correctif.** Miroiter le thème dans `localStorage` à chaque changement (une ligne dans `App.tsx` ou `saveSettings`), ou retirer le script inline et assumer le flash inverse.
**Effort.** XS.

### COR-10 — Le proxy de développement est un SSRF ouvert avec CORS `*`

**Preuve.** `proxy-server.mjs:6` (`HOST = '127.0.0.1'`, bon point), `:10` (`Access-Control-Allow-Origin: '*'`), `:91-137` (`?url=` accepte toute cible http/https et renvoie la réponse intégrale). Validation incohérente : `server` est contrôlé sur `/xtream/catalog` (`:169`) mais pas sur `/xtream/categories` (`:189-201`) ni `/xtream/streams` (`:222-235`), où `username`/`password` sont interpolés.
**Portée.** Développement uniquement : le fichier n'est ni dans `dist/` ni dans les assets Android, et l'APK passe par `CapacitorHttp`.
**Impact.** Tant que le relais tourne, n'importe quel site ouvert dans le même navigateur peut lire les services du réseau local et les pages d'administration des box via `http://127.0.0.1:5179/proxy?url=…`.
**Correctif.** Refuser les hôtes privés/boucle, restreindre `ACAO` à l'origine de l'app, exiger un jeton, factoriser la validation `http/https` sur les trois routes Xtream, et corriger le commentaire périmé de `src/utils/proxy.ts:3` qui cite un script `pnpm proxy` inexistant.
**Effort.** S.

### COR-11 — Gouvernance : la référence des agents a divergé du code

**Preuve.**
- `AGENTS.md` annonce **1.12.3** / `versionCode 51` / « 661 tests » ; le dépôt livre **1.12.6** / **54** / **672 tests** (`package.json:3`, `build.gradle:24-25`, `SettingsPanel.tsx:251`, sortie vitest).
- `AGENTS.md` n'est **pas versionné** : `git ls-files AGENTS.md` → 0 alors que le fichier se présente comme « consignes du codebase ».
- `package.json:14` : `verify` exécute `eslint --quiet ./src`, alors que la règle n°1 de `AGENTS.md` interdit explicitement de masquer avec `--quiet`. Les 18 warnings sont donc invisibles en vérification standard.
**Impact.** Les agents (dont cette session) partent de faits faux ; les avertissements de hooks ne sont jamais vus.
**Correctif.** Mettre à jour l'en-tête, versionner `AGENTS.md`, et retirer `--quiet` de `verify` (garder `lint` tel quel si le bruit gêne).
**Effort.** XS.

---

## 5. P2 — dette, robustesse, sécurité en profondeur

| # | Constat | Preuve | Correctif minimal |
|---|---|---|---|
| P2-01 | La sauvegarde exporte les secrets et le journal ancien **non re-masqué** | `idb.ts:68-95` (exclut seulement les caches), `redactChangeLog` utilisé uniquement à l'affichage (`SettingsPanel.tsx:35`) | Exclure `settingsChangelog` ou le passer par `redactChangeLog` avant sérialisation ; case « sans identifiants » |
| P2-02 | Mot de passe Xtream stocké et **pré-rempli** à l'ouverture | `XtreamLoginDialog.tsx:52`, `:83` | Ne plus pré-remplir ; ne plus écrire `xtream_last_pass` (déjà dans `xtream_account_<id>`) |
| P2-03 | Clés API affichées en clair dans les Réglages | `SettingsPanel.tsx:140,149,153` (`type="text"`) | `type="password"` + bouton révéler |
| P2-04 | `subdlApiKey` : secret stocké, exporté, masqué… et **jamais utilisé** | `storage.ts:39,76,325` ; aucun usage dans `subtitles.ts` (seul `openSubtitlesApiKey` est consommé, `:281-282`) | Supprimer le champ et sa clé de masquage, ou l'implémenter |
| P2-05 | PIN : SHA-256 nu (4 chiffres = 10^4 essais) et verrouillage en mémoire seulement | `pinHash.ts:19-21`, `ParentalPinDialog.tsx:15-24` | PBKDF2 via `crypto.subtle` ; persister `attempts`/`lockUntil` |
| P2-06 | `ChannelLogo` sans `referrerPolicy` | `ChannelLogo.tsx:61-64` | `referrerPolicy="no-referrer"` (déjà fait dans `GlobalSearchDialog.tsx:356`) |
| P2-07 | Props inline recréées qui cassent les memos | `IPTVPlayer.tsx:998-1000` (reconstruit `items` de TvLiveScreen et réarme le timer de catégorie), `:1178`,`:1186` alors que les callbacks stables existent `:519-520` | `useCallback` sur les trois flèches |
| P2-08 | `ChannelList` : reflow forcé à chaque frappe, et la recherche est effacée quand `groups` change d'identité | `ChannelList.tsx:636-643` (`useLayoutEffect` sans deps), `:433-466` (`setSearchTerm('')` dans un effet dépendant de `groups`) | Sortie anticipée dans l'effet de focus ; ne ré-hydrater que sur `playlistId` |
| P2-09 | Les caches EPG survivent à la suppression d'une liste | `idb.ts:56-59` | Purger les préfixes associés |
| P2-10 | `vodPosterCache` : deux `Set` qui grossissent à vie | `vodPosterCache.ts:4-5` | Plafond + `clear` |
| P2-11 | `streamCheck` : signal testé entre lots seulement ; un lot en erreur réseau marque 24 chaînes saines « Ne répond pas » | `streamCheck.ts:58-67`, `:38-41` | Propager le signal ; distinguer annulation/erreur de flux mort |
| P2-12 | Stalker : jusqu'à 500 pages sans budget global | `stalker.ts:143-150` | Budget total (90 s) + arrêt si la pagination stagne |
| P2-13 | `getPlaylistsFromDB` ne valide pas les objets stockés | `idb.ts:46-54` (le zod n'existe qu'à l'import de sauvegarde) | Valider au chargement, mettre les invalides en quarantaine |
| P2-14 | Import de sauvegarde sans borne de taille | `backup.ts:60-64` | Refuser au-delà d'un seuil avant `JSON.parse` |
| P2-15 | Les programmations DVR ne sont jamais reposées au lancement de l'app : après un force-stop, elles ne se déclenchent plus | `ScheduleStore.rescheduleAll` appelé **uniquement** par `BootReceiver.java:16` | Appeler `rescheduleAll` dans `NativePlayerPlugin.load()` |
| P2-16 | Service audio démarré au premier plan sans lecture garantie → `ForegroundServiceDidNotStartInTimeException` possible | `AudioPlaybackService.java:489-511`, démarrage `NativePlayerPlugin.java:1014-1018` | `stopSelf()` si l'action n'a pas chargé de média |
| P2-17 | Pont natif : `deleteRecording` et `playLocal` acceptent une URI arbitraire | `NativePlayerPlugin.java:626-636`, `:536-549` (tous les autres points d'entrée imposent `isHttpUrl`, `:302-307`) | Exiger l'URI de l'arbre `recorder` / un chemin sous `getCacheDir()` |
| P2-18 | Release signé avec la clé de **debug** | `build.gradle:44-50`, `keystore.properties` absent ; `apksigner` → `CN=Android Debug`. Décision déjà documentée dans le fichier | Créer un keystore dédié + sauvegarde hors machine, ou tracer explicitement la garde du fichier |
| P2-19 | `targetSdk 34` alors que Play exige 35 depuis août 2025 ; `largeHeap` + `KEEP_SCREEN_ON` permanents | `variables.gradle`, `AndroidManifest.xml:49`, `MainActivity.java:16` | AGP 8.6 + targetSdk 35 si distribution Play ; conditionner l'écran allumé à la lecture |
| P2-20 | La couverture ne mesure que `src/utils/**` + `src/hooks/**` (~7 600 lignes sur 33 500), et les trous sont dans les chemins critiques | `vitest.config.ts` ; `stalker.ts` **12 %**, `streamCheck.ts` **33 %**, `epgConfig.ts` **33 %**, `parseWorker.ts` **47 %**, `podcastFetcher.ts` **39 %** | Étendre `include` aux composants ; tests sur stalker, streamCheck, parseWorker, quota IDB, encodages |
| P2-21 | 42 APK (300 Mo) à la racine, dont `CedPlay.apk` = **1.12.5** et `Lecteur-IPTV.apk` = 1.10.1 | `ls` racine ; fichiers untracked | Supprimer les doublons, ne garder qu'un nom à jour |

---

## 6. P3 — hygiène

- `ScheduledRecordReceiver.java:20-31` ne vérifie pas l'action de l'intent (atténué par `exported="false"`).
- `NativePlayerActivity.java:1099-1101`, `:2291-2295` : `subtitleFile` sans la validation canonique appliquée à `channelFile`.
- `RecordService` en `START_NOT_STICKY` : un enregistrement tué par Android est perdu sans reprise.
- `TvLiveScreen.tsx:418` : timer de message `zapMiss` non pisté ; deux numéros faux tapés coup sur coup effacent le premier message.
- `res/xml/file_paths.xml` et `res/xml/config.xml` : ressources mortes (aucun `<provider>`, `<access origin="*"/>` non lu par Capacitor 6).
- `.gitignore:32` ignore `preuves/`, alors que `AGENTS.md` désigne ce dossier comme preuve d'audit.
- Quatre worktrees historiques sous `.claude/worktrees/` plus trois worktrees détachés sous `preuves/diagnostic-tv/` : copies complètes sur disque, hors suivi.

---

## 7. Faux positifs écartés (ne pas « corriger »)

Ces points ont été vérifiés puis rejetés ; les inscrire ici évite qu'une prochaine session les traite comme des défauts :

- **XSS / injection HTML** : `dangerouslySetInnerHTML` = 0 occurrence, aucun `innerHTML`, `eval`, `new Function`, `<iframe>` ni listener `message` dans `src/`.
- **Proxy embarqué dans l'APK** : absent de `dist/` et des assets Android ; Android passe par `CapacitorHttp`.
- **Proxy exposé au réseau** : `HOST = '127.0.0.1'`, non joignable depuis le LAN.
- **Règles ProGuard manquantes pour Capacitor** : fournies par `@capacitor/android` ; le `mapping.txt` réel conserve `NativePlayerPlugin` et ses `@PluginMethod`.
- **APK versionnés dans git** : `*.apk` ignoré, 0 blob APK dans tout l'historique (`.git` = 17 Mo).
- **Double `ExoPlayer` fuité** : `nextEpisodePlayer` est un alias de `player`.
- **Traversée de chemin dans l'enregistrement** : `Recorder.sanitize` (`:150-154`) supprime `/`, `\`, `..`, et l'écriture passe par SAF.
- **Fuite de timers/listeners/observers** : les ~60 points d'attachement de `components/` et `hooks/` ont un cleanup symétrique.
- **Boucle infinie de `setColumn`** : `TvLiveScreen.tsx:333` et `TvVodScreen.tsx:326` convergent (`setState` idempotent, sortie si `!el`).
- **Warnings `currentPlaylist` d'`IPTVPlayer.tsx:307/320/332`** : faux positifs de lint ; les corps ne lisent que `.id`, qui est bien la dépendance.
- **Listes non virtualisées** : `@tanstack/react-virtual` est utilisé sur les trois listes massives (chaînes, TV, guide) et VOD/mosaïque paginent.
- **Journaux contenant URL ou identifiants** : aucun, ni en JS ni en Java ; `redact.ts` couvre les 5 secrets à l'écriture et à l'affichage.

---

## 8. Plan de correction proposé

| Lot | Contenu | Effort | Bénéfice |
|---|---|---|---|
| **A — Sécurité fonctionnelle** | COR-01, COR-02, P2-09 | 1 j | Le contrôle parental tient sa promesse ; plus de perte silencieuse de favoris |
| **B — Démarrage et robustesse** | COR-03 à COR-07 | 1 j | Plus d'écran de chargement éternel, plus de gel sur gros fichiers, import annulable |
| **C — Performance TV** | COR-08, P2-07, P2-08, P2-10 | 0,5 j | Guide et listes fluides, recherche non effacée |
| **D — Livraison et hygiène** | COR-09, COR-10, COR-11, P2-18, P2-19, P2-21 | 0,5 j | Référence des agents à jour, proxy de dev sûr, dépôt propre |
| **E — Couverture** | P2-20 : tests `stalker`, `streamCheck`, `parseWorker`, quota IDB, encodages M3U/XMLTV | 1 j | Les 5 fichiers les plus fragiles passent au-dessus de 70 % |

Ordre recommandé : **A**, puis **B**, puis **E** (verrouiller les correctifs par des tests), puis **C** et **D**.
Après chaque lot : `pnpm verify` complet (sans `--quiet`), mise à jour de `CURRENT_MISSION.md` et de la fiche `CedPlay.md`.

État au 8 novembre 2026 : les **cinq lots A, B, C, D et E sont livrés dans l'arbre de travail**, et les **quatre défauts de la contre-vérification sont corrigés** (778/778 tests). Aucun commit de ces lots n'a été créé à ce stade (seul `AGENTS.md` est indexé) et aucun APK ne les contient : l'APK de référence `CedPlay-1.12.8.apk` porte les lots A et B. Prochaine version logique : **1.12.9 / code 57**.

---

## 9. À valider sur appareil (hors de portée de cet audit)

1. **Contrôle parental VOD** après correctif : catégorie adulte Xtream réelle, recherche globale, reprise, lanceur TV.
2. **FGS audio** : `resumeAudio` sans média chargé → surveiller `ForegroundServiceDidNotStartInTimeException` dans `logcat`.
3. **DVR** : programmer, redémarrer (reprise attendue), puis forcer l'arrêt (défaut P2-15 attendu avant correctif).
4. **Alarmes exactes** Android 12/13/14 : refus puis octroi de `SCHEDULE_EXACT_ALARM`.
5. **PiP** et **Cast** : entrée/sortie, absence de son double.
6. **Audio écran éteint** 10 min (aucun `setWakeMode` dans le service).
7. **Gros fichiers** : M3U de 50 000 entrées, XMLTV de 40 Mo tronqué, M3U Latin-1.
8. **Flux réels** : Xtream HTTP, HLS AES-128, Stalker `create_link`, pour valider `Recorder` et `LivePreview`.
