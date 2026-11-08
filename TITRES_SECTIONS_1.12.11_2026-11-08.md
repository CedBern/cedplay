# CedPlay 1.12.11 — titres de section — 8 novembre 2026

## Défaut et correction

Le retour photo désigne la ligne fournisseur `FR: -- MUSIQUE / NEWS --` dans la colonne des chaînes. La correction précédente avait porté sur les catégories à gauche et n'avait pas traité ce cas.

Reproduction sur la Hisense en 1.12.10 : les données source placent le titre en première position, mais l'écran affiche M6 MUSIC, M6 MUSIC FHD et CSTAR HITS FHD devant. Deux mécanismes se cumulent : reconnaissance TNT trop permissive des préfixes M6/CStar, puis extraction de toutes les chaînes reconnues avant les autres lignes, sans respecter les frontières de section.

Le correctif limite ces deux noms aux suffixes techniques reconnus, conserve leurs variantes réelles HD/FHD/TS et le cas M6 INTER déjà reconnu, et distingue MUSIC/HITS. Le tri automatique s'applique à chaque section séparément : son titre reste avant ses chaînes et aucune chaîne ne traverse un titre. Plusieurs sections et titres consécutifs sont couverts. Les ordres manuels et le tri A–Z explicitement choisis gardent leur contrat. Aucun nom ni objet de chaîne enregistré n'est réécrit ; pas de nouveau modèle de titre ni d'import nécessaire.

## Preuves

- Tests rouges avant correctif : quatre échecs, dont la reproduction des noms de la photo et les frontières de sections. Une contre-revue a ensuite reproduit la régression des généralistes portant `(TS)` ; elle est corrigée et couverte.
- Candidat isolé : **799/799 tests Web** sur 121 fichiers, **35/35 Java**, typage application/configuration sans erreur, ESLint complet zéro erreur/18 avertissements existants, build Vite, Capacitor sync, assembleDebug et assembleRelease réussis.
- Deux régressions de rendu : `liveCategoryOrder.test.tsx` vérifie le titre premier sur TV et mobile après la même préparation que le Direct. Sept sondes indépendantes couvrent aussi la personnalisation, le contexte de zap natif, les sections multiples et les suffixes réels. Rejouées par l'exécutant : 7/7.
- Hisense physique, candidat diagnostic : `before-order.json` montre le titre source premier et son affichage quatrième ; `after-order.json` montre les huit premières lignes affichées identiques à la source. Capture `after.png` inspectée : **MUSIQUE / NEWS est la première ligne**, puis M6 MUSIC et les autres chaînes.
- APK release signée installée ensuite sans désinstallation ; Android confirme **59 / 1.12.11**, minSdk 22 et cible 35. Capture `release.png` inspectée : titre MUSIQUE / NEWS premier sur l'APK finale aussi. Les sorties de diagnostic ne contiennent que les noms utiles à cette reproduction, aucune URL ni clé fournisseur.

## Construction isolée et APK

Un autre agent modifie les recommandations, VOD, le stockage et les profils de goûts dans l'arbre principal. Ces fichiers ne sont ni modifiés, ni intégrés dans cette APK. Le candidat sous `preuves/sections-chaines/candidate/` part de **d0962d7** et ajoute uniquement : `tntOrdering.ts`, son test, le test TV/mobile, et les trois emplacements de version.

`CedPlay-1.12.11.apk` et `CedPlay.apk` : **4 399 296 octets**, SHA-256 **4e7881909929f836a7a467f8fc859df5c0548c7004b0ea425376e43b90d0be33**. Certificat SHA-256 identique à la version précédente : `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`. Ancienne référence racine retirée après contrôle, aucun keystore modifié.

Téléphone non mis à jour, aucun push. Le contrôle physique concerne le groupe musique signalé ; la couverture des autres sections est automatisée. La fluidité prolongée et le problème historique TMDB restent hors de cette correction.
