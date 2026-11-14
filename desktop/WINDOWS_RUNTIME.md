# Runtime Windows CedPlay

Deux formes ont été comparées : C# avec Node, Chromium et FFmpeg portables séparés ; Electron avec Node et Chromium intégrés, plus FFmpeg et ffprobe. Electron est retenu pour avoir un propriétaire unique de la fenêtre, de la session et du serveur, sans rechercher Chrome ou Node dans Windows.

Le paquet doit avoir `asar: false` et contenir `resources/app/desktop/` (modules serveur, `electron-main.cjs`, `electron-runtime.mjs`), `resources/app/application/dist/` et `resources/bin/ffmpeg.exe`, `ffprobe.exe`. Aucun téléchargement ni outil de développement n'est requis au démarrage. Les API système PowerShell existantes restent utilisées pour les notifications et la sélection des dossiers.

Le processus principal démarre le serveur HTTP sur `127.0.0.1:4178`. La fenêtre est sandboxée, avec isolation du contexte et Node désactivé. Aucun preload ni pont IPC général n'est exposé. Les permissions de capture, périphériques et notifications du renderer sont refusées ; seul le plein écran local est accepté. Les documents externes sont bloqués dans la fenêtre et leur ouverture HTTP(S) dans le navigateur demande une confirmation explicite. Les redirections externes, schémas système, identifiants dans les URL et webviews sont bloqués. Aucune exception de certificat n'est ajoutée.

Le profil Electron est `%LOCALAPPDATA%/CedPlay/windows/profile`, distinct de l'ancien profil Chrome ; les données serveur restent `%LOCALAPPDATA%/CedPlay/desktop`. Le port stable conserve l'origine des données navigateur entre lancements. `CEDPLAY_PROFILE_DIR` et `CEDPLAY_DATA_DIR` permettent une isolation sans écraser de profil existant. Le verrou d'instance est associé au profil Electron.

Fermer la fenêtre libère le serveur via l'API lifecycle existante. Le serveur et son icône de notification restent actifs tant qu'un enregistrement, une programmation, un rappel ou une notification est en cours. Le callback `onStop` du serveur autorise ensuite la sortie Electron. L'icône rouvre la fenêtre ou propose de quitter ; une confirmation est requise si du travail reste en arrière-plan. F11 bascule le plein écran, Échap le quitte.

Pour les tests uniquement (`CEDPLAY_TEST_MODE=1`) : `CEDPLAY_DESKTOP_PORT=0` accepte un port libre ; `CEDPLAY_CDP_PORT` ouvre le contrôle Chromium sur 127.0.0.1 ; `CEDPLAY_TEST_READY_FILE` écrit les chemins, PID et versions après chargement. `CEDPLAY_TEST_SERVER_URL` permet de servir une origine HTTP `127.0.0.1:port` externe au runtime : dans ce mode, le serveur appartient au harnais et n'est pas arrêté par Electron. Les variables CDP, fichier ready et serveur externe sont ignorées en production.

La validation logicielle de ce runtime ne prouve ni l'affichage réel d'un toast, ni la reprise après redémarrage complet de Windows, ni la lecture d'un fournisseur IPTV réel. Ces surfaces ont leurs propres preuves.
