# Reprise du lecteur IPTV personnel — 3 novembre 2026

Le projet est récupérable. La meilleure matière première est un ensemble de sources enrichies en 2025, complété par des fichiers de configuration retrouvés dans une autre sauvegarde. Il existe aussi une archive ancienne autonome et un historique Git valide. La copie reconstituée n'est pas encore une application validée.

## Ce qui a été retrouvé

| Élément | Constat vérifié | Copie locale |
|---|---|---|
| Sources enrichies | 103 fichiers sous `src`, dont 10 fichiers de tests ; six fichiers publics | `sources-retrouvees/src` et `sources-retrouvees/public` |
| Configurations et documentation | 20 fichiers complémentaires, dont manifeste de dépendances, verrou pnpm, configurations Vite/Vitest/TypeScript et serveur relais | Racine de `sources-retrouvees` |
| Archive ZIP ancienne | 2 242 944 octets ; 72 fichiers source ; 93 fichiers applicatifs extraits | `sauvegardes/IPTV M3U Reader Guide.zip` et `version-historique-zip` |
| Historique Git | Trois commits ; dernier `3f1e7baef4bc4bb332820e05c34afd4050161122`, daté du 23 août 2025 ; tags `v1` et `v2` | `sauvegardes/historique-git.bundle` ; intégrité vérifiée par Git |
| Documentation de présentation | Document Word « Projet lecteur iptv.docx » dans l'export Drive sur D: ; texte déjà extrait dans le Second Cerveau | Original conservé sur D: |
| Playlists | Une liste de 202 485 entrées EXTINF sur G:, une autre de 82 937 entrées sur E:, une petite liste personnalisée de 12 entrées | Inventaire sans URL dans `inventaire-playlists.json` ; originaux conservés sur leurs disques |

Les 129 fichiers de la copie enrichie représentent 753 830 octets. Chaque fichier copié est contrôlé par SHA-256 ; sa provenance est enregistrée dans `inventaire-recuperation.json`. Les deux versions sont séparées ; aucune modification du code original n'a été effectuée.

Les sources enrichies les plus récentes portent une date de fichier du 12 septembre 2025. Cela ne constitue pas une preuve d'exécution à cette date. Le ZIP conserve des sources datées principalement du 23 août 2025. Les trois emplacements ci-dessous sont complémentaires ou divergents, et ne constituent pas trois copies complètes identiques.

## Emplacements originaux

- Sources : `G:\06_ARCHIVES_ET_BACKUPS\Archives Diverses\Downloads_Backup\IPTV M3U Reader Guide\workspace\shadcn-ui`.
- Configuration enrichie, documentation, Git, anciens assemblages et versions intermédiaires : `G:\06_ARCHIVES_ET_BACKUPS\Sauvegardes Systemes\C_Drive_Backup\Downloads\IPTV M3U Reader Guide`.
- Autre configuration ancienne : `G:\04_DOCUMENTS_ADMIN_ET_PERSO\Projets Personnels\IPTV M3U Reader Guide\workspace\shadcn-ui`.
- ZIP : `G:\06_ARCHIVES_ET_BACKUPS\Sauvegardes Systemes\C_Drive_Backup\Downloads\Autre\IPTV M3U Reader Guide.zip`.
- Présentation Word : `D:\GDRIVE_TAKEOUT\extrait\Takeout\Drive\📦 13. Vrac (À trier)\AUTRE\Projet lecteur iptv.docx`.

## Ce qui mérite d'être conservé

La base React 18 / TypeScript / Vite avec Tailwind et shadcn est exploitable. Le code contient réellement :

- import de listes M3U depuis un fichier ou une URL ; parsing synchrone et progressif ;
- regroupement des chaînes, fusion des variantes de qualité, recherche et favoris ;
- stockage IndexedDB des listes, paramètres, historique et dernière chaîne ;
- lecteur avec HLS, contrôles de qualité, télémétrie et tentatives de reprise ;
- export des listes, composants de diagnostic et navigation au clavier ;
- un fichier de Web Worker dédié au parsing, dont l'utilisation effective dans le parcours courant reste à raccorder ou à confirmer.

La description Word est plus optimiste que l'état réel : les composants et tests présents ne prouvent pas que l'application complète fonctionne.

## Blocages et défauts prioritaires

