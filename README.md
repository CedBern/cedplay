# CedPlay 🎬📺

<p align="center">
  <img src="identite/cedplay/cedplay-icon.svg" alt="CedPlay Logo" width="128" height="128" />
  <br>
  <strong>Lecteur multimédia moderne pour IPTV, Direct TV, Films et Séries</strong>
  <br>
  <em>Optimisé pour Android, Google TV et Web</em>
</p>

---

## 🌟 Présentation

**CedPlay** est une application personnelle de lecture multimédia fluide et moderne, spécialement conçue pour profiter du streaming en direct et à la demande sur téléviseurs connectés (Android TV / Google TV), smartphones, tablettes et navigateurs web.

---

## 🚀 Fonctionnalités principales

- **Direct TV & Aperçu en direct** : Navigation rapide dans les chaînes avec aperçu vidéo instantané (ExoPlayer sous Android / HLS.js sur le web) avant de basculer en plein écran.
- **Guide des programmes (EPG)** : Consultation claire des programmes en cours et à venir.
- **Films & Séries (VOD)** : Navigation par genres et catégories avec recherche temps réel.
- **Fiches de films enrichies (TMDb)** :
  - Affiches haute définition et arrière-plans
  - Synopsis complet en français
  - Année de sortie, durée, genres et casting détaillé
  - Notes des spectateurs, avis et films similaires
- **Navigation optimisée Télécommande (TV)** : Interface 3 colonnes pensée pour la télécommande (flèches directionnelles, touche Retour, focus fluide).
- **Compatibilité multi-sources** : Prise en charge des playlists M3U / M3U8 et des API Xtream Codes.
- **Sous-titres & Accessibilité** : Support des pistes de sous-titres intégrées et recherche externe.
- **Picture-in-Picture (PiP)** : Réduction du lecteur en vignette flottante pour continuer le visionnage.
- **Contrôle parental** : Verrouillage des catégories sensibles par code PIN configurable.

---

## 🛠️ Stack technique

- **Frontend** : [React 18](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), [Lucide Icons](https://lucide.dev/)
- **Build tool** : [Vite](https://vitejs.dev/)
- **Moteur vidéo** : [ExoPlayer](https://exoplayer.dev/) (Android natif), [HLS.js](https://github.com/video-dev/hls.js/), [MPEGTS.js](https://github.com/xqq/mpegts.js)
- **Runtime multi-plateforme** : [Capacitor 6](https://capacitorjs.com/)
- **Métadonnées cinéma** : API [The Movie Database (TMDb)](https://www.themoviedb.org/)

---

## 💻 Démarrage rapide

### Prérequis
- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)
- Pour la compilation Android : JDK 17 et Android SDK (Android Studio)

### Lancement en mode développement Web
Double-cliquez sur `Lancer le lecteur.cmd` ou exécutez dans un terminal :

```bash
cd application
pnpm install
pnpm dev
```
L'application est accessible sur `http://127.0.0.1:5178/`.

### Construction du package Android (APK)
Double-cliquez sur `Construire l'APK.cmd` ou exécutez :

```bash
cd application
pnpm build
pnpm exec cap sync android
cd android
./gradlew assembleRelease
```
L'APK généré sera copié à la racine du projet sous le nom `CedPlay.apk`.

---

## 📄 Licence et mentions TMDb

Ce projet est un développement personnel sous licence open-source.

> [!NOTE]  
> Ce produit utilise l'API TMDb mais n'est ni certifié ni approuvé par TMDb.  
> *This product uses the TMDB API but is not endorsed or certified by TMDB.*
> 
> Pour plus d'informations, visitez [themoviedb.org](https://www.themoviedb.org/).
