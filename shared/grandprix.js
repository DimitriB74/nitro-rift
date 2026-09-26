// Grand Prix : championnat enchaînant plusieurs circuits.
//
// Ce module ne connaît ni le réseau, ni le DOM, ni la physique : il reçoit le
// classement d'une course et tient le tableau des points. Le solo et le
// multijoueur l'utilisent tous les deux, ce qui garantit que les deux modes
// comptent les points de la même manière.

import { COURSE } from './config.js';

/** Points attribués par position d'arrivée, de la 1re à la 8e. */
export const POINTS = COURSE.points;

/** Circuits d'un Grand Prix complet, dans l'ordre. */
export const CIRCUITS_GP = COURSE.grandPrix;

/** Points gagnés pour une position (0 au-delà du barème). */
export function pointsPourPosition(position) {
  return POINTS[position - 1] ?? 0;
}

/**
 * Crée l'état d'un Grand Prix.
 *
 * @param {string[]} circuits      identifiants des circuits, dans l'ordre
 * @param {Array<{id:string, nom:string, humain?:boolean, bot?:boolean, voiture?:string}>} participants
 * @returns {object} état du Grand Prix
 */
export function creerGrandPrix(circuits, participants) {
  return {
    circuits: circuits.slice(),
    /** Index de la course en cours ou à venir (0 = première). */
    index: 0,
    /** Une entrée par participant, dans l'ordre d'inscription. */
    lignes: participants.map((p) => ({
      id: p.id,
      nom: p.nom,
      humain: p.humain ?? false,
      bot: p.bot ?? !(p.humain ?? false),
      voiture: p.voiture ?? null,
      points: 0,
      /** Position obtenue à chaque course, `null` si absent. */
      positions: [],
      /** Meilleur tour du championnat, toutes courses confondues. */
      meilleurTour: null,
    })),
  };
}

/** Circuit de la course en cours, ou `null` si le championnat est terminé. */
export function circuitCourant(gp) {
  return gp.circuits[gp.index] ?? null;
}

/** Vrai quand les quatre courses ont été disputées. */
export function grandPrixTermine(gp) {
  return gp.index >= gp.circuits.length;
}

/** Numéro de la manche affichée à l'écran, à partir de 1. */
export function mancheCourante(gp) {
  return Math.min(gp.index + 1, gp.circuits.length);
}

/**
 * Enregistre le classement d'une course et avance d'une manche.
 *
 * @param {object} gp
 * @param {Array<{id:string, position:number, meilleurTour?:number|null}>} classement
 */
export function enregistreCourse(gp, classement) {
  const manche = gp.index;

  for (const ligne of gp.lignes) {
    const r = classement.find((c) => c.id === ligne.id);
    // Un participant absent d'une manche (déconnexion) garde ses points mais
    // n'en gagne aucun : sa position reste `null`.
    ligne.positions[manche] = r ? r.position : null;
    if (r) {
      ligne.points += pointsPourPosition(r.position);
      if (Number.isFinite(r.meilleurTour) &&
          (ligne.meilleurTour === null || r.meilleurTour < ligne.meilleurTour)) {
        ligne.meilleurTour = r.meilleurTour;
      }
    }
  }

  gp.index = manche + 1;
  return gp;
}

/**
 * Classement général, du premier au dernier.
 *
 * Égalité : c'est la dernière course disputée qui départage — comme en sport
 * automobile, la manche la plus récente prime. Si elle ne suffit pas (deux
 * absents), on remonte de manche en manche, puis on compare les meilleurs
 * tours, et enfin le nom pour rester déterministe.
 */
export function classementGeneral(gp) {
  const lignes = gp.lignes.slice();

  lignes.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;

    for (let m = gp.index - 1; m >= 0; m--) {
      const pa = a.positions[m];
      const pb = b.positions[m];
      if (pa == null && pb == null) continue;
      if (pa == null) return 1;
      if (pb == null) return -1;
      if (pa !== pb) return pa - pb;
    }

    const ta = a.meilleurTour ?? Infinity;
    const tb = b.meilleurTour ?? Infinity;
    if (ta !== tb) return ta - tb;
    return a.nom.localeCompare(b.nom);
  });

  return lignes.map((l, i) => ({ ...l, place: i + 1 }));
}

/**
 * Inscrit au championnat les participants qui n'y sont pas encore.
 *
 * Utile en multijoueur : quelqu'un peut rejoindre le salon entre deux manches.
 * Il démarre alors à zéro point, ce qui est la seule option honnête.
 *
 * @returns {number} nombre de participants ajoutés
 */
export function ajouteParticipants(gp, participants) {
  let ajoutes = 0;
  for (const p of participants) {
    if (gp.lignes.some((l) => l.id === p.id)) continue;
    gp.lignes.push({
      id: p.id,
      nom: p.nom,
      humain: p.humain ?? false,
      bot: p.bot ?? !(p.humain ?? false),
      voiture: p.voiture ?? null,
      points: 0,
      // Absent des manches déjà courues : ses positions restent vides.
      positions: [],
      meilleurTour: null,
    });
    ajoutes++;
  }
  return ajoutes;
}

/** Retire du championnat un participant qui a quitté définitivement. */
export function retireParticipant(gp, id) {
  const i = gp.lignes.findIndex((l) => l.id === id);
  if (i >= 0) gp.lignes.splice(i, 1);
  return i >= 0;
}

/** Vue transmissible au client : tableau du championnat et manche en cours. */
export function grandPrixPublic(gp) {
  if (!gp) return null;
  return {
    circuits: gp.circuits,
    manche: mancheCourante(gp),
    manches: gp.circuits.length,
    termine: grandPrixTermine(gp),
    prochain: circuitCourant(gp),
    classement: classementGeneral(gp).map((l) => ({
      place: l.place,
      id: l.id,
      nom: l.nom,
      bot: l.bot,
      voiture: l.voiture,
      points: l.points,
      positions: l.positions.slice(),
      meilleurTour: l.meilleurTour,
    })),
  };
}
