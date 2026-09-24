// Économie : crédits, coûts d'amélioration, récompenses, médailles et défis.
// Tous les gains sont calculés par le serveur à partir de ce fichier.

import { NIVEAU_MAX, STATS, VOITURES } from './cars.js';

/** Crédits offerts à l'inscription. */
export const CREDITS_DEPART = 500;

/** Coût, en crédits, pour passer une statistique au niveau 1, 2, 3, 4 puis 5. */
export const COUTS_AMELIORATION = [300, 500, 800, 1100, 1500];

/** Gains de course, de la 1re à la 8e place. */
export const GAINS_COURSE = [500, 400, 320, 260, 200, 160, 130, 100];
/** Gain d'un participant qui ne franchit pas la ligne d'arrivée. */
export const GAIN_NON_ARRIVEE = 50;

/** Bonus du classement général d'un Grand Prix (podium). */
export const BONUS_GRAND_PRIX = [1000, 600, 400];

/**
 * Multiplicateur d'adversité, déterminé par l'adversaire le plus fort de la course.
 * Une course sans adversaire ne rapporte que les bonus de style.
 */
export const MULTIPLICATEURS = {
  aucun: 0,
  facile: 0.5,
  moyen: 1.0,
  difficile: 1.5,
  humain: 1.5
};

/** Ordre de force croissante, pour déterminer l'adversaire le plus fort. */
const FORCE = { aucun: 0, facile: 1, moyen: 2, difficile: 3, humain: 3 };

/**
 * @param {Array<{type: 'humain'|'bot', niveau?: 'facile'|'moyen'|'difficile'}>} adversaires
 * @returns {{cle: string, valeur: number}}
 */
export function multiplicateurAdversite(adversaires = []) {
  let cle = 'aucun';
  for (const a of adversaires) {
    const c = a.type === 'humain' ? 'humain' : (a.niveau ?? 'moyen');
    if (FORCE[c] > FORCE[cle]) cle = c;
  }
  return { cle, valeur: MULTIPLICATEURS[cle] };
}

// ---------------------------------------------------------------------------
// Médailles de contre-la-montre
// ---------------------------------------------------------------------------

/**
 * Seuils, exprimés en fraction du temps de référence (platine).
 * Le temps platine est calculé par `npm run calibrate` : c'est le temps d'un bot
 * difficile au volant de la voiture favorite du circuit, sans amélioration.
 */
export const SEUILS_MEDAILLES = { platine: 1.0, or: 1.05, argent: 1.12, bronze: 1.20 };

/** Crédits versés une seule fois par circuit et par médaille. */
export const GAINS_MEDAILLES = { bronze: 200, argent: 400, or: 700, platine: 1000 };

/** Du plus faible au plus fort. */
export const ORDRE_MEDAILLES = ['bronze', 'argent', 'or', 'platine'];

/** Crédits pour un record personnel battu. */
export const GAIN_RECORD = 50;
/** Marge minimale (s) pour qu'un record compte comme battu. */
export const MARGE_RECORD = 0.1;

/**
 * Meilleure médaille obtenue pour un temps donné.
 * @param {number} temps  temps au tour, en secondes
 * @param {{platine:number, or:number, argent:number, bronze:number}} cibles
 * @returns {string|null}
 */
export function medaillePourTemps(temps, cibles) {
  if (!cibles || !Number.isFinite(temps)) return null;
  for (let i = ORDRE_MEDAILLES.length - 1; i >= 0; i--) {
    const m = ORDRE_MEDAILLES[i];
    if (Number.isFinite(cibles[m]) && temps <= cibles[m]) return m;
  }
  return null;
}

/** Temps cibles des quatre médailles à partir du temps de référence platine. */
export function ciblesDepuisPlatine(tempsPlatine) {
  const c = {};
  for (const [m, f] of Object.entries(SEUILS_MEDAILLES)) c[m] = +(tempsPlatine * f).toFixed(3);
  return c;
}

// ---------------------------------------------------------------------------
// Bonus de style
// ---------------------------------------------------------------------------
export const BONUS_STYLE = {
  /** Crédits par dérapage relâché, selon le palier atteint. */
  derapage: [5, 10, 20],
  /** Crédits par saut de plus d'une seconde. */
  saut: 10,
  /** Durée minimale (s) d'un saut pour compter. */
  dureeSaut: 1.0,
  /** Crédits par looping franchi. */
  looping: 10,
  /** Plafond de bonus de style par course. */
  plafond: 150
};

