# CédPlay — lecteur personnel de direct, films et séries

Cette application est la reprise active des sources récupérées. L’historique, les décisions, les validations et la prochaine étape figurent dans **`../CURRENT_MISSION.md`**.

## Utilisation locale

Depuis la racine, double-cliquer **Lancer le lecteur.cmd**, ou lancer `npm run dev` ici puis ouvrir http://127.0.0.1:5178/ .

Importer une liste M3U depuis un fichier ou une URL. Pour un essai entièrement local : `public/verification.m3u` (MP4 et HLS synthétiques). Démarrage sans son par défaut.

## Vérification

- `npm run typecheck`
- `npm test`
- `npm run build`

Les dépendances sont verrouillées avec pnpm 8.10.0. Réinstallation : `npx --yes pnpm@8.10.0 install --frozen-lockfile --ignore-scripts`.

Les autres guides présents dans ce dossier proviennent des archives de 2025 et ne décrivent pas forcément la version actuelle. Le relais historique `proxy-server.js` n’est pas utilisé ; ne pas le démarrer sans révision.
