# Revue indépendante du projet — 4 novembre 2026

## Avis

Les évolutions depuis 1.1.1 apportent une valeur réelle : thème noir plus sobre, navigation conservée, application nettement allégée, import M3U dans un worker, guide XMLTV avec grille, zapping et enrichissement VOD. Le choix de garder les recommandations locales convient à une application personnelle.

La priorité devrait être une version de fiabilisation avant une nouvelle série de fonctionnalités. Les tests existants passent, mais plusieurs cas aux limites et raccordements entre composants restent incorrects. Les recommandations sont pour l'instant fondées sur les catégories du fournisseur et des mots communs aux titres : leur présence ne prouve pas leur pertinence.

Pas de Git ni de journal permettant d'attribuer sûrement chaque changement à Claude ou DeepSeek : cette revue porte sur leur résultat cumulé, sans attribution individuelle inventée.

## Vérification reproduite

- TypeScript : réussi.
- Suite existante : **106 tests passés, 23 fichiers**, aucun échec ni test ignoré signalé.
- Construction Vite isolée dans `preuves/revue-2026-11-04/dist/` : réussie. JS principal **606,20 kB** avant gzip, **185,38 kB** gzip. HLS, MPEG-TS et graphiques dans des fichiers séparés.
- Gradle `assembleRelease` : réussi, avec cache incrémental (111 tâches à jour, 1 exécutée).
- APK racine : **1.4.0 / code 8**, **6 875 667 octets**, SHA-256 `491D46DF8F33300B421B1E25DA90914FBFE951DFD2FDBB92E2B2509011EDB3B6`.
- Signature APK v1/v2 revérifiée ; certificat SHA-256 `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`, identique au certificat précédent.
- Les **19 fichiers web reconstruits** correspondent octet par octet aux ressources web de l'APK. Détail : `preuves/revue-2026-11-04/apk.json`.
- **Huit cas de diagnostic supplémentaires reproduisent les défauts décrits ci-dessous**, avec données locales et IndexedDB en mémoire. Ils sont volontairement séparés de la suite d'acceptation : leurs assertions décrivent les défauts actuels, pas un comportement souhaité. Code et résultats : `preuves/revue-2026-11-04/constats.test.tsx`, `constats.json` et `vitest.config.mjs`.
- Téléphone absent de la liste ADB pendant la revue : **pas de nouvelle validation physique ni d'installation**. Aucune requête vers l'abonnement ou TMDB réel pendant cette revue ; pas de clé personnelle nécessaire aux diagnostics. Le rendu du nouveau thème et de la grille sur téléphone reste à observer.
- Code fonctionnel et APK racine conservés. Cette passe ajoute seulement les preuves et le rapport.

## Défauts et limites à traiter

| Priorité | Constat | Conséquence | Vérification et correction conseillée |
|---|---|---|---|
| Haute | `utils/epgXmltv.ts:97-99` filtre le passé puis conserve les **200 derniers** programmes. | Avec 300 programmes futurs, les 100 premiers, dont le programme en cours, disparaissent. Les jours précédents proposés par la grille sont aussi supprimés en amont. | Deux diagnostics reproduits. Définir une fenêtre temporelle cohérente avec la grille ; conserver en priorité les programmes autour de maintenant. |
| Haute | `hooks/useEPG.ts:18` laisse les données à `undefined` si aucune source n'existe ou si le chargement échoue sans cache ; `EPGGrid.tsx:73` interprète toujours cette valeur comme un chargement. | « Chargement du guide… » peut rester indéfiniment, sans erreur ni action utile. | Diagnostic reproduit sans source. Retourner un état explicite : chargement, prêt, absent, erreur, cache périmé ; proposer Réessayer/configurer. |
| Haute | `titleNormalize.ts:19-36` confond des nombres du titre avec l'année ; `tmdb.ts:178-180` accepte une simple inclusion entre titres. | « 1917 » et « 2012 » deviennent des titres vides avec une mauvaise année ; « Avatar » peut être associé à « Avatar 2 » si c'est le résultat disponible. | Deux diagnostics reproduits. Privilégier l'identifiant TMDB fournisseur quand disponible ; distinguer année de métadonnée et nombre du titre ; refuser les suites/remakes ambigus et autoriser une correction manuelle. |
| Moyenne | `idb.ts:200-202` mélange direct et VOD dans les 50 dernières entrées ; `recommendations.ts:26` prend toute la VOD, séries et autres listes comprises. | Cinquante chaînes distinctes effacent l'historique films ; une catégorie de série ou d'un autre compte peut favoriser des films sans rapport. Un simple lancement est assimilé à un titre vu. | Deux diagnostics reproduits. Historique distinct par liste et type de média ; états commencé/terminé ; exclusion fondée sur l'identité de l'œuvre plutôt que son seul nom. |
| Moyenne | Le rafraîchissement reparcourt la M3U avec `Liste — hostname` (`IPTVPlayer.tsx:158`) alors que les identifiants de chaînes dépendent du nom utilisé au parsing (`m3uParser.ts:148`). | Une ancienne liste issue d'un autre nom de parsing peut perdre le raccordement à ses favoris et variantes lors de sa première actualisation. | Diagnostic sur l'identité reproduit ; parcours complet de rafraîchissement non exécuté. Réutiliser une identité de source stable et migrer les références existantes. La déduplication sans URL par simple nom (`IPTVPlayer.tsx:86`) peut aussi remplacer deux fichiers distincts de même nom. |
| Moyenne | Le raccourci natif dans les cartes appelle `open(url, name)` sans contexte de zapping (`ChannelList.tsx:364,404`). Le contexte n'est transmis que depuis `VideoPlayer`. Le retour natif ne transmet pas la dernière chaîne zappée au web. | L'utilisateur obtient des commandes différentes selon son point d'entrée ; au retour, la liste et la reprise restent sur l'ancienne chaîne. | Constat par lecture des appels TS/Java, pas essai physique. Unifier le lancement et retourner l'identité de la chaîne finale. Les listes de plus de 2 000 chaînes perdent également le zapping natif par la borne du plugin. |
| Moyenne | Le guide est chargé une fois par identité de liste, sans renouvellement périodique (`useEPG.ts:27`). Le cache de catalogue complet appartient à une instance de `VodLibrary` (`:67`) qui est démontée au changement d'onglet. | Longue session : guide potentiellement périmé. Revisites VOD : catalogue complet potentiellement retéléchargé malgré le commentaire « évite de retélécharger à chaque visite ». | Lecture du cycle de vie. Cache partagé borné, clé incluant la source, actualisation explicite/périodique et affichage de la date du guide. Mesurer les coûts sur le vrai catalogue avant d'optimiser davantage. |