/**
 * @param {{derapages?: number[], sauts?: number, loopings?: number}} stats
 *        derapages : nombre de dérapages relâchés par palier [p1, p2, p3]
 */
export function calculeBonusStyle(stats = {}) {
  const d = stats.derapages ?? [0, 0, 0];
  let total = 0;
  for (let i = 0; i < 3; i++) total += (d[i] ?? 0) * BONUS_STYLE.derapage[i];
  total += (stats.sauts ?? 0) * BONUS_STYLE.saut;
  total += (stats.loopings ?? 0) * BONUS_STYLE.looping;
  return Math.min(total, BONUS_STYLE.plafond);
}

// ---------------------------------------------------------------------------
// Améliorations
// ---------------------------------------------------------------------------

/** Coût du passage au niveau suivant, ou `null` si la statistique est au maximum. */
export function coutAmelioration(niveauActuel) {
  if (niveauActuel >= NIVEAU_MAX) return null;
  return COUTS_AMELIORATION[niveauActuel];
}

/** Coût total pour amener une statistique du niveau 0 au niveau `n`. */
export function coutCumule(n) {
  let total = 0;
  for (let i = 0; i < Math.min(n, NIVEAU_MAX); i++) total += COUTS_AMELIORATION[i];
  return total;
}

/** Coût pour améliorer une voiture entière au maximum, achat compris. */
export function coutVoitureComplete(idVoiture) {
  return VOITURES[idVoiture].prix + coutCumule(NIVEAU_MAX) * STATS.length;
}

// ---------------------------------------------------------------------------
// Défis
// ---------------------------------------------------------------------------

/**
 * Douze défis, trois par circuit. `condition` est évaluée côté serveur à partir
 * du résumé de course envoyé par le client et vérifié par le serveur.
 */
export const DEFIS = [
  {
    id: 'canyon-tempete',
    circuit: 'canyon',
    nom: 'Maître du canyon',
    description: 'Gagner une course au Canyon désertique avec la Tempête face à des bots difficiles.',
    gain: 600
  },
  {
    id: 'canyon-propre',
    circuit: 'canyon',
    nom: 'Sans accroc',
    description: 'Finir une course au Canyon désertique sans aucune réapparition.',
    gain: 400
  },
  {
    id: 'canyon-or',
    circuit: 'canyon',
    nom: 'Or du désert',
    description: 'Décrocher au moins la médaille d’or en contre-la-montre au Canyon.',
    gain: 500,
    peinture: 'dore'
  },
  {
    id: 'ville-derapages',
    circuit: 'ville',
    nom: 'Roi du drift',
    description: 'Réussir 5 dérapages de palier 3 en une seule course dans la Ville néon.',
    gain: 500,
    peinture: 'neon'
  },
  {
    id: 'ville-vipere',
    circuit: 'ville',
    nom: 'Serpent des rues',
    description: 'Gagner la Ville néon avec la Vipère face à des bots moyens ou difficiles.',
    gain: 450
  },
  {
    id: 'ville-platine',
    circuit: 'ville',
    nom: 'Platine nocturne',
    description: 'Décrocher la médaille de platine en contre-la-montre à la Ville néon.',
    gain: 800
  },
  {
    id: 'stade-sans-mur',
    circuit: 'stade',
    nom: 'Trajectoire parfaite',
    description: 'Boucler un tour du Stade futuriste sans toucher un seul mur.',
    gain: 500
  },
  {
    id: 'stade-loopings',
    circuit: 'stade',
    nom: 'Tête à l’envers',
    description: 'Franchir 6 loopings en une seule course au Stade futuriste.',
    gain: 400
  },
  {
    id: 'stade-frelon',
    circuit: 'stade',
    nom: 'Dard acrobatique',
    description: 'Gagner au Stade futuriste avec le Frelon face à des bots difficiles.',
    gain: 600,
    peinture: 'chrome'
  },
  {
    id: 'montagne-or',
    circuit: 'montagne',
    nom: 'Or blanc',
    description: 'Décrocher au moins la médaille d’or en contre-la-montre à la Montagne enneigée.',
    gain: 500
  },
  {
    id: 'montagne-nitro',
    circuit: 'montagne',
    nom: 'Chauffe la neige',
    description: 'Utiliser la nitro pendant au moins 20 secondes cumulées sur une course à la Montagne.',
    gain: 300,
    peinture: 'carbone'
  },
  {
    id: 'grand-prix-victoire',
    circuit: null,
    nom: 'Champion NITRO',
    description: 'Remporter le classement général d’un Grand Prix complet sur les 4 circuits.',
    gain: 800
  }
];

