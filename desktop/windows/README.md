# CedPlay pour Windows

Ce dossier construit une application Windows x64 autonome : Electron fournit
Chromium et Node, et FFmpeg/ffprobe sont inclus dans `resources/bin`. Aucune
installation de Node, Chrome ou FFmpeg n'est nécessaire chez l'utilisateur.

| Option évaluée | Conséquence |
| --- | --- |
| Lanceur C# + Node et Chromium portables | Il faut maintenir trois installations et leur protocole de lancement/arrêt. |
| Electron avec le serveur CedPlay intégré | Chromium et Node sont versionnés ensemble, avec une fenêtre et un cycle de vie natifs. Option retenue. |

## Construire

Depuis `application/`, exécuter `corepack pnpm verify`. Puis depuis ce dossier :

```powershell
npm ci
npm test
npm run dist
```

Ou double-cliquer `Construire CedPlay Windows.cmd` à la racine du dépôt : il enchaîne
les tests serveur/runtime/paquet, `npm run dist`, l'E2E sur l'exécutable construit
et les empreintes, avec un journal dans `preuves/desktop-windows-1.12.64/reconstruction.log`.

Versions fixées : Electron 45.3.2, electron-builder 26.18.0. Le registre officiel
npm a été interrogé le 14 novembre 2026. Le verrou `package-lock.json` fige la
résolution. La machine de construction a besoin du réseau pour récupérer Electron
et NSIS la première fois. `npm run pack` produit seulement le dossier décompressé.

`CEDPLAY_FFMPEG_DIR` peut désigner un dossier contenant `ffmpeg.exe` et
`ffprobe.exe`. Par défaut, le script utilise `~/tools/ffmpeg`. La notice de licence
et la provenance doivent correspondre aux binaires choisis. La version Windows
doit rester identique à `application/package.json`, sans modifier la version Android.

## Livrables

Dans `dist-desktop/`, à la racine du dépôt :

- `CedPlay-1.12.64-Windows-x64-Setup.exe` : installateur pour l'utilisateur courant,
  sans demande de droits administrateur. Il crée les raccourcis Windows.
- `CedPlay-1.12.64-Windows-x64.zip` : extraire **tout le dossier**, puis lancer
  `CedPlay.exe`. Déplacer uniquement cet exécutable ne fonctionne pas.
- `win-unpacked/` : même application avant compression, pour les vérifications.

Ces exécutables ne sont pas signés avec un certificat Authenticode. Windows peut
afficher l'avertissement d'un éditeur inconnu. L'icône et les informations de
version de `CedPlay.exe` sont tout de même appliquées (`signExecutable: false`) ;
ne pas revenir à `signAndEditExecutable: false`, qui laisse l'identité « Electron ». L'ancienne signature Android
n'est pas une signature Windows.

Le ZIP est portable quant à son installation. Les préférences, playlists et
enregistrements restent dans le profil de l'utilisateur Windows, en dehors du
dossier de l'application. La désinstallation conserve les données.

## Contenu et limites de livraison

La préparation copie une liste explicite de modules serveur, les deux fichiers
Electron, l'icône et les seuls fichiers du build Web. Elle exclut les sources Web,
les dépendances de développement, les tests, profils, listes privées, secrets et
médias de test. Les types inattendus et fichiers Web de plus de 8 Mio bloquent
la préparation. `BUNDLED-RUNTIME.json` relève les empreintes des outils média.

Les licences Electron/Chromium sont conservées par electron-builder. Le FFmpeg
local est un build statique GPLv3 de Gyan. La notice incluse ne vaut pas audit de
conformité de toutes ses dépendances : consulter `licenses/FFMPEG-NOTICE.md`
avant une redistribution publique.

La réussite du build prouve l'assemblage. Le fonctionnement autonome se vérifie
en démarrant le dossier extrait avec un PATH privé de Node/Chrome/FFmpeg, hors
du dépôt, puis en contrôlant l'ouverture, le décodage et l'arrêt du processus.
Elle ne prouve ni les flux d'un fournisseur réel ni la réception Wi-Fi sur TV box.
