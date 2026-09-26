// Déroulement d'une course : grille, compte à rebours, simulation, classement
// en direct et arrivées.
//
// Cette classe ne connaît ni Three.js ni le DOM : elle ne fait qu'avancer la
// simulation et tenir les états. Le rendu et le HUD la lisent.

import {
  creerVoiture, pasPhysique, retourCheckpoint, videEvenements, progressionNormalisee
} from '@shared/physics.js';
import { creerBot, entreesBot, NIVEAUX } from '@shared/bots.js';
import { parametresVoiture, niveauMoyen } from '@shared/cars.js';
import { placeGrille } from '@shared/track.js';
import { COURSE } from '@shared/config.js';

export class Course {
  /**
   * @param {object} o
   *   circuit, ligne  : circuit construit et sa ligne de course
   *   participants    : [{ id, nom, humain, voiture, peinture, niveaux, niveau }]
   *   mode            : 'course' | 'contre-la-montre'
   *   tours           : nombre de tours
   */
  constructor(o) {
    this.circuit = o.circuit;
    this.ligne = o.ligne;
    this.mode = o.mode ?? 'course';
    this.tours = o.tours ?? this.circuit.tours;

    this.phase = 'compte';               // compte | course | fini
    this.tempsAvantDepart = COURSE.compteARebours + 1.2;
    this.temps = 0;
    this.chronoFin = null;               // délai après l'arrivée du premier
    this.evenements = [];

    this.participants = o.participants.map((p, rang) => this.creeParticipant(p, rang));
    this.moi = this.participants.find((p) => p.humain) ?? this.participants[0];
    this.classement = [...this.participants];
  }

  creeParticipant(p, rang) {
    const params = parametresVoiture(p.voiture, p.niveaux ?? {});
    const depart = placeGrille(this.circuit, rang, COURSE.grille);
    const etat = creerVoiture(this.circuit, params, depart, { tours: this.tours });

    return {
      ...p,
      rang,
      params,
      etat,
      // Un pilote automatique est préparé pour tout le monde, humains compris :
      // il sert au réglage et, en multijoueur, à reprendre la voiture d'un
      // joueur déconnecté jusqu'à la fin de la course.
      bot: creerBot(this.circuit, this.ligne, p.niveau ?? 'moyen', 1000 + rang * 977),
      pilotageAuto: false,
      arrive: false,
      abandonne: false,
      position: rang + 1,
      tempsFinal: null,
      meilleurTour: null,
      derniereEntree: { accel: 0, frein: 0, direction: 0, derapage: false, nitro: false }
    };
  }

  // -------------------------------------------------------------------------
  // Boucle
  // -------------------------------------------------------------------------

  /**
   * @param {number} dt
   * @param {object} entreesJoueur  entrées clavier du joueur local
   */
  maj(dt, entreesJoueur) {
    this.temps += dt;

    if (this.phase === 'compte') {
      this.tempsAvantDepart -= dt;
      if (this.tempsAvantDepart <= 0) {
        this.phase = 'course';
        // Le chronomètre de chaque voiture démarre maintenant.
        for (const p of this.participants) p.etat.temps = 0;
      }
      return;
    }

    if (this.phase === 'fini') return;

    for (const p of this.participants) {
      if (p.arrive) continue;

      const entrees = (p.humain && !p.pilotageAuto)
        ? entreesJoueur
        : entreesBot(p.bot, p.etat, this.circuit, dt);
      p.derniereEntree = entrees;

      pasPhysique(p.etat, entrees, dt, this.circuit);
      this.recolteEvenements(p);

      if (p.etat.progression.termine && !p.arrive) this.franchitArrivee(p);
    }

    this.majClassement();
    this.majFinDeCourse(dt);
  }

  recolteEvenements(p) {
    const evs = videEvenements(p.etat);
    for (const ev of evs) {
      this.evenements.push({ ...ev, participant: p });
      if (ev.type === 'tour' && p.etat.progression.tempsTours.length > 0) {
        const dernier = p.etat.progression.tempsTours.at(-1);
        if (p.meilleurTour === null || dernier < p.meilleurTour) p.meilleurTour = dernier;
      }
    }
  }