Le téléchargement et le parsing du XMLTV complet passent encore par la mémoire du WebView ; la grille rend toutes ses lignes et tous leurs programmes. L'import M3U en worker ne corrige pas ce coût EPG. Une source très volumineuse justifierait parsing hors interface et virtualisation, après mesure sur le téléphone.

Le chiffre de revenu mondial TMDB est correctement nommé dans l'interface : il ne faut pas le présenter comme un nombre d'entrées au cinéma. Les avis spectateurs ne sont pas des critiques de presse.

## Propositions par valeur d'usage

| Ordre proposé | Fonction | Résultat concret | Ampleur estimée |
|---|---|---|---|
| 1 | **Continuer à regarder** | Une rangée films/épisodes avec barre de progression, reprise directe, « Retirer » et « Marquer comme vu ». Retrouver aussi l'épisode en cours sans rouvrir les saisons. | Moyenne : positions déjà mémorisées, index de médias à compléter. |
| 2 | **Ma liste** | Mettre un film ou une série de côté ; filtres « À voir », « En cours », « Terminés ». | Faible à moyenne. |
| 3 | **Épisode suivant** | Bouton à la fin, compte à rebours annulable, lecture automatique réglable, mémorisation de la langue et des sous-titres. | Moyenne à importante : raccordement au lecteur natif et à la file d'épisodes. |
| 4 | **Mosaïques enregistrées** | Retrouver une composition « Sport », « Infos » ou personnelle ; remplacer une seule case, afficher son nom et signaler laquelle a le son. | Moyenne ; le remplacement individuel demande du travail natif. |
| 5 | **Guide TV adapté au mobile** | Filtrer les favoris/groupes, réduire la largeur des noms sur petit écran, fiche de programme, indicateur de fraîcheur et rappel avant une émission. | Moyenne ; notifications à intégrer pour les rappels. |
| 6 | **Petite fenêtre vidéo Android (PiP)** | Continuer une chaîne ou un film dans un coin de l'écran pendant l'utilisation d'une autre application. | Moyenne ; ajuster le cycle de vie existant qui libère actuellement le lecteur à `onPause`. |

Ces ampleurs sont des estimations de revue, pas des engagements de délai. Android fournit un mode PiP adapté à cet usage ; son intégration demande de conserver la lecture lors de la transition et de gérer correctement le retour ([documentation Android](https://developer.android.com/develop/ui/views/picture-in-picture)).

Pour améliorer « Pour toi » ensuite : favoris/« pas intéressé », genres et réalisation TMDB, exclusion des œuvres terminées, diversité des propositions et courte explication (« Parce que tu as aimé… »). Les catégories larges du fournisseur, par exemple une catégorie nationale, ne suffisent pas à décrire les goûts.

Replay, retour au début du direct et enregistrement seraient des chantiers distincts : vérifier d'abord les possibilités réelles du fournisseur, le stockage et les conditions de lecture simultanée. Leur disponibilité ne se déduit pas de la mosaïque à huit chaînes.

Si les fiches TMDB sont conservées, ajouter dans « À propos » l'attribution avec logo et notice demandée par la [FAQ officielle TMDB](https://developer.themoviedb.org/docs/faq). L'actuel simple titre « Fiche TMDB » ne couvre pas ces éléments.

## Séquence conseillée

1. **1.4.1 : fiabilisation** des six premiers constats, puis essai physique du guide, zapping par les deux points d'entrée, fiche de film, lecture d'épisode et reprise.
2. **Confort VOD : Continuer à regarder + Ma liste**, avec persistance et restauration testées.
3. **Épisode suivant**, puis mosaïques enregistrées ou PiP selon l'usage quotidien.

Conserver les quatre rubriques principales actuelles : ces fonctions trouvent leur place dans Direct, Films, Séries et Mosaïque, sans rajouter de nouveaux onglets supérieurs. Mettre le projet sous gestion de versions locale aiderait également à comparer et préserver les contributions des différentes IA ; cela reste une proposition, aucun dépôt créé pendant cette revue.
