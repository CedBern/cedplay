# Vérification de la distribution Windows autonome — 14 novembre 2026

Le bilan « Distribution Windows autonome (Electron + FFmpeg embarqués) » est confirmé sur ses preuves. Deux défauts de finition du paquet et un test dépendant de la vitesse de la machine ont été trouvés, corrigés, puis l'installateur et le ZIP ont été reconstruits et revérifiés sur la machine de Céd.

## Ce qui est confirmé dans le bilan

- Ordre des événements cohérent : dernières modifications de code (15:22–15:29 UTC), puis `tests.log` (15:29:50), ZIP (15:31), installateur (15:32), recette autonome (15:32:47) et E2E (15:33:13). Les 35/35 tests annoncés ont bien été exécutés après les derniers correctifs.
- SHA-256 de l'ancien installateur recalculé : identique au bilan (`F8CB2F32…78B9`).
- Contenu du paquet : 73 fichiers Web (même nombre que l'APK), 10 modules serveur, FFmpeg/ffprobe dans `resources/bin`, aucune source, aucun test, aucun secret, aucun média de recette.
- Revue des correctifs (`stoppingRecordings`, réessai `renameSync`, `publish: null`, harnais E2E) : conformes à ce qu'annonce le bilan.

## Défauts trouvés et corrigés

1. **CedPlay.exe se présentait comme « Electron ».** `signAndEditExecutable: false` désactivait aussi l'édition des ressources : l'exécutable gardait l'icône Electron, `ProductName = Electron`, `CompanyName = GitHub, Inc.` (Explorateur, Gestionnaire des tâches, raccourcis, avertissement SmartScreen). Remplacé par `signExecutable: false` : signature toujours désactivée, mais icône et métadonnées CedPlay appliquées par electron-builder (resedit, sans outil téléchargé). Vérifié dans le nouvel exécutable : `ProductName/FileDescription/CompanyName = CedPlay`, version `1.12.64`, 6 icônes CedPlay.
2. **Identifiant d'application incohérent.** L'installateur grave `fr.cedplay.desktop` (appId) dans les raccourcis ; la fenêtre déclarait `fr.cedplay.windows`. Conséquence : icône épinglée et fenêtre ouverte dédoublées dans la barre des tâches. La fenêtre utilise désormais `APP_USER_MODEL_ID = 'fr.cedplay.desktop'` ; un test vérifie que les deux restent identiques. Vérifié dans l'en-tête NSIS du nouvel installateur.
3. **Fichier temporaire orphelin** (`config.mjs`) : en cas de repli sur `writeFileSync`, le `.tmp` restait sur disque. Il est maintenant supprimé.
4. **Tests HLS dépendants de la vitesse.** Ils arrêtaient la capture après 900 ms fixes. Sous Linux (FFmpeg 6.1), l'analyse initiale du flux dure plus longtemps et le fichier restait vide : échec reproduit. Le test attend désormais que FFmpeg ait consommé 4 segments. Une première variante fondée sur la taille listée a échoué sous Windows (le fichier ouvert y est rapporté à 0 octet) ; elle a été écartée. Comportement produit associé, non corrigé : arrêter un enregistrement HLS dans les toutes premières secondes peut donner un fichier vide.

Ajout : `Construire CedPlay Windows.cmd` à la racine enchaîne tests, construction, E2E sur l'exécutable construit et empreintes, avec un journal dans `preuves/desktop-windows-1.12.64/reconstruction.log`.

## Résultats après correction

- Linux (contrôle indépendant) : 34/34 réussis, 2 ignorés car propres à Windows ; tests HLS stables sur 3 rejeux.
- Windows, machine de Céd (`reconstruction.log`, lancé le 14/11 à 10:00) : **36/36 tests**, construction `RC_DIST=0`, **E2E complet sur `dist-desktop/win-unpacked/CedPlay.exe` : `RC_E2E=0`**, 0 erreur.
- Nouveaux livrables (remplacent les empreintes du bilan précédent) :
  - `CedPlay-1.12.64-Windows-x64-Setup.exe` : 247 575 811 octets, SHA-256 `3e21fed8b377546997b60d38c3c0e1ed77555dab142feea81bd5ae4331165ac6`
  - `CedPlay-1.12.64-Windows-x64.zip` : 324 711 816 octets, SHA-256 `af9280dc3250c38a15e03a4f1e8d437cd652287e1c70cc6ed42a19a33c12e9f9`

## Portée exacte des preuves

- L'E2E « sur CedPlay.exe » pilote la fenêtre Electron construite, mais avec le serveur de recette du dépôt (`CEDPLAY_TEST_SERVER_URL`), pas le serveur embarqué. Le serveur embarqué n'est couvert que par la recette autonome du bilan précédent, dont le script n'est pas dans le dépôt et qui n'a **pas été rejouée** sur les nouveaux livrables. Les changements du runtime depuis sont limités à l'identifiant d'application et au nettoyage du `.tmp`.
- Les notifications passent par PowerShell : elles s'afficheront sous le nom « Windows PowerShell », pas « CedPlay ».
- Le profil Electron (`%LOCALAPPDATA%\CedPlay\windows\profile`) est distinct de l'ancien profil du lanceur Chrome : les listes et réglages saisis dans l'ancienne version Desktop n'apparaîtront pas. Passer par une sauvegarde puis une restauration.
- Restent à faire à la main : installation par `Setup.exe` et avertissement SmartScreen, icônes des raccourcis et de la zone de notification, notification visible, redémarrage de Windows, fournisseur IPTV réel, appairage QR/LAN en Wi-Fi.

Aucun commit, push, APK ni changement de version. Fiche du Second Cerveau et `entretien.py` non actualisés : hors des dossiers accessibles dans cette session.
