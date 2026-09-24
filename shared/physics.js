// Physique arcade de NITRO RIFT.
//
// Aucun moteur physique externe : la voiture est un point orienté, repéré par
// rapport au ruban de la piste. La gravité « utile » est celle qui s'exprime le
// long du vecteur haut de la piste, ce qui permet de rouler dans les loopings,
// sur les virages relevés, dans les tire-bouchons et sur les murs verticaux.
//
// Ce module tourne à l'identique dans le navigateur et sur le serveur : c'est ce
// qui garantit que les bots du multijoueur se comportent comme ceux du solo.

import * as G from './geom.js';
import { PHYS, SURFACES } from './config.js';
import {
  projeter, frameA, positionMonde, surfaceA, coeffSurface,
  dansLooping, checkpointPrecedent
} from './track.js';

const HAUT_MONDE = G.v3(0, 1, 0);

/** Entrées neutres : sert de base et de garde-fou. */
export const ENTREES_NEUTRES = Object.freeze({
  accel: 0, frein: 0, direction: 0, derapage: false, nitro: false
});

export function normaliseEntrees(e = {}) {
  return {
    accel: G.serre(+e.accel || 0, 0, 1),
    frein: G.serre(+e.frein || 0, 0, 1),
    direction: G.serre(+e.direction || 0, -1, 1),
    derapage: !!e.derapage,
    nitro: !!e.nitro
  };
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

/**
 * @param {object} circuit   circuit construit par construireCircuit()
 * @param {object} params    paramètres physiques issus de parametresVoiture()
 * @param {object} depart    { s, n }
 */
export function creerVoiture(circuit, params, depart = { s: 0, n: 0 }) {
  const f = frameA(circuit, depart.s);
  const pos = positionMonde(circuit, depart.s, depart.n ?? 0, 0);

  const etat = {
    params,
    circuitId: circuit.id,

    // Repère monde
    pos,
    vit: G.v3(),
    avant: G.copie(f.avant),
    haut: G.copie(f.haut),

    // Repère piste (mis à jour à chaque pas)
    s: depart.s,
    n: depart.n ?? 0,
    h: 0,
    index: 0,
    auSol: true,
    surface: f.surface,

    vitesseScalaire: 0,
    regime: 0,

    derapage: { actif: false, duree: 0, palier: 0, intensite: 0 },
    nitro: { jauge: 0, actif: false },

    tempsEnVol: 0,
    loopingEnCours: null,
    contactMur: 0,

    reapparition: { actif: false, minuteur: 0 },

    progression: {
      avancement: 0,
      valides: 0,
      tour: 0,
      dernierCheckpoint: { s: 0, index: 0 },
      tempsCheckpoints: [],
      termine: false,
      tempsTotal: 0,
      tempsTours: [],
      mursCeTour: 0
    },

    stats: {
      derapages: [0, 0, 0],
      sauts: 0,
      loopings: 0,
      murs: 0,
      reapparitions: 0,
      dureeNitro: 0,
      tourSansMur: false
    },

    evenements: [],
    temps: 0
  };

  // La grille de départ se trouve avant la ligne : l'avancement démarre négatif.
  etat.progression.avancement = G.ecartCirculaire(depart.s, 0, circuit.longueur);
  if (etat.progression.avancement > 0) etat.progression.avancement -= circuit.longueur;
  etat.index = projeter(circuit, pos, -1).index;
  return etat;
}

const evenement = (etat, type, donnees = {}) => etat.evenements.push({ type, ...donnees });

// ---------------------------------------------------------------------------
// Boucle : sous-pas fixes
// ---------------------------------------------------------------------------

/**
 * Avance la simulation de `dt` secondes en sous-pas de taille fixe.
 * Le pas fixe évite que le comportement dépende de la fréquence d'images :
 * indispensable pour que le client et le serveur obtiennent le même résultat.
 */
export function pasPhysique(etat, entrees, dt, circuit, options = {}) {
  const e = normaliseEntrees(entrees);
  const pas = PHYS.pasFixe;
  let reste = Math.min(dt, pas * PHYS.sousPasMax);
  let n = 0;
  while (reste > 1e-6 && n < PHYS.sousPasMax) {
    const h = Math.min(pas, reste);
    sousPas(etat, e, h, circuit, options);
    reste -= h;
    n++;
  }
  etat.vitesseScalaire = G.norme(etat.vit);
  etat.regime = G.serre(etat.vitesseScalaire / etat.params.vitesseMax, 0, 1.3);
  return etat;
}

// ---------------------------------------------------------------------------
// Un sous-pas
// ---------------------------------------------------------------------------

function sousPas(etat, e, dt, circuit, options) {
  etat.temps += dt;

  if (etat.reapparition.actif) {
    gereReapparition(etat, dt, circuit);
    return;
  }

  const gVec = G.v3(0, -PHYS.gravite, 0);

  // --- Où sommes-nous sur la piste ? --------------------------------------
  const proj = projeter(circuit, etat.pos, etat.index, 70);
  etat.index = proj.index;
  etat.s = proj.s;
  etat.n = proj.n;
  etat.h = proj.h;
  const f = proj.frame;
  const demi = f.largeur / 2;

  const nomSurface = surfaceA(circuit, f, proj.n);
  const surf = coeffSurface(nomSurface);
  etat.surface = nomSurface;

  // Vitesse le long de la piste, utilisée pour l'accélération centripète.
  const vTangente = G.produitScalaire(etat.vit, f.avant);

  // --- Nitro ---------------------------------------------------------------
  majNitro(etat, e, dt);

  if (etat.auSol) {
    // Trou dans la piste : il n'y a rien sous les roues.
    if (f.surface === 'vide') {
      decolle(etat, 'vide');
      enVol(etat, e, dt, circuit, gVec);
      return;
    }

    // -----------------------------------------------------------------------
    // Force normale : N/m = v²·κ_n − g⃗·n̂
    //
    // Sur le plat  : κ_n = 0, n̂ = haut  → N = +g       (la voiture tient)
    // En haut d'un looping : n̂ pointe vers le bas → N = v²/R − g
    //   il faut donc v² ≥ gR pour ne pas décrocher : il faut arriver lancé.
    // -----------------------------------------------------------------------
    const N = vTangente * vTangente * f.courbureNormale - G.produitScalaire(gVec, f.haut);

    if (N < 0) {
      // Décrochage : la piste ne peut plus retenir la voiture.
      decolle(etat, 'decrochage');
    } else if (proj.h > PHYS.hauteurAccroche) {
      decolle(etat, 'bosse');
    } else {
      auSol(etat, e, dt, circuit, proj, f, surf, N, gVec);
      return;
    }
  }

  enVol(etat, e, dt, circuit, gVec);
}

// ---------------------------------------------------------------------------
// Roulage
// ---------------------------------------------------------------------------

function auSol(etat, e, dt, circuit, proj, f, surf, N, gVec) {
  const p = etat.params;
  const nHaut = f.haut;

  // Orientation : le haut de la voiture rejoint celui de la piste.
  etat.haut = G.tourneVers(etat.haut, nHaut, 14 * dt);
  etat.avant = G.normalise(G.orthogonalise(etat.avant, etat.haut));

  // Vitesse projetée dans le plan de la route.
  let vPlan = G.orthogonalise(etat.vit, nHaut);
  let vf = G.produitScalaire(vPlan, etat.avant);

  // --- Dérapage ------------------------------------------------------------
  majDerapage(etat, e, dt, vf);
  const derape = etat.derapage.actif;

  // --- Direction -----------------------------------------------------------
  const vAbs = Math.abs(vf);
  // Le braquage s'assouplit avec la vitesse, sinon la voiture pivote sur place
  // à 300 km/h. Il s'annule aussi presque à l'arrêt.
  const facteurVitesse = 1 / (1 + vAbs / 52);
  const facteurDemarrage = G.serre(vAbs / 5, 0, 1);
  let taux = e.direction * p.maniabilite * facteurVitesse * facteurDemarrage;
  if (derape) taux *= PHYS.bonusLacetDerapage;
  if (vf < -0.5) taux = -taux; // marche arrière : la voiture tourne à l'envers

  // `lateral = haut × avant` : une rotation positive autour du haut tourne vers
  // ce latéral, donc vers la gauche à l'écran. D'où le signe négatif.
  etat.avant = G.normalise(G.tourneAutour(etat.avant, etat.haut, -taux * dt));

  const lat = G.normalise(G.produitVectoriel(etat.haut, etat.avant));
  vf = G.produitScalaire(vPlan, etat.avant);
  let vl = G.produitScalaire(vPlan, lat);

  // --- Forces longitudinales ----------------------------------------------
  const vMaxEff = p.vitesseMax * (etat.nitro.actif ? PHYS.nitroSurvitesse : 1);
  let aLong = 0;

  if (e.accel > 0) {
    const courbe = G.serre(1 - Math.pow(Math.max(vf, 0) / vMaxEff, 3), 0, 1);
    aLong += e.accel * p.acceleration * courbe;
  }
  if (etat.nitro.actif) aLong += PHYS.nitroPoussee * p.nitroPuissance;

  if (e.frein > 0) {
    if (vf > 0.5) aLong -= e.frein * PHYS.freinage;
    else aLong -= e.frein * p.acceleration * PHYS.marcheArriere;
  }

  // Résistances : roulement, traînée, et pénalité de surface hors piste.
  const signeV = vf > 0 ? 1 : vf < 0 ? -1 : 0;
  const penaliteSurface = (surf.ralentissement - 1) * 6.0;
  aLong -= signeV * (PHYS.roulement + penaliteSurface);
  aLong -= PHYS.trainee * vf * Math.abs(vf);

  // L'adhérence disponible limite ce que les pneus peuvent transmettre.
  const aLongMax = PHYS.adherenceLongitudinale * N * surf.adherence;
  aLong = G.serre(aLong, -aLongMax, aLongMax);

  vf += aLong * dt;
  // On n'inverse pas le sens par simple frottement.
  if (signeV !== 0 && Math.sign(vf) !== signeV && e.accel === 0 && e.frein === 0) vf = 0;

  // --- Adhérence latérale --------------------------------------------------
  let muLat = p.adherence * surf.adherence;
  if (derape) muLat *= PHYS.adherenceEnDerapage;
  const aLatMax = muLat * N;
  let aLat = -vl / dt;
  if (Math.abs(aLat) > aLatMax) aLat = Math.sign(aLat) * aLatMax;
  vl += aLat * dt;

  etat.derapage.intensite = G.serre(Math.abs(vl) / 12, 0, 1);

  // --- Reconstruction de la vitesse ---------------------------------------
  etat.vit = G.ajoute(G.multiplie(etat.avant, vf), G.multiplie(lat, vl));

  // --- Plaque de boost -----------------------------------------------------
  if (etat.surface === 'boost' && etat.surfacePrecedente !== 'boost') {
    const imp = SURFACES.boost.impulsion;
    etat.vit = G.ajouteEchelle(etat.vit, etat.avant, imp);
    evenement(etat, 'boost');
  }
  etat.surfacePrecedente = etat.surface;

  // --- Intégration ---------------------------------------------------------
  etat.pos = G.ajouteEchelle(etat.pos, etat.vit, dt);

  // --- Recalage sur le ruban ----------------------------------------------
  const pr = projeter(circuit, etat.pos, etat.index, 30);
  etat.index = pr.index;
  let nFinal = pr.n;

  const fr = pr.frame;
  const demiFinal = fr.largeur / 2;
  const cote = pr.n > 0 ? 1 : 0;
  const bord = fr.bord[cote];
  const margeSortie = circuit.horsPiste === null ? 1.5 : PHYS.margeHorsPiste;

  if (Math.abs(pr.n) > demiFinal) {
    if (bord === 'mur') {
      nFinal = Math.sign(pr.n) * demiFinal;
      choqueMur(etat, fr, pr.n);
    } else if (Math.abs(pr.n) > demiFinal + margeSortie) {
      if (circuit.horsPiste === null) {
        decolle(etat, 'chute');
        return;
      }
      declencheReapparition(etat, circuit, 'sortie');
      return;
    }
  }

  majProgression(etat, circuit, pr.s);
  majLooping(etat, circuit);

  // Collé à la surface : c'est ce recalage qui tient la voiture dans un looping.
  etat.pos = positionMonde(circuit, pr.s, nFinal, 0);
  etat.n = nFinal;
  etat.h = 0;
  etat.tempsEnVol = 0;
}

function choqueMur(etat, frame, nBrut) {
  const vitesseTot = G.norme(etat.vit);
  if (vitesseTot < 1) return;
  const lat = frame.lateral;
  const vLat = G.produitScalaire(etat.vit, lat);

  // Sinus de l'angle d'impact : rasant → presque rien, frontal → très coûteux.
  const angle = G.serre(Math.abs(vLat) / vitesseTot, 0, 1);
  const perte = G.melange(PHYS.murPerteMin, PHYS.murPerteMax, Math.min(1, angle * 1.7));

  etat.vit = G.multiplie(etat.vit, 1 - perte);
  const vLat2 = G.produitScalaire(etat.vit, lat);
  etat.vit = G.ajouteEchelle(etat.vit, lat, -vLat2 - Math.sign(nBrut) * PHYS.murRebond);

  // Toucher un mur annule la charge de dérapage.
  etat.derapage.duree = 0;
  etat.derapage.palier = 0;

  if (etat.contactMur <= 0) {
    etat.stats.murs++;
    etat.progression.mursCeTour++;
    evenement(etat, 'mur', { force: perte / PHYS.murPerteMax, vitesse: vitesseTot });
  }
  etat.contactMur = 0.2;
}

// ---------------------------------------------------------------------------
// Vol libre
// ---------------------------------------------------------------------------

function decolle(etat, cause) {
  if (!etat.auSol) return;
  etat.auSol = false;
  etat.tempsEnVol = 0;
  evenement(etat, 'decollage', { cause });
}

function enVol(etat, e, dt, circuit, gVec) {
  etat.vit = G.ajouteEchelle(etat.vit, gVec, dt);
  etat.pos = G.ajouteEchelle(etat.pos, etat.vit, dt);
  etat.tempsEnVol += dt;
  etat.nitro.jauge = Math.min(etat.params.nitroCapacite, etat.nitro.jauge + PHYS.nitroGainVol * dt);

  // Léger contrôle en rotation : on oriente le nez, sans acrobaties complètes.
  if (e.direction !== 0) {
    etat.avant = G.normalise(G.tourneAutour(etat.avant, etat.haut, -e.direction * PHYS.controleEnVol * dt));
  }

  const pr = projeter(circuit, etat.pos, etat.index, 110);
  etat.index = pr.index;
  etat.s = pr.s;
  etat.n = pr.n;
  etat.h = pr.h;
  const f = pr.frame;

  // La voiture se remet doucement dans l'axe de la piste visée : indispensable
  // pour que les gros sauts restent jouables.
  etat.haut = G.tourneVers(etat.haut, f.haut, 1.1 * dt);
  etat.avant = G.normalise(G.orthogonalise(etat.avant, etat.haut));

  const margeSortie = circuit.horsPiste === null ? 1.5 : PHYS.margeHorsPiste;
  const dansLesBords = Math.abs(pr.n) <= f.largeur / 2 + margeSortie;

  if (pr.h < -PHYS.chuteVide || (pr.h < -6 && !dansLesBords)) {
    declencheReapparition(etat, circuit, 'chute');
    return;
  }

  // Atterrissage : il faut redescendre sur la piste, dans ses bords, et dans une
  // orientation compatible (on ne se raccroche pas au plafond d'un looping).
  const orientationOk = G.produitScalaire(etat.haut, f.haut) > PHYS.cosAtterrissage;
  const descend = G.produitScalaire(etat.vit, f.haut) < 0;

  if (etat.tempsEnVol > 0.08 && pr.h <= 0 && dansLesBords && orientationOk && descend) {
    atterrit(etat, circuit, pr, f);
  }
}

function atterrit(etat, circuit, pr, f) {
  const vNormale = G.produitScalaire(etat.vit, f.haut);
  etat.auSol = true;

  // Le choc mange une partie de la vitesse verticale, pas la vitesse d'avance.
  etat.vit = G.ajouteEchelle(etat.vit, f.haut, -vNormale);
  etat.haut = G.copie(f.haut);
  etat.avant = G.normalise(G.orthogonalise(etat.avant, etat.haut));
  etat.pos = positionMonde(circuit, pr.s, pr.n, 0);
  etat.h = 0;

  if (etat.tempsEnVol >= 1.0) etat.stats.sauts++;
  evenement(etat, 'atterrissage', {
    duree: etat.tempsEnVol,
    force: G.serre(-vNormale / PHYS.seuilAtterrissageDur, 0, 2)
  });
  etat.tempsEnVol = 0;
}

// ---------------------------------------------------------------------------
// Réapparition
// ---------------------------------------------------------------------------

export function declencheReapparition(etat, circuit, cause = 'sortie') {
  if (etat.reapparition.actif) return;
  etat.reapparition = { actif: true, minuteur: PHYS.delaiReapparition };
  etat.stats.reapparitions++;
  etat.derapage = { actif: false, duree: 0, palier: 0, intensite: 0 };
  etat.nitro.actif = false;
  evenement(etat, 'reapparition', { cause });
}

function gereReapparition(etat, dt, circuit) {
  etat.reapparition.minuteur -= dt;
  etat.vit = G.v3();
  if (etat.reapparition.minuteur > 0) return;

  etat.reapparition.actif = false;
  const cp = etat.progression.dernierCheckpoint;
  const f = frameA(circuit, cp.s);
  etat.pos = positionMonde(circuit, cp.s, 0, 0);
  etat.avant = G.copie(f.avant);
  etat.haut = G.copie(f.haut);
  etat.vit = G.v3();
  etat.auSol = true;
  etat.tempsEnVol = 0;
  etat.index = projeter(circuit, etat.pos, -1).index;
  etat.s = cp.s;
  etat.n = 0;
  etat.h = 0;
  evenement(etat, 'reapparition-fin');
}

/** Retour manuel au dernier checkpoint (touche Entrée). */
export function retourCheckpoint(etat, circuit) {
  declencheReapparition(etat, circuit, 'manuel');
}

// ---------------------------------------------------------------------------
// Dérapage et nitro
// ---------------------------------------------------------------------------

function majDerapage(etat, e, dt, vf) {
  const d = etat.derapage;
  const peut = e.derapage && vf > PHYS.vitesseMinDerapage;

  if (peut) {
    if (!d.actif) {
      d.actif = true;
      d.duree = 0;
      d.palier = 0;
      evenement(etat, 'derapage-debut');
    }
    d.duree += dt;
    const nouveau = paliserDerapage(d.duree);
    if (nouveau > d.palier) {
      d.palier = nouveau;
      evenement(etat, 'derapage-palier', { palier: nouveau });
    }
    return;
  }

  if (d.actif) {
    if (d.palier > 0) {
      const boost = PHYS.boostDerapage[d.palier - 1];
      etat.vit = G.ajouteEchelle(etat.vit, etat.avant, boost);
      etat.nitro.jauge = Math.min(
        etat.params.nitroCapacite,
        etat.nitro.jauge + PHYS.nitroGainDerapage[d.palier - 1]
      );
      etat.stats.derapages[d.palier - 1]++;
      evenement(etat, 'derapage-boost', { palier: d.palier });
    }
    d.actif = false;
    d.duree = 0;
    d.palier = 0;
    d.intensite = 0;
  }
}

function paliserDerapage(duree) {
  const p = PHYS.paliersDerapage;
  if (duree >= p[2]) return 3;
  if (duree >= p[1]) return 2;
  if (duree >= p[0]) return 1;
  return 0;
}

function majNitro(etat, e, dt) {
  const n = etat.nitro;
  if (etat.contactMur > 0) etat.contactMur -= dt;

  if (e.nitro && n.jauge > 0.5) {
    if (!n.actif) evenement(etat, 'nitro-debut');
    n.actif = true;
  } else if (n.actif) {
    n.actif = false;
    evenement(etat, 'nitro-fin');
  }

  if (n.actif) {
    n.jauge -= PHYS.nitroConsommation * dt;
    etat.stats.dureeNitro += dt;
    if (n.jauge <= 0) {
      n.jauge = 0;
      n.actif = false;
      evenement(etat, 'nitro-fin');
    }
  }
}

function majLooping(etat, circuit) {
  const seg = dansLooping(circuit, etat.s);
  if (seg && !etat.loopingEnCours) {
    etat.loopingEnCours = seg;
  } else if (!seg && etat.loopingEnCours) {
    etat.loopingEnCours = null;
    etat.stats.loopings++;
    etat.nitro.jauge = Math.min(etat.params.nitroCapacite, etat.nitro.jauge + PHYS.nitroGainLooping);
    evenement(etat, 'looping');
  }
}

// ---------------------------------------------------------------------------
// Progression : checkpoints et tours
// ---------------------------------------------------------------------------

/**
 * L'avancement est une distance cumulée le long de la piste, qui peut reculer.
 * Valider les checkpoints dans l'ordre de cet avancement empêche mécaniquement
 * de couper le circuit ou de repasser la ligne à l'envers.
 */
function majProgression(etat, circuit, sNouveau) {
  const pr = etat.progression;
  const L = circuit.longueur;
  const cps = circuit.checkpoints;

  const delta = G.ecartCirculaire(sNouveau, G.modulo(pr.avancement, L), L);
  pr.avancement += delta;

  const nbCp = cps.length;
  let garde = 0;
  while (garde++ < 8) {
    const tour = Math.floor(pr.valides / nbCp);
    const cp = cps[pr.valides % nbCp];
    const seuil = tour * L + cp.s;
    if (pr.avancement < seuil) break;

    pr.valides++;
    pr.dernierCheckpoint = { s: cp.s, index: cp.index, tour };
    pr.tempsCheckpoints.push({ temps: etat.temps, index: cp.index, tour });

    if (cp.ligneArrivee) {
      if (pr.valides > 1) {
        const debutTour = pr.tempsTours.reduce((a, b) => a + b, 0);
        pr.tempsTours.push(etat.temps - debutTour);
        if (pr.mursCeTour === 0) etat.stats.tourSansMur = true;
      }
      pr.mursCeTour = 0;
      pr.tour = Math.floor(pr.valides / nbCp);
      evenement(etat, 'tour', { tour: pr.tour, total: circuit.tours });

      if (pr.valides >= nbCp * circuit.tours + 1) {
        pr.termine = true;
        pr.tempsTotal = etat.temps;
        evenement(etat, 'arrivee', { temps: etat.temps });
      }
    } else {
      evenement(etat, 'checkpoint', { index: cp.index, temps: etat.temps });
    }
  }
}

/** Progression normalisée (en tours décimaux), pour le classement en direct. */
export function progressionNormalisee(etat, circuit) {
  return etat.progression.avancement / circuit.longueur;
}

/** Vitesse en km/h, pour le HUD. */
export const kmh = (etat) => Math.max(0, Math.round(etat.vitesseScalaire * 3.6));

/** Vide et renvoie la file d'événements. */
export function videEvenements(etat) {
  const ev = etat.evenements;
  etat.evenements = [];
  return ev;
}

/**
 * Instantané compact pour le réseau et les fantômes.
 * On n'envoie que ce qui est nécessaire à l'affichage chez les autres.
 */
export function instantane(etat) {
  return {
    p: [r3(etat.pos.x), r3(etat.pos.y), r3(etat.pos.z)],
    a: [r3(etat.avant.x), r3(etat.avant.y), r3(etat.avant.z)],
    u: [r3(etat.haut.x), r3(etat.haut.y), r3(etat.haut.z)],
    v: r2(etat.vitesseScalaire),
    d: etat.derapage.actif ? etat.derapage.palier + 1 : 0,
    n: etat.nitro.actif ? 1 : 0,
    s: r2(etat.progression.avancement),
    t: etat.progression.tour
  };
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;
