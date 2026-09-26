// Configuration centrale de NITRO RIFT.
// Tout ce qui sert à équilibrer le jeu est rassemblé ici,
// dans /shared/cars.js et dans /shared/economy.js.

/** Nom du jeu, affiché partout dans l'interface. Une seule constante à changer. */
export const GAME_NAME = 'NITRO RIFT';

export const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Physique
// ---------------------------------------------------------------------------
export const PHYS = {
  /** Gravité (m/s²). Volontairement plus forte que 9.81 : sensation arcade. */
  gravite: 22.0,

  /** Pas de simulation fixe (s). 120 Hz : stable dans les loopings. */
  pasFixe: 1 / 120,
  /**
   * Nombre maximal de sous-pas rattrapés en une image (anti-spirale de la mort).
   * 16 sous-pas à 120 Hz = 133 ms : le jeu reste en temps réel jusqu'à 7 images
   * par seconde. En dessous, il ralentit volontairement plutôt que de s'effondrer.
   */
  sousPasMax: 16,

  /** Hauteur au-dessus de la piste en dessous de laquelle la voiture reste collée. */
  hauteurAccroche: 1.2,
  /** Hauteur de la caisse au-dessus de la surface (rendu). */
  hauteurCaisse: 0.55,

  /** Traînée aérodynamique (coefficient sur v²). */
  trainee: 0.00018,
  /** Résistance au roulement (m/s²). */
  roulement: 1.2,
  /** Freinage (m/s²). */
  freinage: 46.0,
  /** Puissance en marche arrière, en fraction de l'accélération avant. */
  marcheArriere: 0.45,

  /** Adhérence longitudinale disponible, multiplicateur de la force normale. */
  adherenceLongitudinale: 1.6,

  /** Vitesse minimale (m/s) pour amorcer un dérapage. */
  vitesseMinDerapage: 14,
  /** Fraction d'adhérence latérale conservée en dérapage. */
  adherenceEnDerapage: 0.34,
  /** Bonus de rotation en dérapage. */
  bonusLacetDerapage: 1.65,

  /** Durées cumulées (s) pour atteindre les paliers de dérapage 1, 2 et 3. */
  paliersDerapage: [0.9, 2.1, 3.5],
  /** Impulsion de vitesse (m/s) donnée au relâchement, par palier. */
  boostDerapage: [7, 12, 18],

  /** Jauge de nitro : capacité de référence et remplissage. */
  nitroCapaciteBase: 100,
  nitroGainDerapage: [14, 26, 42],
  /** Gain de nitro par seconde passée en l'air. */
  nitroGainVol: 16,
  /** Gain de nitro pour un looping franchi à bonne vitesse. */
  nitroGainLooping: 30,
  /** Consommation de nitro par seconde. */
  nitroConsommation: 34,
  /** Poussée supplémentaire de la nitro (m/s²). */
  nitroPoussee: 26,
  /** Dépassement de la vitesse maximale autorisé sous nitro. */
  nitroSurvitesse: 1.16,

  /** Perte de vitesse en touchant un mur, du frottement rasant au choc frontal. */
  murPerteMin: 0.06,
  murPerteMax: 0.62,
  /** Rebond latéral (m/s) après contact. */
  murRebond: 4.5,

  /** Marge (m) au-delà d'un bord ouvert avant la chute dans le vide. */
  margeHorsPiste: 9,
  /** Profondeur (m) sous la piste à partir de laquelle la chute est actée. */
  chuteVide: 45,
  /** Délai (s) avant réapparition au dernier checkpoint. */
  delaiReapparition: 1.0,

  /** Contrôle en rotation pendant un saut (rad/s). */
  controleEnVol: 1.5,

  /** Cosinus minimal entre le haut de la voiture et celui de la piste pour se raccrocher. */
  cosAtterrissage: 0.35,

  /** Vitesse verticale (m/s) au-delà de laquelle l'atterrissage secoue la caméra. */
  seuilAtterrissageDur: 12
};

/** Coefficients d'adhérence et de ralentissement par type de surface. */
export const SURFACES = {
  route: { nom: 'Route', adherence: 1.0, ralentissement: 1.0 },
  boost: { nom: 'Plaque de boost', adherence: 1.0, ralentissement: 1.0, impulsion: 26 },
  glace: { nom: 'Glace', adherence: 0.34, ralentissement: 0.85 },
  sable: { nom: 'Sable', adherence: 0.62, ralentissement: 3.4 },
  neige: { nom: 'Neige', adherence: 0.55, ralentissement: 3.0 },
  terre: { nom: 'Terre', adherence: 0.72, ralentissement: 2.6 },
  /** Trou dans la piste : le ruban existe pour la physique, mais il n'y a pas de route. */
  vide: { nom: 'Vide', adherence: 0, ralentissement: 1, sansRoute: true }
};

/** Surface appliquée hors piste, par décor. `null` signifie le vide. */
export const HORS_PISTE = {
  test: 'terre',
  canyon: 'sable',
  ville: 'terre',
  stade: null,
  montagne: 'neige'
};

