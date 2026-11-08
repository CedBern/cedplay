# Catalogue gratuit CedPlay

`public/chaines-gratuites-sources.json` est la source éditoriale de la sélection officielle.
Pour chaque ajout : retrouver le flux dans le lecteur du diffuseur ou l'annuaire officiel
SPR/MXPlus, garder la page de provenance, attribuer un `id` stable et un pays. Un lien
issu d'un annuaire communautaire ne suffit pas à établir cette provenance.

Depuis `application/`, avec Python 3 :

```text
python scripts/public-catalogue.py --generate
python scripts/public-catalogue.py --probe --write
python scripts/public-catalogue.py
```

La première commande génère le M3U à partir du JSON (identifiants, groupes, logos,
adresses et sources). La seconde reçoit les manifestes HLS puis au maximum 32 Kio
d'un segment, avec le User-Agent par défaut du lecteur ; quatre requêtes au maximum
en parallèle, délai réseau de 12 s et cinq niveaux de manifeste au maximum par chaîne.
Elle date chaque résultat, conserve les échecs et sort en erreur si un flux échoue.
Elle ne supprime aucune chaîne. `--write` exige `--probe` ; la commande sans option
contrôle uniquement la cohérence locale, sans accès réseau.

Ce contrôle n'est ni une lecture prolongée, ni une preuve de disponibilité universelle
ou de droits de redistribution. Les dates visibles dans l'application sont celles de
ce contrôle depuis le poste de maintenance, jamais un diagnostic du réseau de l'utilisateur.
Une panne du contrôle n'est pas une raison de supprimer automatiquement une chaîne.

Livrer le JSON et le M3U ensemble. Dans l'application : **Plus → Chaînes gratuites**
consulte les sources et **Ouvrir / actualiser la sélection** met à jour la liste au même
identifiant. Les listes privées ne sont pas modifiées ; les chaînes reconnues par
`tvg-id` conservent leurs identifiants et favoris. Le pays filtre seulement la consultation.
Le catalogue reste embarqué et utilisable hors connexion ; consulter ses sources ne
lance aucune sonde de flux. Les corrections éditoriales sont livrées avec une nouvelle
version de l'application, pas récupérées depuis un service distant.
