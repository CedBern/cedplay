# Guide des Sous-titres & Traduction Automatique

## Vue d'ensemble

Le lecteur IPTV dispose désormais d'un système complet de gestion des sous-titres :
1. **Recherche externe multi-sources** (sans quota bloquant ni clé obligatoire).
2. **Priorité stricte des langues** :
   - **1ʳᵉ priorité** : Français (`FR`).
   - **2ᵉ recours** : Anglais (`EN`) et Espagnol mexicain / latino (`ES-MX` / `ES-419`).
3. **Conversion / Traduction automatique en Français** :
   - Si aucun sous-titre officiel français n'est disponible pour un film ou un épisode, le lecteur télécharge automatiquement la meilleure piste VO (anglais ou espagnol) et la traduit en français en **2 à 4 secondes**.
   - Le sous-titre traduit est conservé dans le cache local (IndexedDB) pour être disponible instantanément lors des prochains visionnages.
4. **Réglage du décalage temporel (+/-)** :
   - Boutons de synchronisation rapide (`-1.0s`, `-0.5s`, `0s`, `+0.5s`, `+1.0s`) pour corriger en un tap les éventuels décalages d'intro des flux IPTV.

---

## Fonctionnement dans l'application

### 1. Sur une fiche de Film ou d'Épisode (Onglets Films et Séries)
Quand vous ouvrez un film ou un épisode :
- Un encart **💬 Sous-titres** analyse immédiatement le média.
- **Si du français existe déjà** (en cache ou en ligne) : un badge vert `Français prêt` apparaît. Dès que vous appuyez sur « Regarder », les sous-titres français sont chargés automatiquement.
- **Si le français n'existe pas** :
  - Un encart bleu vous informe que seule la VO (anglais ou espagnol) est disponible.
  - Le système peut soit traduire automatiquement, soit vous proposer le bouton **⚡ Traduire en FR** (traduction par lots en 2 à 4 secondes avec barre de progression).
- **Pour choisir une autre version ou ajuster la synchro** :
  - Cliquez sur **« Choisir / Régler »** pour ouvrir le panneau déroulant.
  - Vous pouvez tester un décalage de temps ou choisir manuellement une piste parmi la liste trouvée.

### 2. Pendant la lecture
- **Sur Android (Lecteur Natif ExoPlayer)** :
  - Le fichier de sous-titres (qu'il soit téléchargé ou traduit automatiquement) est injecté directement dans le lecteur.
  - ExoPlayer est pré-configuré pour sélectionner la langue française en priorité sur les pistes internes et externes.
  - Vous pouvez activer/désactiver ou changer de piste avec l'icône de sous-titres dans la barre de contrôle.
- **Sur PC / Navigateur (Lecteur Web)** :
  - La piste est injectée sous forme de piste WebVTT synchronisée.

---

## Paramètres personnalisés (Roue crantée ⚙️)

Dans **Paramètres** → rubrique **Sous-titres & Traduction automatique** :
- **Recherche automatique** : activée par défaut.
- **Traduction automatique vers le français** : activée par défaut.
- **Clé API DeepL (facultatif)** : si vous possédez une clé DeepL Free ou Pro, vous pouvez la renseigner pour une traduction via DeepL. Sinon, le moteur gratuit intégré sans clé fonctionne immédiatement.
- **Clé API OpenSubtitles v3 (facultatif)** : si vous possédez un compte OpenSubtitles personnel. Par défaut, la passerelle intégrée n'exige aucune clé.
