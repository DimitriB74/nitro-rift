// Simulation d'une course sans affichage.
//
// Sert au script de calibration des médailles et aux vérifications de physique.
// C'est exactement le même code que celui qui tourne dans le navigateur : si un
// bot boucle ici, il boucle en jeu.

import { creerVoiture, pasPhysique, progressionNormalisee } from '../shared/physics.js';
import { creerBot, entreesBot } from '../shared/bots.js';
import { parametresVoiture } from '../shared/cars.js';
import { placeGrille } from '../shared/track.js';
import { COURSE } from '../shared/config.js';

/**
 * Fait tourner un bot seul sur un circuit.
 *
 * @param {object} circuit
 * @param {object} ligne     ligne de course
 * @param {object} o
 *   voiture   : identifiant de voiture
 *   niveaux   : niveaux d'amélioration
 *   niveau    : difficulté du bot
 *   tours     : nombre de tours à simuler
 *   dt        : pas de temps (défaut 1/60 s, comme une image de jeu)
 *   tempsMax  : garde-fou en secondes simulées
 * @returns {{termine, tempsTours, tempsTotal, etat, vitesseMax, vitesseMoyenne}}
 */
export function simuleBot(circuit, ligne, o = {}) {
  const voiture = o.voiture ?? circuit.voitureFavorite;
  const params = parametresVoiture(voiture, o.niveaux ?? {});
  const depart = placeGrille(circuit, o.rang ?? 0, COURSE.grille);

  const etat = creerVoiture(circuit, params, depart);
  const bot = creerBot(circuit, ligne, o.niveau ?? 'difficile', o.graine ?? 7);

  const dt = o.dt ?? 1 / 60;
  const tempsMax = o.tempsMax ?? 600;
  const toursVises = o.tours ?? circuit.tours;

  let vitesseMax = 0;
  let sommeVitesse = 0;
  let pas = 0;

  while (etat.temps < tempsMax && !etat.progression.termine) {
    const entrees = entreesBot(bot, etat, circuit, dt);
    pasPhysique(etat, entrees, dt, circuit);
    vitesseMax = Math.max(vitesseMax, etat.vitesseScalaire);
    sommeVitesse += etat.vitesseScalaire;
    pas++;
    if (etat.progression.tour > toursVises) break;
  }

  return {
    termine: etat.progression.termine,
    tempsTours: etat.progression.tempsTours.slice(),
    tempsTotal: etat.progression.tempsTotal,
    tour: etat.progression.tour,
    etat,
    vitesseMax,
    vitesseMoyenne: pas > 0 ? sommeVitesse / pas : 0,
    reapparitions: etat.stats.reapparitions,
    murs: etat.stats.murs,
    loopings: etat.stats.loopings,
    progression: progressionNormalisee(etat, circuit)
  };
}

/**
 * Meilleur temps au tour d'un bot, départ lancé.
 * On ignore le premier tour : il part à l'arrêt et n'est pas représentatif.
 */
export function meilleurTour(circuit, ligne, o = {}) {
  const r = simuleBot(circuit, ligne, { ...o, tours: o.tours ?? 4 });
  const tours = r.tempsTours.slice(1);
  return {
    ...r,
    meilleur: tours.length > 0 ? Math.min(...tours) : null,
    tours
  };
}

export const formateTemps = (t) => {
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0
    ? `${m}:${s.toFixed(3).padStart(6, '0')}`
    : `${s.toFixed(3)}`;
};
