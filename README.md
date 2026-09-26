# NITRO RIFT

Jeu de course arcade 3D **jouable dans le navigateur**, en solo contre des bots
ou en ligne avec tes amis dans des salons privés. Circuits avec loopings,
virages relevés, tire-bouchons et murs verticaux.

Interface entièrement en français. Prévu pour tourner à 60 images/s sur une
carte graphique intégrée.

---

## Essayer tout de suite, en local

```bash
npm install
npm run dev        # serveur + Vite, rechargement à chaud
```

Puis ouvre **http://localhost:5173**.

Sans base de données configurée, le serveur démarre en **mode mémoire** : tu
peux créer un compte et jouer immédiatement, mais la progression disparaît au
redémarrage. C'est fait pour : aucun compte MongoDB n'est nécessaire pour
développer.

Pour tester la version de production telle qu'elle sera en ligne :

```bash
npm run build && npm start   # http://localhost:3000
```

---

## Commandes

| Touche | Action |
|---|---|
| `Z` `Q` `S` `D` (AZERTY) ou `W` `A` `S` `D` | accélérer, freiner, tourner |
| Flèches | équivalent |
| `Espace` | dérapage |
| `Maj` | nitro |
| `Entrée` | retour au dernier checkpoint |
| `Retour arrière` | recommencer (solo et contre-la-montre) |
| `T` | écrire dans le chat (multijoueur, pendant la course) |
| `Échap` | pause / menu |

Les touches sont détectées par **position physique** : ZQSD sur AZERTY et WASD
sur QWERTY fonctionnent sans rien régler. Tout est reconfigurable dans les
paramètres.

**Le geste qui change tout** : maintiens `Espace` en tournant pour charger un
dérapage. Trois paliers — bleu, orange, violet — et relâcher donne un
mini-boost proportionnel. Toucher un mur annule la charge.

---

## Les modes

| Mode | Solo | Multijoueur |
|---|---|---|
| **Course rapide** | une course sur le circuit de ton choix | salon privé, jusqu'à 8 voitures |
| **Grand Prix** | les 4 circuits enchaînés, points 10-8-6-5-4-3-2-1 | idem, le classement est tenu par le serveur |
| **Contre-la-montre** | 4 tours seul, avec le fantôme de ton record | session chronométrée de 3, 5 ou 10 minutes |

**Grand Prix.** Les mêmes adversaires disputent les quatre manches. À égalité de
points, c'est la dernière course qui départage. Le podium du championnat verse
un bonus (1000, 600, 400 crédits), multiplié par la difficulté des adversaires.

**Contre-la-montre solo.** Quatre tours : le premier part à l'arrêt, les
suivants sont lancés — les temps de médaille sont calibrés sur un tour lancé, un
seul tour rendrait le platine inatteignable. Ton record personnel roule avec toi
sous la forme d'une voiture translucide, et les intermédiaires du record servent
de référence à chaque checkpoint.

**Contre-la-montre multijoueur.** Chacun enchaîne les tours pendant la session ;
le classement des meilleurs tours s'affiche en direct et se met à jour à chaque
amélioration. Le meilleur tour classe, pas la position sur la piste.

---

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur + client en développement |
| `npm run build` | construit le client dans `/dist` |
| `npm start` | serveur de production (sert `/dist`) |
| `npm test` | toutes les vérifications sans navigateur (≈ 140) |
| `npm run verifier` | 28 contrôles sans affichage : circuits, bots, voitures |
| `npm run comparer` | compare les 4 voitures sur les 4 circuits |
| `npm run test:multi` | 22 contrôles du multijoueur avec de vrais clients réseau |
| `npm run test:garage` | 18 contrôles de l'économie et du garage |
| `npm run test:gp` | 23 contrôles du Grand Prix, dont un championnat complet |
| `npm run test:clm` | 26 contrôles des fantômes et des médailles |
| `npm run test:session` | 16 contrôles d'une session de contre-la-montre en réseau |
| `npm run test:chat` | 12 contrôles du chat et de l'anti-inondation |
| `npm run test:navigateur` | 5 suites dans un vrai Chromium (≈ 60 contrôles) |
| `npm run calibrate` | recalcule les temps de médaille des circuits |
| `npm run tracks` | régénère les circuits depuis les scripts de tracé |

---

## Mettre en ligne sur Render

### 1. Base de données MongoDB Atlas (gratuite)