export const DEFIS_PAR_ID = Object.fromEntries(DEFIS.map((d) => [d.id, d]));

/** Défis attachés à un circuit donné. */
export const defisDuCircuit = (idCircuit) => DEFIS.filter((d) => d.circuit === idCircuit);

/**
 * Évalue les défis réussis à partir du résumé d'une course.
 *
 * @param {object} r  résumé validé par le serveur :
 *   { circuit, mode, voiture, position, arrive, reapparitions, derapagesPalier3,
 *     murs, loopings, dureeNitro, niveauAdversaires, medaille, gagnantGrandPrix }
 * @param {string[]} dejaReussis  identifiants déjà validés par le joueur
 * @returns {string[]} identifiants des défis nouvellement réussis
 */
export function evalueDefis(r, dejaReussis = []) {
  const acquis = new Set(dejaReussis);
  const reussis = [];
  const ajoute = (id, ok) => { if (ok && !acquis.has(id)) reussis.push(id); };

  const pire = r.niveauAdversaires ?? 'aucun';
  const gagne = r.position === 1 && r.arrive;

  ajoute('canyon-tempete', r.circuit === 'canyon' && gagne && r.voiture === 'tempete' && pire === 'difficile');
  ajoute('canyon-propre', r.circuit === 'canyon' && r.arrive && (r.reapparitions ?? 0) === 0 && r.mode !== 'contre-la-montre');
  ajoute('canyon-or', r.circuit === 'canyon' && ['or', 'platine'].includes(r.medaille));

  ajoute('ville-derapages', r.circuit === 'ville' && (r.derapagesPalier3 ?? 0) >= 5);
  ajoute('ville-vipere', r.circuit === 'ville' && gagne && r.voiture === 'vipere' && ['moyen', 'difficile', 'humain'].includes(pire));
  ajoute('ville-platine', r.circuit === 'ville' && r.medaille === 'platine');

  ajoute('stade-sans-mur', r.circuit === 'stade' && (r.tourSansMur ?? false));
  ajoute('stade-loopings', r.circuit === 'stade' && (r.loopings ?? 0) >= 6);
  ajoute('stade-frelon', r.circuit === 'stade' && gagne && r.voiture === 'frelon' && pire === 'difficile');

  ajoute('montagne-or', r.circuit === 'montagne' && ['or', 'platine'].includes(r.medaille));
  ajoute('montagne-nitro', r.circuit === 'montagne' && r.arrive && (r.dureeNitro ?? 0) >= 20);

  ajoute('grand-prix-victoire', r.gagnantGrandPrix === true);

  return reussis;
}

/**
 * Récompense complète d'une course, calculée côté serveur.
 *
 * @returns {{total:number, lignes:Array<{libelle:string, credits:number}>}}
 */
export function recompenseCourse({
  position,
  arrive,
  adversaires = [],
  bonusStyle = 0,
  defisReussis = [],
  medailles = []
}) {
  const lignes = [];
  const { cle, valeur } = multiplicateurAdversite(adversaires);

  const base = arrive ? (GAINS_COURSE[position - 1] ?? GAINS_COURSE.at(-1)) : GAIN_NON_ARRIVEE;
  const gainPlace = Math.round(base * valeur);
  lignes.push({
    libelle: arrive ? `${position}e place` : 'Course non terminée',
    credits: gainPlace,
    detail: valeur === 1 ? null : `${base} × ${valeur.toFixed(1).replace('.', ',')}`
  });

  if (bonusStyle > 0) lignes.push({ libelle: 'Bonus de style', credits: bonusStyle });

  for (const m of medailles) {
    lignes.push({ libelle: `Médaille de ${m}`, credits: GAINS_MEDAILLES[m] });
  }
  for (const id of defisReussis) {
    const d = DEFIS_PAR_ID[id];
    if (d) lignes.push({ libelle: `Défi : ${d.nom}`, credits: d.gain });
  }

  const total = lignes.reduce((s, l) => s + l.credits, 0);
  return { total, lignes, multiplicateur: valeur, adversite: cle };
}
