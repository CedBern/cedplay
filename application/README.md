# CédPlay — lecteur personnel de direct, films et séries

Cette application est la reprise active des sources récupérées. L’historique, les décisions, les validations et la prochaine étape figurent dans **`../CURRENT_MISSION.md`**.

## Utilisation locale

Depuis la racine, double-cliquer **Lancer le lecteur.cmd**, ou lancer `npm run dev` ici puis ouvrir http://127.0.0.1:5178/ .

Importer une liste M3U depuis un fichier ou une URL. Pour un essai entièrement local : `public/flux-legaux.m3u` (flux publics de démonstration). Démarrage sans son par défaut.

## Vérification

- `npm run typecheck`
- `npm test`
- `npm run build`

Les dépendances sont verrouillées avec pnpm 8.10.0. Réinstallation : `npx --yes pnpm@8.10.0 install --frozen-lockfile --ignore-scripts`.

## Signature APK et mises à jour

- **Aujourd'hui** : les APK release sont signés avec le certificat debug (`~/.android/debug.keystore`). Conséquence directe : les installations existantes se mettent à jour par simple installation du nouvel APK, **à condition de ne jamais perdre ce keystore** — le sauvegarder (coffre-fort de mots de passe, disque chiffré) : perdu = plus aucune mise à jour sans désinstallation, donc perte des données de l'application.
- **Bascule vers un keystore dédié** (à préparer AVANT toute publication) : `gradlew` le prend automatiquement en compte dès qu'existe `android/keystore.properties` (hors git) contenant `storeFile`, `storePassword`, `keyAlias`, `keyPassword` — aucun autre fichier à modifier. **Attention** : un APK signé avec un nouveau certificat ne peut PAS s'installer par-dessus une installation signée debug (signature différente). Les utilisateurs existants devront désinstaller puis réinstaller : leur faire exporter une sauvegarde (Réglages → Sauvegarde) avant, et la réimporter après. La bascule est définitive pour le parc installé ; ne la faire qu'une fois, au moment de publier.

Les autres guides présents dans ce dossier proviennent des archives de 2025 et ne décrivent pas forcément la version actuelle. Le relais historique `proxy-server.js` n’est pas utilisé ; ne pas le démarrer sans révision.