// ---------------------------------------------------------------------------
// Caméra
// ---------------------------------------------------------------------------
export const CAMERA = {
  distances: { proche: 7.4, normale: 9.2, eloignee: 11.5 },
  libelles: { proche: 'Proche', normale: 'Normale', eloignee: 'Éloignée' },
  hauteur: 3.2,
  regardDevant: 8.0,
  /** Champ de vision (degrés) à l'arrêt et à pleine vitesse sous nitro. */
  fovMin: 70,
  fovMax: 92,
  lissagePosition: 9.0,
  lissageOrientation: 6.0,
  secousseAtterrissage: 0.55
};

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------
export const COURSE = {
  participantsMax: 8,
  toursParDefaut: 3,
  /** Compte à rebours avant le départ (s). */
  compteARebours: 3,
  /** Délai laissé aux retardataires après l'arrivée du premier (s). */
  delaiApresPremier: 30,
  /** Points attribués par position en Grand Prix. */
  points: [10, 8, 6, 5, 4, 3, 2, 1],
  /** Ordre des circuits en Grand Prix. */
  grandPrix: ['canyon', 'ville', 'stade', 'montagne'],
  /** Durée d'une session de contre-la-montre multijoueur (s). */
  dureeContreLaMontre: 300,
  /** Écartement de la grille de départ. */
  grille: { pasLongitudinal: 8, decalageLateral: 3.4 }
};

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------
export const RESEAU = {
  /** Fréquence d'envoi de l'état du client (Hz). */
  hzClient: 20,
  /** Fréquence des instantanés serveur (Hz). */
  hzServeur: 20,
  /** Retard d'interpolation des voitures adverses (ms). */
  retardInterpolation: 100,
  /** Longueur du code de salon. */
  longueurCode: 4,
  /** Caractères utilisés : ni I, ni O, ni 0, ni 1 (trop faciles à confondre). */
  alphabetCode: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  /** Durée de validité d'un jeton JWT. */
  dureeJeton: '7d'
};

// ---------------------------------------------------------------------------
// Graphismes
// ---------------------------------------------------------------------------
export const QUALITES = {
  bas: {
    nom: 'Bas',
    resolution: 0.7,
    ombres: false,
    tailleOmbres: 512,
    postTraitement: false,
    bloom: false,
    antiAliasing: false,
    particules: 0.25,
    distanceAffichage: 700,
    reflets: false,
    tracesPneus: false,
    decorsDensite: 0.4
  },
  moyen: {
    nom: 'Moyen',
    resolution: 0.85,
    ombres: true,
    tailleOmbres: 1024,
    postTraitement: true,
    bloom: true,
    antiAliasing: false,
    particules: 0.55,
    distanceAffichage: 1100,
    reflets: false,
    tracesPneus: true,
    decorsDensite: 0.7
  },
  eleve: {
    nom: 'Élevé',
    resolution: 1.0,
    ombres: true,
    tailleOmbres: 2048,
    postTraitement: true,
    bloom: true,
    antiAliasing: true,
    particules: 1.0,
    distanceAffichage: 1600,
    reflets: true,
    tracesPneus: true,
    decorsDensite: 1.0
  },
  ultra: {
    nom: 'Ultra',
    resolution: 1.0,
    ombres: true,
    tailleOmbres: 4096,
    postTraitement: true,
    bloom: true,
    antiAliasing: true,
    particules: 1.6,
    distanceAffichage: 2400,
    reflets: true,
    tracesPneus: true,
    decorsDensite: 1.4
  }
};

export const QUALITE_DEFAUT = 'moyen';

/** Touches par défaut, repérées par `event.code` : ZQSD en AZERTY = WASD en QWERTY. */
export const TOUCHES_DEFAUT = {
  accelerer: ['KeyW', 'ArrowUp'],
  freiner: ['KeyS', 'ArrowDown'],
  gauche: ['KeyA', 'ArrowLeft'],
  droite: ['KeyD', 'ArrowRight'],
  derapage: ['Space'],
  nitro: ['ShiftLeft', 'ShiftRight'],
  checkpoint: ['Enter'],
  recommencer: ['Backspace'],
  pause: ['Escape']
};

export const LIBELLES_TOUCHES = {
  accelerer: 'Accélérer',
  freiner: 'Freiner / marche arrière',
  gauche: 'Tourner à gauche',
  droite: 'Tourner à droite',
  derapage: 'Dérapage',
  nitro: 'Nitro',
  checkpoint: 'Retour au checkpoint',
  recommencer: 'Recommencer la course',
  pause: 'Pause / menu'
};

export const VOLUMES_DEFAUT = {
  general: 70,
  musique: 55,
  moteur: 70,
  effets: 80,
  interface: 70
};

/** Chemins des assets, servis à la racine du site (voir vite.config.js). */
export const CHEMINS = {
  modeles: '/models/cars/',
  textures: '/textures/',
  hdri: '/hdri/',
  audio: '/audio/',
  circuits: '/circuits/'
};