| Priorité | Constat | Conséquence / correction proposée |
|---|---|---|
| 1 | Les dépendances exécutables ne sont pas installées dans la copie reconstituée. Les anciennes installations réparties sur G: sont incomplètes aux points d'entrée vérifiés. | Réinstaller depuis un manifeste/verrou cohérent dans une copie de travail, puis exécuter compilation, contrôle TypeScript et tests. |
| 1 | `src/pages/Index.tsx` appelle plusieurs composants selon d'anciennes signatures : `ChannelList` attend des groupes, `IPTVPlayer` est désormais une application complète sans ces propriétés, `ConfigurationManager` attend des paramètres et un callback différents, et le hook clavier attend une liste. | Restaurer un point d'entrée cohérent, en s'appuyant sur le ZIP où `Index` affiche simplement `<IPTVPlayer />`, puis réintégrer les évolutions utiles. |
| 1 | `SettingsPanel` est utilisé dans `IPTVPlayer.tsx`, alors que sa déclaration/import est commentée et que le fichier manque. Un test l'importe également. | Reconstituer le panneau ou retirer proprement ses appels et adapter les tests ; ne pas simplement masquer les erreurs. |
| 1 | `corsProxy.ts` envoie des URL à plusieurs relais publics ; le parseur et le chargeur affichent aussi des URL et extraits de listes dans les journaux. | Retirer les relais publics automatiques ; masquer les identifiants ; utiliser un éventuel relais personnel explicitement choisi. Aucune URL privée n'a été testée en ligne pendant cet audit. |
| 1 | Le relais local fourni écoute sans adresse de boucle locale explicite et accepte des cibles arbitraires ; sa reconstruction d'origine emploie `hostname`, ce qui perd les ports personnalisés. | Revoir le relais avant de le lancer : écoute locale, cibles/protocoles bornés, conservation du port, délais et limites de réponse ; si lecture HLS relayée, traiter aussi les chemins des segments et des clés. |
| 2 | Les identifiants de chaînes redémarrent à `channel_1` dans chaque import et dépendent de l'ordre. Les favoris sont stockés dans une liste globale d'identifiants. | Créer des identifiants stables, associés à la source ; prévoir une migration des favoris. Deux défauts du parseur ont été reproduits à ce sujet. |
| 2 | Dans `useVideoPlayer`, l'effet dépend de `volume` et son nettoyage détruit l'instance HLS. Les callbacks de reprise utilisent aussi un compteur capturé lors de leur création. | Séparer cycle de vie du lecteur et volume ; rendre les reprises bornées et annulables, puis tester changement de chaîne, volume, arrêt et erreurs successives. Ce constat est statique, sans essai vidéo. |
| 2 | HLS est chargé depuis `hls.js@latest`, sans traitement de l'échec de chargement du script. | Installer une version déterminée dans le projet et afficher une erreur exploitable en cas d'échec. |
| 3 | `epgGenerator.ts` génère des programmes aléatoires. | Présenter ce contenu comme une démonstration ou le remplacer par un véritable import XMLTV ; ne pas afficher ces titres comme des programmes réels. |

## Vérifications effectuées et limites

- Recherche de noms de fichiers et dossiers sur les zones utilisateur/projets/archives accessibles de C:, D:, E: et G:. Les répertoires système, certaines dépendances et caches volumineux étaient exclus. Les archives compressées n'ont pas toutes été ouvertes ; le ZIP IPTV retrouvé a été inspecté.
- `G:\Users\USER` est inaccessible. Ses droits n'ont pas été modifiés. Cette recherche n'est donc pas exhaustive et n'est pas une récupération de fichiers supprimés.
- Copie des sources et de l'archive avec contrôle des empreintes ; sauvegarde des trois commits dans un bundle Git déclaré complet et valide par Git.
- Quatre diagnostics isolés du parseur réussis : regroupement des variantes, parité synchrone/progressive, BOM avec fins de ligne Windows, nettoyage du nom de chaîne.
- Deux diagnostics supplémentaires reproduisent des défauts : collision d'identifiants entre listes et changement d'identifiant après insertion en tête. Leur statut « PASS » dans le fichier de diagnostic signifie que le défaut recherché a été observé.
- Pour ces six diagnostics, le TypeScript a été effacé en mémoire par Node et la génération UUID a été substituée par `crypto.randomUUID`. Aucun appel réseau. Ce n'est pas l'exécution de la suite Vitest d'origine.
- Tentatives de compilation et de suite de tests dans la copie reconstituée : bloquées respectivement par l'absence des commandes locales Vite et Vitest. Aucun résultat de compilation ou de suite complète n'est revendiqué.
- Les anciens assemblages et captures retrouvés sont des preuves historiques, pas une validation actuelle. Aucune lecture audiovisuelle, compatibilité TV, persistance réelle dans un navigateur ou validité d'abonnement n'a été vérifiée.

## Amélioration conseillée

1. **Obtenir une version locale simple qui lit réellement une chaîne.** Garder la base React, unifier le point d'entrée, rétablir les paramètres essentiels et installer proprement les dépendances. Valider sur une liste synthétique puis sur des flux de test adaptés.
2. **Fiabiliser l'usage quotidien.** Zapping, volume, plein écran, reprise après coupure, favoris stables et sauvegarde/restauration complète des données. La fonction `createFullBackup` actuelle exporte surtout les paramètres et les métadonnées, sans les playlists et favoris.
3. **Rendre les grosses listes utilisables.** Avec les inventaires retrouvés de 82 937 et 202 485 entrées, mesurer l'import et le filtrage, raccorder le Worker si nécessaire, préserver la liste virtuelle et limiter les journaux.
4. **Simplifier l'interface.** Une liste de chaînes persistante, des favoris immédiatement accessibles, une recherche visible, un lecteur central et les diagnostics dans un panneau secondaire. Uniformiser les textes français/anglais et vérifier le focus clavier, notamment dans les champs de recherche.
5. **Ajouter le guide TV réel et choisir ensuite les appareils cibles.** Commencer par l'ordinateur. Une éventuelle application Windows ou TV constitue une étape séparée avec essais sur le matériel concerné.

Un lecteur web reste soumis aux règles CORS et aux capacités vidéo de son navigateur. HLS.js précise les exigences de compatibilité et de CORS : conserver la base web est un choix raisonnable, mais la compatibilité de chaque type de flux doit être vérifiée. Un emballage bureau ne garantit pas à lui seul la lecture de tous les formats.

Références techniques consultées le 3 novembre 2026 : [HLS.js, documentation officielle](https://github.com/video-dev/hls.js/blob/master/README.md), [CORS, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), [versions WebView de Tauri](https://v2.tauri.app/reference/webview-versions/).

La prochaine étape utile est de créer une copie de travail à partir des sources préservées, puis de corriger les blocages d'intégration avant d'ajouter des fonctionnalités.
