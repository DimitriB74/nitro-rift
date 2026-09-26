// Pilotes automatiques.
//
// Un bot ne triche pas : il produit les mêmes entrées qu'un joueur (accélérer,
// freiner, tourner, déraper, nitro) et passe par la même physique. Il suit une
// ligne de course précalculée par /shared/track.js, dont il n'exploite qu'une
// fraction selon sa difficulté.

import * as G from './geom.js';
import { positionMonde, frameA } from './track.js';
import { IDS_VOITURES, VOITURES, niveauxUniformes, NIVEAU_MAX } from './cars.js';

export const NIVEAUX = {
  facile: {
    id: 'facile',
    nom: 'Facile',
    /** Fraction de la vitesse cible visée. */
    fractionVitesse: 0.85,
    /** Marge de freinage : plus c'est grand, plus il freine tôt. */
    anticipation: 1.45,
    /** Amplitude des erreurs de trajectoire (m). */
    erreur: 2.6,
    /** Fréquence des erreurs (Hz). */
    frequenceErreur: 0.35,
    /** Réactivité du volant. */
    gainVolant: 1.5,
    derape: false,
    nitro: 'hasard',
    /** Décalage du niveau d'amélioration par rapport aux joueurs humains. */
    decalageAmelioration: -2
  },
  moyen: {
    id: 'moyen',
    nom: 'Moyen',
    fractionVitesse: 0.92,
    anticipation: 1.18,
    erreur: 1.2,
    frequenceErreur: 0.22,
    gainVolant: 2.1,
    derape: true,
    nitro: 'plein',
    decalageAmelioration: 0
  },
  difficile: {
    id: 'difficile',
    nom: 'Difficile',
    fractionVitesse: 0.995,
    anticipation: 1.02,
    erreur: 0.25,
    frequenceErreur: 0.1,
    gainVolant: 2.8,
    derape: true,
    nitro: 'optimal',
    decalageAmelioration: +1
  }
};

export const IDS_NIVEAUX = ['facile', 'moyen', 'difficile'];

/** Pseudos de bots, tirés au hasard sans répétition dans une même course. */
export const PSEUDOS_BOTS = [
  'Turbo Roger', 'Mémé Nitro', 'Le Frein Cassé', 'Capitaine Dérapage', 'Jean-Pneu',
  'Bolide Bernard', 'Zigzag Zoé', 'Vitesse Lumière', 'Pilote Patate', 'Gaston Gomme',
  'Fusée Fanny', 'Baptiste Béton', 'Klaxon King', 'Tonton Tremplin', 'Virage Victor',
  'Sonia Survirage', 'Chrono Chloé', 'Marcel Marche-Arrière', 'Nitro Nadia', 'Le Fantôme',
  'Roue Libre', 'Didier Dérapage', 'Bitume Brigitte', 'Zoubir Zéro-Cent'
];

