# Guide — Accès aux plateformes de streaming officielles

## Ce qui est fourni

Une rubrique **« Streaming »** dans le lecteur qui donne accès, en un tap, aux
**plateformes de streaming officielles** :

| Plateforme | Accès | URL officielle |
|---|---|---|
| YouTube | Gratuit | youtube.com |
| Netflix | Abonnement | netflix.com |
| Prime Video | Abonnement | primevideo.com |
| Max (ex HBO Max) | Abonnement | max.com |
| Apple TV+ | Abonnement | tv.apple.com |
| Disney+ | Abonnement | disneyplus.com |
| Canal+ | Abonnement | canalplus.com |
| Paramount+ | Abonnement | paramountplus.com |
| Twitch | Gratuit | twitch.tv |
| Molotov | Gratuit (option payante) | molotov.tv |

Chaque carte « Ouvrir » lance :
- sur **Android** : l'application officielle si elle est installée (deep link), sinon le navigateur ;
- sur **PC** : le site officiel dans un nouvel onglet.

## Principes (légalité)

- **Aucun flux piraté, aucun contournement de DRM ni d'abonnement** : la lecture et
  l'authentification se font directement sur la plateforme officielle.
- On ouvre uniquement le site/application du diffuseur via `ACTION_VIEW` (même mécanisme
  `openWeb` que la rubrique Replay) — jamais une API privée rétro-ingéniérée.

## Fichiers

- `application/src/components/StreamingPanel.tsx` — l'interface de la rubrique.
- `application/src/data/streamingPlatforms.ts` — la liste des plateformes + URL officielles.
- `application/src/utils/nativePlayer.ts` + `NativePlayerPlugin.java` — méthode native `openWeb`.
- `application/src/components/MainNavigation.tsx` + `IPTVPlayer.tsx` — ajout de l'onglet (6ᵉ).
