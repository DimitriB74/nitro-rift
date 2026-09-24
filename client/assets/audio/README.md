# Sons et musiques

Tant qu'un fichier est absent, le son correspondant est **synthétisé par le code**
avec la Web Audio API (oscillateurs et bruit filtré). Le jeu est donc sonore
sans aucun de ces fichiers.

Le volume de chaque catégorie se règle dans les paramètres du jeu.

## Moteur

| Fichier | Description |
|---|---|
| `moteur_boucle.ogg` | Boucle de moteur, régime constant. La hauteur est modulée par le jeu selon la vitesse. |
| `moteur_ralenti.ogg` | Boucle au ralenti |

## Effets

| Fichier | Description |
|---|---|
| `pneus_crissement.ogg` | Crissement en dérapage (boucle) |
| `derapage_boost.ogg` | Déclenchement du boost de dérapage |
| `nitro.ogg` | Souffle de la nitro (boucle) |
| `choc_mur.ogg` | Choc contre un mur |
| `vent.ogg` | Vent à haute vitesse (boucle) |
| `atterrissage.ogg` | Réception après un saut |
| `checkpoint.ogg` | Passage d'un checkpoint |
| `record.ogg` | Nouveau record |
| `boost_plaque.ogg` | Passage sur une plaque de boost |

## Interface

| Fichier | Description |
|---|---|
| `clic.ogg` | Clic de menu |
| `bip.ogg` | Bip du compte à rebours (3, 2, 1) |
| `depart.ogg` | Signal de départ |
| `achat.ogg` | Achat au garage |

## Musiques

| Fichier | Description |
|---|---|
| `menu.ogg` | Musique des menus |
| `canyon.ogg` | Canyon désertique |
| `ville.ogg` | Ville néon |
| `stade.ogg` | Stade futuriste |
| `montagne.ogg` | Montagne enneigée |
| `victoire.ogg` | Thème du podium |

## Contraintes

- Format **OGG Vorbis** (`.ogg`), le plus léger et lu partout dans Chrome.
- Les boucles doivent être **raccordables sans claquement** (même niveau au
  début et à la fin).
- Effets : moins de 100 Ko. Musiques : moins de 2 Mo, autour de 96 kbit/s.

## Sources

[Freesound](https://freesound.org) et [Pixabay](https://pixabay.com/music/).
**Vérifiez la licence de chaque fichier** et créditez les auteurs dans
`CREDITS.md`.
