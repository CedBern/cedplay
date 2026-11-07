# Navigation supérieure — audit et correction

Date : 3 novembre 2026, Mérida. Périmètre : en-tête et navigation de la copie active `application/`. Support : capture fournie par l’utilisateur, code React/Tailwind et inspection du WebView sur Motorola Edge 70. Ce document ne constitue pas un audit complet de l’application ni une certification WCAG.

## Diagnostic

### [MAJEUR] Contenus et outils mélangés

- Catégorie : UX, hiérarchie. Composant : `IPTVPlayer.tsx`.
- Constat : Direct, Lecteur, Ajouter, Mosaïque, Films, Séries sont six onglets de même poids, disposés sur deux rangées sur téléphone. Le lecteur est une vue d’une chaîne et Ajouter est une action de gestion.
- Impact : les destinations de visionnage sont dispersées ; le regroupement ne donne pas de modèle prévisible.
- Correction (M) : quatre rubriques stables **Direct → Films → Séries → Mosaïque** ; le lecteur devient une vue du Direct ; gestion des listes séparée.

### [MAJEUR] En-tête dominé par quatre outils sans libellé visible sur mobile

- Catégorie : UX, craft, accessibilité. Composants : en-tête et `BackupPanel.tsx`.
- Constat : sauvegarde, export, import et paramètres sont présentés comme quatre icônes à côté d’un identifiant de compte tronqué.
- Impact : encombrement de l’en-tête et nécessité de deviner les actions.
- Correction (S) : bouton nommé **Mes listes**, paramètres toujours accessibles ; import, sauvegarde et export réunis dans la page de gestion. Les sauvegardes ont un nom accessible et un libellé visible dans cette page. Le nom de compte reste disponible dans la gestion et sur grand écran, il n’occupe plus l’en-tête mobile.

### [MINEUR] État actif et rythme peu structurés

- Catégorie : craft, responsive. Composants : nouvelle primitive `MainNavigation.tsx` et en-tête du Direct.
- Constat : la grille à six éléments force deux rangées ; le compteur rallonge le premier onglet ; le grand titre des chaînes domine la navigation.
- Correction (S) : une seule rangée de quatre cibles égales, icône et texte, fond sombre stable et accent violet pour la rubrique active. Compteur placé sous « Chaînes en direct » ; bouton Lecteur dans ce même en-tête. Tailles issues de l’échelle Tailwind existante, sans nouveau thème global.

## Organisation livrée

- **Direct** : liste et filtres existants ; accès au lecteur de la chaîne sélectionnée ; retour à la liste par « Chaînes » ou en touchant Direct. Direct reste actif pendant la vue Lecteur.
- **Films / Séries / Mosaïque** : mêmes fonctions, destinations regroupées dans cet ordre.
- **Mes listes** : listes existantes, importation, sauvegarde et exportation. Retour à la rubrique d’origine. La navigation principale reste visible et permet de quitter directement cette gestion.
- **Paramètres** : bouton séparé conservé.

## Vérifications

- 88/88 tests dans 19 fichiers ; nouveau cas de navigation : lecteur dans Direct, clic de Direct depuis ce lecteur, retour aux chaînes, Films → Mes listes → Retour. Pas de requête privée dans ce test.
- TypeScript, Vite, synchronisation Capacitor et assemblage Android réussis.
- Menu constaté dans l’application installée : quatre onglets **Direct, Films, Séries, Mosaïque**, largeur environ 92 px CSS chacun et hauteur 56 px sur cet appareil.
- Mesures WebView avec largeurs émulées, données réelles déjà chargées : **320, 360, 768 et 1 280 px**, onglets sur une ligne, texte non coupé et absence de débordement de l’en-tête. Preuve : `preuves/menu-1.1.1-responsive.json`. À 320 px, chaque cible mesure 70,5 × 56 px ; tablette/desktop : hauteur 48 px. L’émulation a été retirée après les mesures.
- Contrastes calculés : blanc sur violet Tailwind 700 **6,98:1** ; slate-300 sur le fond de navigation composé, avec la portion la plus claire du dégradé existant, **12,13:1**. Ces calculs concernent la navigation, pas les autres contrôles de la page.
- Le téléphone reçoit des notifications et est utilisé en parallèle : les captures complètes transitoires comportant des notifications ou un autre écran ont été retirées. Les mesures DOM conservées ne contiennent pas d’identifiants de compte.
- Pas de nouvelle validation exhaustive de la vidéo, de l’EPG, des filtres ni de toute l’accessibilité de l’application dans cette intervention.

## Appréciation limitée à la navigation

| Catégorie | Avant /5 | Après /5 | Base de jugement |
|---|---:|---:|---|
| Hiérarchie et parcours | 2 | 4 | Contenus regroupés, outils séparés, retours testés |
| Cohérence visuelle | 3 | 4 | Même palette et mêmes primitives, quatre cibles régulières |
| Lisibilité et accès tactile | 3 | 4 | Noms visibles, contrastes calculés, cibles mesurées |
| Responsive | 2 | 4 | Une ligne vérifiée aux quatre largeurs |

Ces notes expriment une appréciation de conception, pas une mesure utilisateur. Priorités traitées : regroupement des destinations, séparation des outils, puis finition du menu. Identité sombre et violette conservée. Aucun changement du moteur de lecture.

## Livraison

Version Android **1.1.1 / code 5**. APK racine : `Lecteur-IPTV.apk`. Sauvegarde des composants, du manifeste de version, de la mission et de l’APK précédent dans `sauvegardes/menu-superieur-2026-11-03/`. Les contrôles de signature, d’intégrité et d’installation sont consignés dans `CURRENT_MISSION.md`.
