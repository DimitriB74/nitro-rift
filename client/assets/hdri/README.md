# Ciels HDRI

Un ciel par décor, utilisé à la fois pour l'éclairage et pour les reflets de la
carrosserie.

Tant que ces fichiers sont absents, le jeu génère un **ciel procédural en
dégradé** (`client/src/render/scene.js`) qui sert aussi de carte
d'environnement. Le rendu est correct sans aucun HDRI.

## Fichiers attendus

| Fichier | Décor |
|---|---|
| `canyon.hdr` | Canyon désertique — fin d'après-midi, ciel chaud |
| `ville.hdr` | Ville néon — nuit, lumières urbaines |
| `stade.hdr` | Stade futuriste — nuit dégagée, éclairage artificiel |
| `montagne.hdr` | Montagne enneigée — plein jour, neige |

## Contraintes

- Format **Radiance `.hdr`** équirectangulaire.
- **2k maximum** (2048 × 1024) : un 4k coûte cher en mémoire sur une carte
  graphique intégrée, pour un gain invisible en course.
- Visez moins de 3 Mo par fichier.

## Sources

[Poly Haven](https://polyhaven.com/hdris) — licence **CC0**. Créditez les
auteurs dans `CREDITS.md`.