/** Générateur pseudo-aléatoire déterministe : deux simulations donnent le même résultat. */
export function creerAlea(graine = 1) {
  let x = graine >>> 0 || 1;
  return function alea() {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

/** Tire `n` pseudos distincts. */
export function tirePseudos(n, alea = Math.random) {
  const dispo = [...PSEUDOS_BOTS];
  const sortis = [];
  for (let i = 0; i < n; i++) {
    if (dispo.length === 0) { sortis.push(`Bot ${i + 1}`); continue; }
    sortis.push(dispo.splice(Math.floor(alea() * dispo.length), 1)[0]);
  }
  return sortis;
}

/**
 * Niveau d'amélioration des bots, calé sur celui des joueurs humains de la course.
 * @param {number} moyenneHumains  niveau moyen des humains (0 à 5)
 * @param {string} niveau          'facile' | 'moyen' | 'difficile'
 */
export function niveauAmeliorationBot(moyenneHumains, niveau) {
  const d = NIVEAUX[niveau].decalageAmelioration;
  return Math.max(0, Math.min(NIVEAU_MAX, Math.round(moyenneHumains + d)));
}

/** Niveaux d'amélioration complets d'un bot. */
export const ameliorationsBot = (moyenneHumains, niveau) =>
  niveauxUniformes(niveauAmeliorationBot(moyenneHumains, niveau));

/**
 * Choix de voiture : les bots difficiles prennent la voiture favorite du circuit,
 * les autres tirent au hasard.
 */
export function choisitVoiture(circuit, niveau, alea = Math.random) {
  if (niveau === 'difficile') return circuit.voitureFavorite ?? IDS_VOITURES[0];
  return IDS_VOITURES[Math.floor(alea() * IDS_VOITURES.length)];
}

// ---------------------------------------------------------------------------
// Pilotage
// ---------------------------------------------------------------------------

/**
 * @param {object} circuit
 * @param {object} ligne    ligne de course construite par construireLigneCourse()
 * @param {string} niveau
 * @param {number} graine
 */
export function creerBot(circuit, ligne, niveau, graine = 1) {
  const reglages = NIVEAUX[niveau] ?? NIVEAUX.moyen;
  return {
    niveau: reglages.id,
    reglages,
    ligne,
    alea: creerAlea(graine),
    erreurActuelle: 0,
    erreurCible: 0,
    minuteurErreur: 0,
    minuteurNitro: 2 + (graine % 5),
    bloque: 0
  };
}

/**
 * Produit les entrées du bot pour ce pas de temps.
 * @returns {{accel, frein, direction, derapage, nitro}}
 */
export function entreesBot(bot, etat, circuit, dt) {
  const r = bot.reglages;
  const p = etat.params;
  const v = etat.vitesseScalaire;

  // --- Erreur de trajectoire, renouvelée régulièrement ---------------------
  bot.minuteurErreur -= dt;
  if (bot.minuteurErreur <= 0) {
    bot.minuteurErreur = 1 / r.frequenceErreur;
    bot.erreurCible = (bot.alea() * 2 - 1) * r.erreur;
  }
  bot.erreurActuelle = G.lissage(bot.erreurActuelle, bot.erreurCible, 1.5, dt);

  // --- Point visé sur la ligne de course -----------------------------------
  // On regarde d'autant plus loin qu'on va vite, sinon le bot zigzague. Mais
  // dans une épingle il faut au contraire regarder court : viser 40° d'arc plus
  // loin ferait couper le virage et partir au mur extérieur.
  const courbure = Math.abs(frameA(circuit, etat.s + 8).courbureLaterale) + 1e-4;
  const avance = Math.min(G.serre(v * 0.55, 9, 40), 0.35 / courbure);
  const sCible = etat.s + avance;
  const nCible = bot.ligne.decalageA(sCible) + bot.erreurActuelle;
  const cible = positionMonde(circuit, sCible, nCible, 0);

  const versCible = G.soustrait(cible, etat.pos);
  const lat = G.normalise(G.produitVectoriel(etat.haut, etat.avant));
  const angle = Math.atan2(
    G.produitScalaire(versCible, lat),
    G.produitScalaire(versCible, etat.avant)
  );
  // `direction` positive fait tourner vers -lat : d'où le signe.
  let direction = G.serre(-angle * r.gainVolant, -1, 1);

  // --- Vitesse cible -------------------------------------------------------
  // On regarde plus loin encore pour le freinage, proportionnellement à la
  // distance nécessaire pour ralentir.
  const distanceFreinage = (v * v) / (2 * 26) * r.anticipation;
  const sFrein = etat.s + Math.max(avance, distanceFreinage);
  const vLigne = Math.min(bot.ligne.vitesseA(sCible), bot.ligne.vitesseA(sFrein));
  const vCible = Math.min(vLigne * r.fractionVitesse, p.vitesseMax * r.fractionVitesse);

  let accel = 0;
  let frein = 0;
  if (v < vCible - 1.5) accel = 1;
  else if (v > vCible + 2.5) frein = G.serre((v - vCible) / 12, 0, 1);
  else accel = 0.45;

  // --- Dérapage ------------------------------------------------------------
  // Le dérapage ne sert que dans les épingles lentes : il fait pivoter la voiture
  // plus vite, au prix des deux tiers de l'adhérence. L'engager dans un virage
  // relevé rapide envoie tout droit à l'extérieur — dans le vide, au Stade.
  let derapage = false;
  if (r.derape) {
    const courbureVirage = Math.abs(frameA(circuit, etat.s + 12).courbureLaterale);
    derapage = courbureVirage > 0.018 && v > 20 && v < 42 && Math.abs(direction) > 0.3;
    if (r.id === 'moyen' && bot.alea() < 0.25 * dt * 60) derapage = false;
  }

  // --- Nitro ---------------------------------------------------------------
  let nitro = false;
  const jaugePleine = etat.nitro.jauge / p.nitroCapacite;
  if (r.nitro === 'optimal') {
    const f = frameA(circuit, etat.s + 30);
    // En ligne droite, et seulement si la réserve est confortable.
    nitro = Math.abs(f.courbureLaterale) < 0.0025 && jaugePleine > 0.45 && v > 30;
  } else if (r.nitro === 'plein') {
    nitro = jaugePleine > 0.9 || (etat.nitro.actif && jaugePleine > 0.15);
  } else {
    bot.minuteurNitro -= dt;
    if (bot.minuteurNitro <= 0) {
      bot.minuteurNitro = 5 + bot.alea() * 10;
      bot.nitroJusqua = etat.temps + 1 + bot.alea() * 2;
    }
    nitro = jaugePleine > 0.2 && etat.temps < (bot.nitroJusqua ?? 0);
  }

  // --- Anti-blocage : si le bot n'avance plus, il se remet dans l'axe -------
  if (v < 3 && !etat.reapparition.actif) {
    bot.bloque += dt;
    if (bot.bloque > 2.5) {
      accel = 1; frein = 0; derapage = false;
      const f = frameA(circuit, etat.s);
      // S'il est à contresens, il fait demi-tour.
      if (G.produitScalaire(etat.avant, f.avant) < 0) direction = 1;
    }
  } else {
    bot.bloque = 0;
  }

  return { accel, frein, direction, derapage, nitro };
}

/** Description lisible d'un bot, pour le salon et le classement. */
export function descriptionBot(nom, niveau, idVoiture) {
  return {
    nom,
    niveau,
    voiture: idVoiture,
    libelle: `${nom} — ${VOITURES[idVoiture]?.nom ?? idVoiture} (${NIVEAUX[niveau].nom})`
  };
}
