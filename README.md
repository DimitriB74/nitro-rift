# NITRO RIFT

Jeu de course arcade en 3D, jouable dans Chrome, façon TrackMania : circuits avec
loopings, virages relevés, tire-bouchons et murs verticaux, dérapages chargés,
nitro, bots et salons privés entre amis.

Le nom du jeu est centralisé dans la constante `GAME_NAME`
([`shared/config.js`](shared/config.js)) : le changer là le change partout.

> **État d'avancement** — étapes 1 à 5 livrées : structure du projet, conduite et
> caméra, physique 3D complète, checkpoints / tours / chrono / HUD / dérapage /
> nitro, bots à trois niveaux et course solo complète avec résultats. Les quatre
> circuits et le circuit d'essai sont déjà jouables.

---

## Lancer le jeu en local

Il faut **Node.js 20 ou plus**.

```bash
npm install
npm run dev
```

Puis ouvrez **http://localhost:5173**.

`npm run dev` démarre deux choses en parallèle : le serveur Express
(port 3000, qui sert les circuits et l'API) et Vite (port 5173, qui sert le
client avec rechargement à chaud). C'est l'adresse **5173** qu'il faut ouvrir.

Pour tester la version de production telle qu'elle tournera sur Render :

```bash
npm run build
npm start
```

Puis ouvrez **http://localhost:3000**.

### Scripts disponibles

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur + client en développement |
| `npm run build` | Construit le client dans `/dist` |
| `npm start` | Démarre le serveur (sert `/dist`) |
| `npm run tracks` | Régénère les circuits JSON depuis leur description |
| `npm run calibrate` | Calcule les temps des médailles (étape 10) |

---

## Contrôles

Les touches sont détectées par leur **position physique** : **ZQSD** en AZERTY et
**WASD** en QWERTY fonctionnent sans rien configurer. Tout est reconfigurable
dans les paramètres.

| Action | Touche |
|---|---|
| Accélérer | `Z` / `W` ou `↑` |
| Freiner, marche arrière | `S` ou `↓` |
| Tourner | `Q` `D` / `A` `D` ou `←` `→` |
| Dérapage | `Espace` |
| Nitro | `Maj` |
| Retour au dernier checkpoint | `Entrée` |
| Recommencer (solo) | `Retour arrière` |
| Pause | `Échap` |

---

## Organisation du code

```
client/    interface, rendu Three.js, HUD, entrées
server/    Express, API, circuits (comptes et multijoueur à venir)
shared/    code commun au navigateur et au serveur
scripts/   outils hors jeu (génération des circuits, calibration)
```

Le dossier **`shared/`** est le cœur du projet : physique, données des circuits,
voitures, économie et logique des bots y sont écrits une seule fois, en modules
ES utilisables des deux côtés. C'est ce qui garantit que les bots du multijoueur,
qui tournent sur le serveur, se comportent exactement comme ceux du solo.

### Les circuits

Un circuit est un **ruban 3D** défini par des points de contrôle portant chacun
une position, un **vecteur « haut » explicite**, une largeur, un type de bord et
un type de surface. Le vecteur haut est donné à la main plutôt que déduit du
repère de Frenet, qui se retourne brutalement dans les loopings.

La voiture est repérée par sa distance le long de la piste, son décalage latéral
et sa hauteur au-dessus de la surface. La gravité utile est celle qui s'exprime
le long du vecteur haut, ce qui permet de rouler dans un looping, sur un virage
relevé ou sur un mur vertical — et de **décrocher** si l'on n'arrive pas assez
lancé.

Les fichiers `shared/tracks/*.json` sont le format lu par le jeu. Ils sont
générés par `npm run tracks` depuis une description en commandes de tracé
(`scripts/build-tracks.js`), bien plus maniable que des centaines de points de
contrôle écrits à la main. On peut les retoucher à la main, mais relancer le
script les écrase.

---

## Ajouter des assets

Le jeu fonctionne **sans aucun asset** : voitures, circuits et ciels sont générés
par le code. Pour les remplacer par de vrais fichiers, chaque dossier de
`client/assets/` contient un README qui liste les noms et formats attendus :

- [`client/assets/models/cars/`](client/assets/models/cars/README.md) — voitures glTF
- [`client/assets/textures/`](client/assets/textures/README.md) — textures
- [`client/assets/hdri/`](client/assets/hdri/README.md) — ciels
- [`client/assets/audio/`](client/assets/audio/README.md) — sons et musiques

Créditez les auteurs dans [`CREDITS.md`](CREDITS.md).

---

## Variables d'environnement

Copiez `.env.example` en `.env`.

| Variable | Rôle |
|---|---|
| `MONGODB_URI` | Connexion MongoDB Atlas. Vide en local : le serveur démarre sans base. |
| `JWT_SECRET` | Clé de signature des jetons de session |
| `ADMIN_KEY` | Accès à la page `/admin` |
| `PORT` | Port d'écoute (fourni par Render) |

Le déploiement pas à pas sur Render et la création d'un cluster MongoDB Atlas
gratuit seront détaillés à l'étape 13.
