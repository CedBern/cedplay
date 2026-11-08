# Consignes Agents — CedPlay (Lecteur IPTV)

Ce fichier définit le cadre technique et les règles de travail pour tout agent intervenant sur **CedPlay**.

---

## 1. État canonique et emplacements

- **Racine du dépôt** : `C:\Users\C2k\Documents\ChatGPT\Lecteur IPTV`
- **Code applicatif (Web + Capacitor)** : `application/` (`src/`, `tests/`, `android/`)
- **Branche consolidée de référence** : `consolidate/v1.11.4`
- **Version actuelle livrée** : **1.12.10** (`versionCode 58`, du 08/11/2026) — APK de référence à la racine : `CedPlay-1.12.10.apk` (4 399 008 octets). `CedPlay.apk` en est une copie et doit rester aligné sur la dernière version.
- **Fiche de suivi transversal (Second Cerveau)** : [CedPlay.md](C:/Users/C2k/Documents/Second%20Cerveau/10%20Projets/CedPlay.md)
- **Dernier rapport d'audit et preuves** : [AUDIT_INTEGRAL_2026-11-08.md](AUDIT_INTEGRAL_2026-11-08.md) (rapport antérieur : `AUDIT_INTEGRAL_2026-11-07.md`), dossier `preuves/`
- **Outillage Android** : AGP **8.9.1**, Gradle wrapper **8.11.1**, `compileSdk`/`targetSdk` **35** (`android/variables.gradle`), `minSdk 22`.
- **Worktrees historiques** : `.claude/worktrees/app-tivimate-comparison-1e8316`, `ecouter-ui`, `interface-refinement-mobile-tv-b96167` et `lot-d`. **Ne pas développer dans ces worktrees** sans instruction explicite.

---

## 2. Règles d'ingénierie et garde-fous

1. **Vérification obligatoire avant toute annonce de livraison** (depuis `application/`) :
   ```powershell
   pnpm verify
   ```
   ou séquentiellement :
   - `pnpm exec tsc -p tsconfig.app.json --noEmit` et `pnpm exec tsc -p tsconfig.node.json --noEmit` (0 erreur)
   - `pnpm exec eslint ./src` (**sans** `--quiet`, ne pas limiter aux seuls fichiers modifiés : les avertissements doivent rester visibles — 0 erreur / 18 avertissements au 08/11/2026)
   - `pnpm exec vitest run` (tous les tests verts ; **791/791** Web + 35/35 Android au 08/11/2026)
   - `pnpm build` (vérifier qu'aucun média lourd de test n'est copié dans `dist/`)
   Le script `pnpm verify` enchaîne ces quatre étapes ; `pnpm lint` reste volontairement silencieux (`--quiet`) pour un usage courant.
2. **Synchronisation des numéros de version** :
   Toute montée de version doit maintenir en cohérence les **trois emplacements** :
   - `application/package.json` (`version`)
   - `application/android/app/build.gradle` (`versionCode` et `versionName`)
   - `application/src/components/SettingsPanel.tsx` (libellé `CedPlay · x.y.z`)
3. **Compilation Android et signature APK** :
   - `pnpm exec cap sync android` puis dans `application/android` : `./gradlew assembleRelease`
   - Tant que `application/android/keystore.properties` n'est pas fourni, `assembleRelease` signe avec `~/.android/debug.keystore` pour permettre la mise à jour sans désinstallation sur les appareils de Céd. Ne jamais committer de `.keystore`, `.jks` ou `keystore.properties`.
   - **Garde du certificat (P2-18)** : `~/.android/debug.keystore` est la clé de signature de **toutes** les versions livrées. Sa perte interdit toute mise à jour sans désinstallation (donc sans effacer les données). En conserver une copie de sauvegarde hors de la machine et ne jamais la régénérer.
   - **Un seul APK de référence à la racine** : le fichier `CedPlay-<version>.apk` livré, plus la copie `CedPlay.apk`. Supprimer les anciens APK au lieu de les accumuler (les mises à jour ne peuvent de toute façon pas rétrograder un `versionCode`).
4. **Sécurité et secrets** :
   - Les clés API (`tmdbApiKey`, `deeplApiKey`, `openSubtitlesApiKey`, `subdlApiKey`) et `parentalPin` sont masquées dans le journal de réglages (`src/utils/redact.ts`).
   - Le PIN parental est stocké haché (`sha256:<sel>:<empreinte>` via `src/utils/pinHash.ts`, plafond `MAX_PARENTAL_PIN_LENGTH = 128`). Ne jamais réduire la taille maximale du champ `parentalPin` sous 128 caractères dans `storage.ts`.
   - Le relais de développement `application/proxy-server.mjs` (port 5179) n'accepte que l'origine Vite (`http://127.0.0.1:5178`, surchargeable via `IPTV_PROXY_ALLOWED_ORIGINS`) et refuse les cibles locales ou privées sur `/proxy?url=` (anti-SSRF). Ne pas relâcher ces gardes.
5. **Preuve avant affirmation** :
   - Distinguer explicitement ce qui est prouvé par les tests automatisés / le build local de ce qui a été réellement testé sur appareil physique (`adb`, téléphone, box Android TV) ou sur un flux IPTV réel.

---

## 3. Entretien du suivi après une session

Après toute session modifiant l'état du projet :
1. Mettre à jour [CURRENT_MISSION.md](CURRENT_MISSION.md) (ajouter une section datée sans effacer l'historique).
2. Mettre à jour la fiche de référence [CedPlay.md](C:/Users/C2k/Documents/Second%20Cerveau/10%20Projets/CedPlay.md) dans le Second Cerveau (`Où j'en suis`, `Pour reprendre`, et métadonnées d'en-tête), puis exécuter :
   ```powershell
   python D:\AIOS\outils\entretien.py actualiser
   python D:\AIOS\outils\entretien.py verifier
   python D:\AIOS\outils\entretien.py sonder
   ```
