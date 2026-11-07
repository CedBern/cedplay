# Guide des flux publics gratuits — intégré à l'application

## Ce qui est fourni

Une playlist de **2 465 chaînes** diffusées publiquement et gratuitement, groupées par pays (`group-title`). Elles proviennent du projet open-source de référence **[iptv-org/iptv](https://github.com/iptv-org/iptv)**, qui recense les flux mis en ligne publiquement par les diffuseurs (chaînes publiques, gouvernementales, d'information, locales).

| Pays | Chaînes |
|---|---|
| États-Unis | 1 093 |
| Italie | 331 |
| Espagne | 284 |
| Royaume-Uni | 230 |
| Mexique | 222 |
| France | 212 |
| Belgique | 62 |
| Suisse | 31 |
| **Total** | **2 465** |

## Utilisation dans le lecteur

La playlist est **embarquée dans l'application** (`application/public/flux-legaux.m3u`).

- Sur l'écran d'accueil ou dans **Mes listes → Importer une liste**, un encart **« Chaînes publiques gratuites »** propose un bouton **« Charger »**.
- Le chargement passe par le même pipeline que tout autre import (analyse en worker, déduplication, enregistrement, favoris). Recharger la même liste la remplace (pas de doublon).
- Les chaînes apparaissent groupées par pays.

## Précautions

- **Flux publics mais changeants** : une URL peut cesser de répondre. Le projet `iptv-org` est mis à jour régulièrement ; régénérez la liste pour rafraîchir les adresses.
- **`[Geo-blocked]`** : certaines chaînes ne sont lisibles que depuis leur pays d'origine.
- **`[Not 24/7]`** : certaines ne diffusent pas en continu.
- **Aucune chaîne payante** (Canal+, beIN, Netflix, sports premium…) n'est incluse — celles-ci ne sont pas distribuables légalement en flux public.

## Régénérer / mettre à jour la liste

Les sources sont conservées dans `flux-legaux-source/` (un fichier par pays). Le script `merge-flux.mjs` (racine) reconstruit `application/public/flux-legaux.m3u` :

```
node merge-flux.mjs
```

Pour rafraîchir les sources depuis le dépôt `iptv-org` :

```powershell
cd flux-legaux-source
curl.exe -sL https://raw.githubusercontent.com/iptv-org/iptv/master/streams/fr.m3u -o fr.m3u
# ... idem pour mx, us, be, ch, it, es, uk
cd ..
node merge-flux.mjs
```

## Rappel légal

Ces flux sont **gratuits et publics**, proposés librement par les diffuseurs. Cela reste très différent des offres IPTV « tout illimité à 8 € » qui redistribuent sans autorisation des chaînes payantes : celles-là sont illégales et ne figurent pas ici. Les chaînes nationales protégées ou payantes s'obtiennent légalement via leurs plateformes officielles (Arte, Molotov, BBC iPlayer, RaiPlay, RTVE Play, RTBF Auvio, Play Suisse…).
