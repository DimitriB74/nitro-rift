# Modèles 3D des voitures

Déposez ici les modèles au format **glTF binaire (`.glb`)**. Le jeu les charge
automatiquement au démarrage. Tant qu'un fichier est absent, la voiture
correspondante est générée par le code (`client/src/render/voiture.js`) : une
carrosserie profilée avec vitres et roues. Le jeu est donc entièrement jouable
sans aucun de ces fichiers.

## Fichiers attendus

| Fichier | Voiture | Profil |
|---|---|---|
| `comete.glb` | Comète | Équilibrée |
| `frelon.glb` | Frelon | Nerveuse |
| `vipere.glb` | Vipère | Agile |
| `tempete.glb` | Tempête | Bolide |

## Contraintes

- **Orientation** : l'avant de la voiture vers **+Z**, le haut vers **+Y**,
  l'origine au centre du véhicule, au niveau du sol.
- **Dimensions** : environ **4,3 m de long** sur **1,95 m de large**. Le modèle
  n'est pas remis à l'échelle automatiquement.
- **Roues séparées** : si le modèle contient des nœuds dont le nom contient
  `roue` ou `wheel`, ils sont animés (rotation, et braquage pour les roues
  avant). Sinon le modèle est affiché tel quel.
- **Carrosserie repeinte** : un nœud dont le nom contient `carrosserie`, `body`
  ou `paint` reçoit la peinture choisie par le joueur. Les autres nœuds gardent
  les matériaux du modèle.
- **Poids** : visez moins de 1 Mo par voiture. Le jeu doit tourner sur une carte
  graphique intégrée.
- **Voitures génériques**, sans marque ni logo réels.

## Sources

Modèles envisagés : [Sketchfab](https://sketchfab.com). **Vérifiez la licence de
chaque modèle** (toutes ne permettent pas la redistribution) et ajoutez l'auteur
et la licence dans `CREDITS.md` à la racine du projet.
