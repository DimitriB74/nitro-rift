// Voitures : statistiques, peintures et conversion des stats en paramètres physiques.
// C'est le fichier à modifier pour équilibrer les voitures.

/** Nombre de niveaux d'amélioration par statistique. */
export const NIVEAU_MAX = 5;

/** Gain apporté par niveau d'amélioration (2,5 % → +12,5 % au niveau 5). */
export const GAIN_PAR_NIVEAU = 0.025;

export const STATS = ['vitesse', 'acceleration', 'maniabilite', 'adherence', 'nitro'];

export const LIBELLES_STATS = {
  vitesse: 'Vitesse',
  acceleration: 'Accélération',
  maniabilite: 'Maniabilité',
  adherence: 'Adhérence',
  nitro: 'Nitro'
};

/** Les quatre voitures. Statistiques sur 10. */
export const VOITURES = {
  comete: {
    id: 'comete',
    nom: 'Comète',
    profil: 'Équilibrée',
    description: 'Polyvalente et sans mauvaise surprise. La voiture idéale pour apprendre les circuits.',
    prix: 0,
    parDefaut: true,
    couleurBase: '#4fa3ff',
    stats: { vitesse: 6, acceleration: 6, maniabilite: 6, adherence: 6, nitro: 6 }
  },
  frelon: {
    id: 'frelon',
    nom: 'Frelon',
    profil: 'Nerveuse',
    description: 'Accélération foudroyante et grosse réserve de nitro, mais elle décroche vite.',
    prix: 3000,
    couleurBase: '#ffc233',
    stats: { vitesse: 6, acceleration: 9, maniabilite: 5, adherence: 4, nitro: 8 }
  },
  vipere: {
    id: 'vipere',
    nom: 'Vipère',
    profil: 'Agile',
    description: 'Se place au millimètre dans les épingles. Redoutable sur les tracés techniques.',
    prix: 3500,
    couleurBase: '#3ddc84',
    stats: { vitesse: 5, acceleration: 5, maniabilite: 8, adherence: 7, nitro: 5 }
  },
  tempete: {
    id: 'tempete',
    nom: 'Tempête',
    profil: 'Bolide',
    description: 'Vitesse de pointe énorme. Il faut de la place pour la lâcher.',
    prix: 5000,
    couleurBase: '#ff4d5a',
    stats: { vitesse: 9, acceleration: 5, maniabilite: 4, adherence: 6, nitro: 5 }
  }
};

export const IDS_VOITURES = Object.keys(VOITURES);

/** Voiture et peinture possédées dès l'inscription. */
export const VOITURE_DEPART = 'comete';
export const PEINTURE_DEPART = 'rouge';

/** Peintures de base, gratuites et disponibles pour tout le monde. */
export const PEINTURES_BASE = {
  rouge: { nom: 'Rouge', couleur: '#e02c3d', type: 'base' },
  bleu: { nom: 'Bleu', couleur: '#2b6cff', type: 'base' },
  jaune: { nom: 'Jaune', couleur: '#f5c518', type: 'base' },
  vert: { nom: 'Vert', couleur: '#26b862', type: 'base' },
  orange: { nom: 'Orange', couleur: '#ff7a1a', type: 'base' },
  violet: { nom: 'Violet', couleur: '#9a4dff', type: 'base' },
  blanc: { nom: 'Blanc', couleur: '#ececf0', type: 'base' },
  noir: { nom: 'Noir', couleur: '#1b1d22', type: 'base' }
};

/** Peintures spéciales, débloquées par les défis. */
export const PEINTURES_SPECIALES = {
  chrome: {
    nom: 'Chromé', couleur: '#cfd6df', type: 'special',
    materiau: { metalness: 1.0, roughness: 0.06, clearcoat: 1.0 }
  },
  neon: {
    nom: 'Néon', couleur: '#19f0d8', type: 'special',
    materiau: { metalness: 0.35, roughness: 0.25, emissive: '#0bd9c2', emissiveIntensity: 1.4 }
  },
  carbone: {
    nom: 'Carbone', couleur: '#26282e', type: 'special',
    materiau: { metalness: 0.7, roughness: 0.42, clearcoat: 0.9 }
  },
  dore: {
    nom: 'Doré', couleur: '#e8b23a', type: 'special',
    materiau: { metalness: 1.0, roughness: 0.18, clearcoat: 0.6 }
  }
};

export const PEINTURES = { ...PEINTURES_BASE, ...PEINTURES_SPECIALES };

export const estPeintureBase = (id) => Object.hasOwn(PEINTURES_BASE, id);

/** Niveaux d'amélioration à zéro, pour toutes les statistiques. */
export function niveauxVides() {
  const n = {};
  for (const s of STATS) n[s] = 0;
  return n;
}

/**
 * Statistique effective (sur 10) une fois les améliorations appliquées.
 * Le bonus s'applique à la statistique de base : une Tempête améliorée au maximum
 * reste moins maniable qu'une Vipère de série.
 */
export function statEffective(idVoiture, stat, niveau = 0) {
  const base = VOITURES[idVoiture].stats[stat];
  return base * (1 + GAIN_PAR_NIVEAU * Math.min(niveau, NIVEAU_MAX));
}

/**
 * Convertit les statistiques d'une voiture en paramètres physiques utilisables
 * par /shared/physics.js. Même fonction côté client et côté serveur.
 *
 * @param {string} idVoiture
 * @param {object} niveaux  { vitesse: 0..5, acceleration: 0..5, ... }
 */
export function parametresVoiture(idVoiture, niveaux = {}) {
  const voiture = VOITURES[idVoiture] ?? VOITURES[VOITURE_DEPART];
  const s = {};
  for (const stat of STATS) s[stat] = statEffective(voiture.id, stat, niveaux[stat] ?? 0);

  return {
    id: voiture.id,
    nom: voiture.nom,
    stats: s,

    /** Vitesse maximale sur le plat, en m/s. */
    vitesseMax: 48 + s.vitesse * 4.0,
    /** Poussée du moteur, en m/s². */
    acceleration: 12 + s.acceleration * 2.2,
    /** Vitesse de rotation de référence, en rad/s. */
    maniabilite: 1.15 + s.maniabilite * 0.115,
    /** Coefficient d'adhérence latérale. */
    adherence: 0.95 + s.adherence * 0.105,
    /** Capacité de la jauge de nitro. */
    nitroCapacite: 70 + s.nitro * 8,
    /** Multiplicateur de poussée de la nitro. */
    nitroPuissance: 0.7 + s.nitro * 0.06,

    /** Dimensions de la caisse, pour le rendu et les collisions contre les murs. */
    longueur: 4.3,
    largeur: 1.95
  };
}

/** Niveau d'amélioration moyen d'un joueur sur une voiture (0 à 5). */
export function niveauMoyen(niveaux = {}) {
  let total = 0;
  for (const stat of STATS) total += Math.min(niveaux[stat] ?? 0, NIVEAU_MAX);
  return total / STATS.length;
}

/** Applique le même niveau à toutes les statistiques (utilisé pour les bots). */
export function niveauxUniformes(niveau) {
  const n = {};
  const v = Math.max(0, Math.min(NIVEAU_MAX, Math.round(niveau)));
  for (const s of STATS) n[s] = v;
  return n;
}
