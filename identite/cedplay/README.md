# CedPlay — identité visuelle

Nom sans accent et icône « C + E + D » validés par Céd le 6 novembre 2026, sur le canevas de propositions (encoche B, palette noir et orange). L'écran blanc ouvert forme le C, le triangle orange le D, et le vide noir prolongé par l'encoche dessine un E. `proposition-validee.png` conserve l'ancienne proposition du 5 novembre (C violet et ruban cyan) ; la sauvegarde d'avant le changement est dans `sauvegardes/avant-logo-cedplay-2026-11-06`.

Couleurs : fond `#0B0B0C`, traits `#FFFFFF`, accent `#FF5A36` (`#D9431F` sur fond clair). Le symbole de notification est blanc plein, sans encoche : à 24 dp elle ne ferait qu'un pixel.

- Source géométrique et couleurs : `mark.json`.
- Icône web et logo avec nom : `cedplay-icon.svg`, `cedplay-logo.svg`, `cedplay-logo-clair.svg`, symbole seul `cedplay-mark-mono.svg`, icône 1024 px `cedplay-icon-1024.png`.
- Export web/Android : depuis la racine, `python identite/cedplay/export-brand.py`, puis `./identite/cedplay/export-raster.ps1` sous PowerShell Windows.
- Le premier export contient aussi les remplacements de l'ancien nom dans les titres de repli natifs et les lanceurs Windows. Les versions de livraison sont tenues dans `application/package.json`, `application/android/app/build.gradle` et le pied des réglages.
- Après régénération : build web, synchronisation Capacitor puis compilation Android. `Construire l'APK.cmd` livre `CedPlay.apk` et conserve l'alias `Lecteur-IPTV.apk`.

Supports : en-tête mobile/ordinateur, import initial, chargement, réglages, titre et métadonnées web, favicon, icône Apple, manifest web et icônes PNG 192/512, visuel de partage, icônes Android normales/rondes/adaptatives/thématiques, lancement, bannière Android TV et notification DVR monochrome.

Compatibilité : conserver `com.lecteur.iptv`, les liens `lecteuriptv:`, les bases et clés de stockage, ainsi que le marqueur de format `lecteur-iptv` des sauvegardes. Le fichier exporté devient `cedplay-AAAA-MM-JJ.json` ; son format reste identique. Les anciens User-Agent des intégrations de sous-titres/métadonnées et les pictogrammes génériques de chaînes ne sont pas des noms visibles de l'application.

La bannière TV et les notifications sont compilées et incluses ; leur affichage sur un téléviseur ou pendant un enregistrement long n'a pas été testé dans cette livraison.