  franchitArrivee(p) {
    p.arrive = true;
    p.tempsFinal = p.etat.progression.tempsTotal;
    const tours = p.etat.progression.tempsTours;
    if (tours.length > 0) p.meilleurTour = Math.min(...tours);

    if (this.chronoFin === null) {
      // Après l'arrivée du premier, les autres ont un temps limité pour finir.
      this.chronoFin = COURSE.delaiApresPremier;
      this.evenements.push({ type: 'premier-arrive', participant: p });
    }
  }

  majFinDeCourse(dt) {
    if (this.chronoFin !== null) {
      this.chronoFin -= dt;
      if (this.chronoFin <= 0) {
        for (const p of this.participants) {
          if (!p.arrive) p.abandonne = true;
        }
      }
    }
    if (this.participants.every((p) => p.arrive || p.abandonne)) {
      this.phase = 'fini';
      this.majClassement();
      this.evenements.push({ type: 'course-finie' });
    }
  }

  /**
   * Les arrivés se classent au temps, les autres à la distance parcourue :
   * un participant qui ne franchit pas la ligne est classé sur sa progression.
   */
  majClassement() {
    this.classement.sort((a, b) => {
      if (a.arrive && b.arrive) return a.tempsFinal - b.tempsFinal;
      if (a.arrive) return -1;
      if (b.arrive) return 1;
      return b.etat.progression.avancement - a.etat.progression.avancement;
    });
    this.classement.forEach((p, i) => { p.position = i + 1; });
  }

  // -------------------------------------------------------------------------
  // Actions du joueur
  // -------------------------------------------------------------------------

  retourDernierCheckpoint() {
    if (this.phase !== 'course' || this.moi.arrive) return;
    retourCheckpoint(this.moi.etat, this.circuit);
  }

  /** Confie la voiture d'un participant à un bot (déconnexion, réglage). */
  confieABot(participant, niveau = 'moyen') {
    participant.pilotageAuto = true;
    participant.bot = creerBot(this.circuit, this.ligne, niveau, 1000 + participant.rang * 977);
  }

  /** Écart de temps ou de distance avec le participant qui précède. */
  ecartAvec(p) {
    const i = this.classement.indexOf(p);
    if (i <= 0) return null;
    const devant = this.classement[i - 1];
    if (p.arrive && devant.arrive) return { type: 'temps', valeur: p.tempsFinal - devant.tempsFinal };
    const d = (devant.etat.progression.avancement - p.etat.progression.avancement);
    return { type: 'distance', valeur: d };
  }

  videEvenements() {
    const e = this.evenements;
    this.evenements = [];
    return e;
  }

  /** Progression en tours décimaux, pour la minimap et le classement. */
  progression(p) {
    return progressionNormalisee(p.etat, this.circuit);
  }

  // -------------------------------------------------------------------------
  // Résultats
  // -------------------------------------------------------------------------

  resultats() {
    return this.classement.map((p, i) => ({
      position: i + 1,
      id: p.id,
      nom: p.nom,
      humain: p.humain,
      niveau: p.niveau ?? null,
      voiture: p.voiture,
      arrive: p.arrive,
      temps: p.tempsFinal,
      meilleurTour: p.meilleurTour,
      tours: p.etat.progression.tour,
      stats: { ...p.etat.stats },
      progression: this.progression(p)
    }));
  }

  /**
   * Adversaires du joueur local, pour le calcul du multiplicateur d'adversité.
   * Le serveur refait ce calcul de son côté : ceci ne sert qu'à l'affichage.
   */
  adversaires() {
    return this.participants
      .filter((p) => p !== this.moi)
      .map((p) => (p.humain ? { type: 'humain' } : { type: 'bot', niveau: p.niveau }));
  }

  /** Niveau du plus fort adversaire, tel qu'attendu par les défis. */
  niveauAdversaires() {
    const ordre = { facile: 1, moyen: 2, difficile: 3 };
    let pire = 'aucun';
    for (const a of this.adversaires()) {
      const cle = a.type === 'humain' ? 'humain' : a.niveau;
      const force = cle === 'humain' ? 3 : ordre[cle] ?? 0;
      const forcePire = pire === 'humain' ? 3 : ordre[pire] ?? 0;
      if (force > forcePire) pire = cle;
    }
    return pire;
  }
}

/** Niveau d'amélioration moyen des humains d'une course, pour caler les bots. */
export function moyenneHumains(participants) {
  const humains = participants.filter((p) => p.humain);
  if (humains.length === 0) return 0;
  return humains.reduce((s, p) => s + niveauMoyen(p.niveaux ?? {}), 0) / humains.length;
}

export { NIVEAUX };