1. Crée un compte sur [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. **Create** → offre **M0 Free** → choisis une région proche.
3. **Database Access** → **Add New Database User** : note l'identifiant et le
   mot de passe.
4. **Network Access** → **Add IP Address** → **Allow access from anywhere**
   (`0.0.0.0/0`). Render n'a pas d'adresse fixe sur l'offre gratuite.
5. **Database** → **Connect** → **Drivers** → copie la chaîne, du type :
   `mongodb+srv://utilisateur:motdepasse@cluster0.xxxxx.mongodb.net/nitrorift`

   Remplace `motdepasse` par le vrai, et ajoute `/nitrorift` avant le `?` pour
   nommer la base.

### 2. Le service web

1. Pousse ce dépôt sur GitHub.
2. Sur [render.com](https://render.com) : **New** → **Web Service** → choisis
   le dépôt.
3. Réglages :
   - **Build Command** : `npm install && npm run build`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
4. **Environment** → ajoute :

| Variable | Valeur |
|---|---|
| `MONGODB_URI` | la chaîne copiée à l'étape 1 |
| `JWT_SECRET` | une longue chaîne aléatoire, à toi |
| `ADMIN_KEY` | une autre chaîne, pour la page `/admin` |

`PORT` est fourni automatiquement par Render, ne l'ajoute pas.

5. **Create Web Service**. Le premier déploiement prend quelques minutes.

Vérifie ensuite `https://ton-service.onrender.com/health` : tu dois lire
`"base":"mongodb"`. Si tu lis `"memoire"`, la chaîne de connexion est
incorrecte et les comptes ne seront pas sauvegardés.

### Le service gratuit s'endort

Render endort le service après une quinzaine de minutes sans visite, et le
réveil prend jusqu'à une minute. Le jeu l'a prévu : il affiche
« Réveil du serveur… » et réessaie tout seul. Ouvre simplement le lien une
minute avant de jouer avec tes amis.

### Mot de passe oublié

Il n'y a pas d'envoi d'e-mail. Va sur `https://ton-service.onrender.com/admin`,
saisis ta `ADMIN_KEY`, le pseudo du joueur et un nouveau mot de passe.

---

## Comment c'est construit

```
shared/      code partagé par le navigateur ET le serveur
  config.js    toutes les valeurs réglables, GAME_NAME compris
  geom.js      vecteurs et maths
  track.js     le circuit comme ruban 3D (spline + vecteurs « haut »)
  physics.js   physique arcade : repère lié à la piste, décrochage, vol
  bots.js      pilotage automatique, trois niveaux
  cars.js      les 4 voitures, statistiques et améliorations
  economy.js   crédits, médailles, défis, barème des gains
  tracks/      les 4 circuits en JSON
server/
  index.js     HTTP + fichiers du client
  db.js        MongoDB, avec repli en mémoire
  auth.js      comptes, bcryptjs, jetons JWT
  rooms.js     salons privés
  race.js      course serveur : bots, instantanés, compensation
  multijoueur.js  couche Socket.io
  garage.js    achats, records, classements
  rewards.js   calcul des crédits — jamais par le client
  admin.js     page de réinitialisation
client/src/
  main.js      boucle de jeu et enchaînement des écrans
  render/      scène, piste, voitures, caméra de poursuite, showroom du garage
  game/        course, circuits, entrées clavier
  ui/          ATH, salon, garage, chat, connexion, minimap
  net/         API et Socket.io, interpolation
  audio/       son entièrement synthétisé
```

### Trois principes

**Un seul code de physique.** `shared/physics.js` tourne dans le navigateur et
sur le serveur. Les bots du multijoueur se comportent donc exactement comme
ceux du solo, et un temps simulé hors affichage vaut un temps joué.

**Le serveur décide de tout ce qui compte.** Crédits, achats, améliorations,
médailles : le client annonce ce qu'il a fait, le serveur applique le barème et
borne ce qui vient de lui. Un client modifié ne peut pas s'offrir une voiture.

**Le chronomètre tourne chez le joueur.** En multijoueur, chaque client mesure
son propre temps : le ping ne pénalise personne. Le serveur ne fait qu'un
contrôle de plausibilité, en rejetant un temps qui descend sous 75 % du
meilleur tour d'un bot difficile en voiture entièrement améliorée.

### Le repère lié à la piste

Chaque circuit est un ruban défini par une spline, avec un **vecteur « haut »
explicite à chaque point de contrôle**, interpolé le long du tracé. La voiture
est repérée par sa distance le long de la piste, son décalage latéral et sa
hauteur au-dessus de la surface, et la gravité pointe vers la route.

C'est ce qui permet de rouler dans un looping, sur un mur vertical ou dans un
tire-bouchon. Le repère de Frenet, qui se retourne dans les loopings, ne le
permettrait pas.

Conséquence voulue : si la vitesse est trop faible, l'accélération centripète
`v²/R` ne compense plus la gravité et la voiture **décroche**. Il faut arriver
lancé dans un looping.

---

## Ajouter de vrais assets

Le jeu fonctionne sans aucun fichier externe : voitures et sons sont générés
par le code. Pour les remplacer, chaque dossier a son README listant les noms
exacts attendus :

- `client/assets/models/cars/` — `comete.glb`, `frelon.glb`, `vipere.glb`,
  `tempete.glb`. Si le modèle contient des roues séparées, elles tournent et
  braquent automatiquement.
- `client/assets/hdri/` — un ciel par décor, pour l'éclairage et les reflets.
- `client/assets/textures/` — routes, rochers, bâtiments.
- `client/assets/audio/` — musiques et effets.

Sources conseillées : [Poly Haven](https://polyhaven.com) (CC0) pour les HDRI
et textures, [Sketchfab](https://sketchfab.com) pour les modèles (vérifie la
licence de chacun), [Freesound](https://freesound.org) et
[Pixabay](https://pixabay.com) pour l'audio.

Crédite les auteurs dans [`CREDITS.md`](CREDITS.md).

---

## État du projet

Le jeu est complet et jouable de bout en bout : structure, conduite et caméra,
physique 3D avec loopings et murs, checkpoints et chronométrage, bots à trois
niveaux, les 4 circuits, rendu et effets, comptes et sauvegarde, multijoueur en
salon privé, Grand Prix, contre-la-montre avec fantômes, garage avec showroom
3D, économie, médailles, défis, classements, chat et son synthétisé.

Reste à faire, si tu veux aller plus loin :

- **de vrais assets** — modèles de voitures, HDRI et sons, à la place de ce que
  le code génère (voir la section précédente) ;
- **le Stade futuriste et la Montagne enneigée** ne séparent pas les voitures :
  moins d'une demi-seconde entre la meilleure et la pire, contre 3 à 4 s au
  Canyon et à la Ville, où la Tempête et la Vipère se détachent comme prévu. Le
  choix de la voiture n'y change presque rien. La Montagne tourne aussi en
  1 min 03, un peu au-dessus des 40 à 60 s visées. `npm run comparer` chiffre
  tout ça ;
- **jouer sur téléphone** : l'interface s'adapte, mais il n'y a pas de commandes
  tactiles.
