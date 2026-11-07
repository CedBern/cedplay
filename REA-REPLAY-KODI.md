# État de l'art — Replay français (TF1, M6, France TV, Arte) sur Kodi

> Objectif : documenter, à la demande de l'utilisateur, comment les dépôts/addons
> Kodi réalisent le replay (catch-up) français, afin de déterminer ce qui est
> réellement intégrable **proprement** dans le lecteur IPTV.

## 1. Le projet de référence

**CatchUp TV & More** — `Catch-up-TV-and-More/plugin.video.catchuptvandmore`
- Licence **GPL v2**, ~337 stars, **toujours actif** (derniers commits oct. 2026).
- Regroupe le direct **et** le replay de centaines de chaînes/sites, dont la France.
- C'est le point de référence technique pour « comment faire du replay français ».

## 2. Ce que fait réellement l'addon pour la France

| Chaîne(s) | Replay | Mécanisme / API réellement utilisée | Verrous |
|---|---|---|---|
| TF1, TMC, TFX, TF1 Séries Films | ✅ | API privée **mytf1** (token + flux signés) | **DRM Widevine** (bascule confirmée issue #405), tokens rotatifs |
| M6, W9, 6ter, Gulli | ✅ | API privée **6play** + recherche **Algolia** (clés d'API codées en dur) | **compte 6play requis**, DRM |
| France 2, 3, 4, 5, franceinfo, Okoo, Slash | 🔧 (beta) | API interne **`api-mobile.yatta.francetv.fr`** / **`api-front.yatta.francetv.fr`** | non documentée, **DRM** |
| Arte (FR/DE/EN/ES/PL/IT) | ✅ | `api.arte.tv/api/player/v2/config/<lang>/<id>` + `opa/v3/videoStreams` avec **Bearer token** (récupéré dans `static-cdn.arte.tv/.../general.json`) | token du player web, géo-restrictions |
| Autres (BFM TV, CNews, CStar, C8, L'Équipe, RMC, NRJ12, Lumni…) | ✅ | APIs privées diverses | comptes (NRJ), DRM, fragilité |

Dépendance historique : `script.module.youtube.dl` (l'addon s'est longtemps appuyé sur les
extracteurs youtube-dl pour obtenir les URL de flux de ces plateformes).

## 3. Constats déterminants

1. **Aucune API publique documentée.** Chaque intégration repose sur la
   rétro-ingénierie d'APIs privées (mytf1, 6play/Algolia, yatta.francetv.fr, player Arte).
2. **DRM (Widevine)** requis pour TF1, M6 et France TV — géré dans Kodi par
   *Inputstream Adaptive* + un module Widevine CDM.
3. **Comptes obligatoires** pour le groupe M6 (6play) et NRJ, etc.
4. **Fragilité chronique** : la liste des commits montre un « Fix replay » / « Fix live »
   à pratiquement chaque release — signature typique d'APIs non documentées qui cassent.

## 4. Conséquence pour le lecteur IPTV

- En **lecture intégrée** (flux dans l'app), le replay français impose :
  rétro-ingénierie d'APIs privées + DRM + comptes — **fragile et contraire aux CGU**.
  Non retenu (cohérent avec l'exigence « rester légal » du projet).
- La voie **propre et robuste** est d'ouvrir le replay **officiel** de chaque chaîne
  (application ou site de TF1+, M6+, france.tv, Arte) via des liens profonds. C'est le
  chemin que ces plateformes autorisent explicitement, et c'est l'option retenue
  (« option 3 »), complétée par un guide des programmes alimenté par l'EPG déjà
  présent dans l'app.

## 5. Sources

- `https://github.com/Catch-up-TV-and-More/plugin.video.catchuptvandmore`
- `https://catch-up-tv-and-more.github.io/fr/channels/`
- `.../resources/lib/channels/fr/francetv.py` (API yatta France TV)
- `.../resources/lib/channels/fr/6play.py` (Algolia + 6play)
- `.../resources/lib/channels/wo/arte.py` (player/v2 + opa/v3)
- FAQ Arte : `https://faq.arte.tv` (offre replay, géo-droits)
