// Construction et interrogation d'un circuit.
//
// Un circuit est un ruban 3D fermé défini par des points de contrôle qui portent
// chacun une position, un vecteur « haut » explicite, une largeur, un type de bord
// et un type de surface. On en tire une table de repères (« frames ») échantillonnés
// tous les mètres le long de la piste.
//
// Le vecteur « haut » est donné à la main et interpolé, et non déduit du repère de
// Frenet : celui-ci se retourne brutalement dans les loopings, ce qui rendrait la
// physique et la caméra inutilisables.

import * as G from './geom.js';
import { SURFACES, HORS_PISTE, PHYS } from './config.js';

/** Distance (m) entre deux repères échantillonnés. */
export const PAS_FRAME = 1.0;

/** Nombre d'échantillons intermédiaires par segment de spline. */
const SOUS_ECHANTILLONS = 16;

const HAUT_MONDE = G.v3(0, 1, 0);

// ---------------------------------------------------------------------------
// Lecture des points de contrôle
// ---------------------------------------------------------------------------

function litVecteur(v, defaut) {
  if (!v) return G.copie(defaut);
  if (Array.isArray(v)) return G.v3(v[0], v[1], v[2]);
  return G.v3(v.x, v.y, v.z);
}

/**
 * Normalise un champ `bord`.
 * Accepte "mur", "ouvert", ou [bordCoteNegatif, bordCotePositif].
 * Le côté « positif » est celui du vecteur latéral (voir `lateral` plus bas).
 */
function litBord(b, defaut = 'mur') {
  if (!b) return [defaut, defaut];
  if (Array.isArray(b)) return [b[0] ?? defaut, b[1] ?? defaut];
  return [b, b];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * @param {object} donnees  contenu d'un fichier /shared/tracks/*.json
 * @returns {object} circuit prêt à l'emploi
 */
export function construireCircuit(donnees) {
  const pts = donnees.points;
  if (!Array.isArray(pts) || pts.length < 4) {
    throw new Error(`Circuit ${donnees.id} : il faut au moins 4 points de contrôle.`);
  }

  const largeurDefaut = donnees.largeurDefaut ?? 16;
  const n = pts.length;

  const positions = pts.map((p) => litVecteur(p.p, G.v3()));
  const hauts = pts.map((p) => G.normalise(litVecteur(p.up, HAUT_MONDE)));
  const largeurs = pts.map((p) => p.largeur ?? largeurDefaut);
  const surfaces = pts.map((p) => p.surface ?? 'route');
  const bords = pts.map((p) => litBord(p.bord, donnees.bordDefaut ?? 'mur'));

  // --- 1. Échantillonnage dense de la spline -------------------------------
  const dense = [];
  for (let i = 0; i < n; i++) {
    const i0 = (i - 1 + n) % n;
    const i1 = i;
    const i2 = (i + 1) % n;
    const i3 = (i + 2) % n;
    for (let j = 0; j < SOUS_ECHANTILLONS; j++) {
      const t = j / SOUS_ECHANTILLONS;
      dense.push({
        pos: G.catmullRomV3(positions[i0], positions[i1], positions[i2], positions[i3], t),
        haut: G.normalise(G.catmullRomV3(hauts[i0], hauts[i1], hauts[i2], hauts[i3], t)),
        largeur: G.catmullRom(largeurs[i0], largeurs[i1], largeurs[i2], largeurs[i3], t),
        // Surface et bord sont constants par segment : pas d'interpolation,
        // une plaque de glace doit avoir une frontière nette.
        surface: surfaces[i1],
        bord: bords[i1]
      });
    }
  }

  // --- 2. Longueurs cumulées (boucle fermée) ------------------------------
  const m = dense.length;
  const cumul = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    cumul[i + 1] = cumul[i] + G.distance(dense[i].pos, dense[(i + 1) % m].pos);
  }
  const longueur = cumul[m];

  // --- 3. Ré-échantillonnage à pas constant -------------------------------
  const nbFrames = Math.max(8, Math.round(longueur / PAS_FRAME));
  const pas = longueur / nbFrames;

  const frames = new Array(nbFrames);
  let curseur = 0;
  for (let k = 0; k < nbFrames; k++) {
    const s = k * pas;
    while (curseur < m - 1 && cumul[curseur + 1] < s) curseur++;
    const seg = cumul[curseur + 1] - cumul[curseur];
    const t = seg > 1e-9 ? (s - cumul[curseur]) / seg : 0;
    const a = dense[curseur];
    const b = dense[(curseur + 1) % m];
    frames[k] = {
      s,
      pos: G.interpole(a.pos, b.pos, t),
      hautBrut: G.normalise(G.interpole(a.haut, b.haut, t)),
      largeur: a.largeur + (b.largeur - a.largeur) * t,
      surface: a.surface,
      bord: a.bord,
      avant: null,
      haut: null,
      lateral: null,
      courbureNormale: 0,
      courbureLaterale: 0
    };
  }

  // --- 4. Repère local orthonormé -----------------------------------------
  for (let k = 0; k < nbFrames; k++) {
    const prec = frames[(k - 1 + nbFrames) % nbFrames];
    const suiv = frames[(k + 1) % nbFrames];
    const avant = G.normalise(G.soustrait(suiv.pos, prec.pos));
    const f = frames[k];
    f.avant = avant;
    // Le « haut » fourni est redressé pour être perpendiculaire à l'avant.
    let haut = G.orthogonalise(f.hautBrut, avant);
    if (G.normeCarree(haut) < 1e-8) haut = G.orthogonalise(HAUT_MONDE, avant);
    f.haut = G.normalise(haut);
    f.lateral = G.normalise(G.produitVectoriel(f.haut, avant));
  }

  // --- 5. Courbures --------------------------------------------------------
  for (let k = 0; k < nbFrames; k++) {
    const f = frames[k];
    const prec = frames[(k - 1 + nbFrames) % nbFrames];
    const suiv = frames[(k + 1) % nbFrames];
    const dT = G.multiplie(G.soustrait(suiv.avant, prec.avant), 1 / (2 * pas));
    // Positive quand la piste s'incurve vers le haut de la voiture
    // (cas du looping : c'est ce qui la plaque au sol).
    f.courbureNormale = G.produitScalaire(dT, f.haut);
    f.courbureLaterale = G.produitScalaire(dT, f.lateral);
  }

  // Lissage léger des courbures : la dérivée seconde d'une spline est bruitée
  // et les bots freineraient par à-coups.
  lisseChamp(frames, 'courbureNormale', 4);
  lisseChamp(frames, 'courbureLaterale', 4);

  const circuit = {
    id: donnees.id,
    nom: donnees.nom,
    decor: donnees.decor ?? 'test',
    description: donnees.description ?? '',
    tours: donnees.tours ?? 3,
    voitureFavorite: donnees.voitureFavorite ?? 'comete',
    frames,
    pas,
    longueur,
    nbFrames,
    // `null` signifie le vide : ne surtout pas confondre avec « non renseigné ».
    horsPiste: Object.hasOwn(HORS_PISTE, donnees.decor) ? HORS_PISTE[donnees.decor] : 'terre',
    medailles: donnees.medailles ?? null,
    decors: donnees.decors ?? [],
    donnees
  };

  // --- 6. Zones de surface explicites (plaques de boost, glace...) ---------
  for (const z of donnees.zones ?? []) {
    const d = Math.max(0, z.debut ?? 0);
    const f = Math.min(longueur, z.fin ?? d);
    for (let k = Math.floor(d / pas); k <= Math.floor(f / pas) && k < nbFrames; k++) {
      frames[k].surface = z.surface;
    }
  }

  // --- 7. Checkpoints ------------------------------------------------------
  circuit.checkpoints = construireCheckpoints(donnees, longueur);

  // --- 8. Grille de départ -------------------------------------------------
  circuit.depart = donnees.depart ?? { s: 0 };

  // --- 9. Portions retournées (loopings) -----------------------------------
  circuit.segmentsInverses = detecteSegmentsInverses(frames, pas, longueur);

  return circuit;
}

function lisseChamp(frames, champ, rayon) {
  const n = frames.length;
  const src = frames.map((f) => f[champ]);
  for (let k = 0; k < n; k++) {
    let somme = 0;
    for (let d = -rayon; d <= rayon; d++) somme += src[(k + d + n * 2) % n];
    frames[k][champ] = somme / (2 * rayon + 1);
  }
}

/**
 * Les checkpoints servent à compter les tours, à empêcher de couper le circuit
 * et à replacer la voiture après une chute. Le checkpoint d'indice 0 est la
 * ligne de départ/arrivée, toujours à s = 0.
 */
function construireCheckpoints(donnees, longueur) {
  const liste = [{ index: 0, s: 0, ligneArrivee: true }];
  const brut = donnees.checkpoints ?? [];
  const positions = brut.length > 0
    ? brut.map((c) => (typeof c === 'number' ? c : c.s))
    // Par défaut : trois checkpoints intermédiaires régulièrement espacés.
    : [0.25, 0.5, 0.75].map((f) => f * longueur);

  for (const s of positions) {
    const sm = G.modulo(s, longueur);
    if (sm > 1) liste.push({ index: liste.length, s: sm, ligneArrivee: false });
  }
  liste.sort((a, b) => a.s - b.s);
  liste.forEach((c, i) => { c.index = i; });
  return liste;
}

/** Repère les portions où la voiture roule la tête en bas (loopings). */
function detecteSegmentsInverses(frames, pas, longueur) {
  const segments = [];
  let debut = null;
  for (let k = 0; k < frames.length; k++) {
    const inverse = frames[k].haut.y < -0.15;
    if (inverse && debut === null) debut = k;
    if (!inverse && debut !== null) {
      segments.push({ debut: debut * pas, fin: k * pas });
      debut = null;
    }
  }
  if (debut !== null) segments.push({ debut: debut * pas, fin: longueur });
  // On élargit un peu : le looping commence avant d'être vraiment à l'envers.
  return segments.map((s) => ({
    debut: G.modulo(s.debut - 25, longueur),
    fin: G.modulo(s.fin + 25, longueur),
    centre: G.modulo((s.debut + s.fin) / 2, longueur)
  }));
}

// ---------------------------------------------------------------------------
// Interrogation
// ---------------------------------------------------------------------------

/** Indice de repère correspondant à une abscisse curviligne. */
export const indiceA = (circuit, s) =>
  G.modulo(Math.floor(G.modulo(s, circuit.longueur) / circuit.pas), circuit.nbFrames);

/** Repère interpolé à l'abscisse `s`. */
export function frameA(circuit, s) {
  const sm = G.modulo(s, circuit.longueur);
  const brut = sm / circuit.pas;
  const k = Math.floor(brut) % circuit.nbFrames;
  const t = brut - Math.floor(brut);
  const a = circuit.frames[k];
  const b = circuit.frames[(k + 1) % circuit.nbFrames];
  return {
    s: sm,
    pos: G.interpole(a.pos, b.pos, t),
    avant: G.normalise(G.interpole(a.avant, b.avant, t)),
    haut: G.normalise(G.interpole(a.haut, b.haut, t)),
    lateral: G.normalise(G.interpole(a.lateral, b.lateral, t)),
    largeur: a.largeur + (b.largeur - a.largeur) * t,
    surface: t < 0.5 ? a.surface : b.surface,
    bord: t < 0.5 ? a.bord : b.bord,
    courbureNormale: a.courbureNormale + (b.courbureNormale - a.courbureNormale) * t,
    courbureLaterale: a.courbureLaterale + (b.courbureLaterale - a.courbureLaterale) * t
  };
}

/** Position dans le monde d'un point repéré par (s, décalage latéral, hauteur). */
export function positionMonde(circuit, s, n = 0, h = 0) {
  const f = frameA(circuit, s);
  return G.ajoute(G.ajoute(f.pos, G.multiplie(f.lateral, n)), G.multiplie(f.haut, h));
}

/**
 * Projette une position du monde sur la piste.
 *
 * La recherche part du dernier repère connu (`indicePrecedent`) : c'est ce qui
 * permet de rester correct dans un tire-bouchon ou un croisement de ponts, où
 * deux portions de piste se superposent dans l'espace.
 *
 * @returns {{s, n, h, index, frame, distance}}
 */
export function projeter(circuit, pos, indicePrecedent = -1, fenetre = 90) {
  const { frames, nbFrames, pas } = circuit;
  let meilleur = -1;
  let meilleureDist = Infinity;

  if (indicePrecedent >= 0) {
    for (let d = -fenetre; d <= fenetre; d++) {
      const k = G.modulo(indicePrecedent + d, nbFrames);
      const dist = G.distanceCarree(pos, frames[k].pos);
      if (dist < meilleureDist) { meilleureDist = dist; meilleur = k; }
    }
    // Si l'on est très loin de la fenêtre, on a décroché : balayage complet.
    if (meilleureDist > (fenetre * pas) ** 2) meilleur = -1;
  }

  if (meilleur < 0) {
    meilleureDist = Infinity;
    // Balayage grossier puis affinage, pour rester rapide sur 3000 repères.
    for (let k = 0; k < nbFrames; k += 8) {
      const dist = G.distanceCarree(pos, frames[k].pos);
      if (dist < meilleureDist) { meilleureDist = dist; meilleur = k; }
    }
    for (let d = -8; d <= 8; d++) {
      const k = G.modulo(meilleur + d, nbFrames);
      const dist = G.distanceCarree(pos, frames[k].pos);
      if (dist < meilleureDist) { meilleureDist = dist; meilleur = k; }
    }
  }

  const f = frames[meilleur];
  const d = G.soustrait(pos, f.pos);
  const avance = G.produitScalaire(d, f.avant);
  return {
    s: G.modulo(f.s + avance, circuit.longueur),
    n: G.produitScalaire(d, f.lateral),
    h: G.produitScalaire(d, f.haut),
    index: meilleur,
    frame: f,
    distance: Math.sqrt(meilleureDist)
  };
}

/** Type de surface à une position donnée, hors piste compris. */
export function surfaceA(circuit, frame, n) {
  const demi = frame.largeur / 2;
  if (Math.abs(n) <= demi) return frame.surface;
  const cote = n > 0 ? 1 : 0;
  if (frame.bord[cote] === 'mur') return frame.surface;
  return circuit.horsPiste === null ? 'vide' : circuit.horsPiste;
}

/** Coefficients physiques d'une surface. */
export const coeffSurface = (nom) => SURFACES[nom] ?? SURFACES.route;

/** Vrai si l'abscisse `s` est dans une portion retournée (looping). */
export function dansLooping(circuit, s) {
  const sm = G.modulo(s, circuit.longueur);
  for (const seg of circuit.segmentsInverses) {
    if (seg.debut <= seg.fin) {
      if (sm >= seg.debut && sm <= seg.fin) return seg;
    } else if (sm >= seg.debut || sm <= seg.fin) return seg;
  }
  return null;
}

/** Checkpoint qui précède immédiatement l'abscisse `s`. */
export function checkpointPrecedent(circuit, s) {
  const sm = G.modulo(s, circuit.longueur);
  let choisi = circuit.checkpoints[0];
  for (const c of circuit.checkpoints) if (c.s <= sm) choisi = c;
  return choisi;
}

/**
 * Position de départ d'un participant sur la grille.
 * La grille recule le long de la piste, en quinconce sur deux colonnes.
 */
export function placeGrille(circuit, rang, grille) {
  const sDepart = circuit.depart.s ?? 0;
  const ligne = Math.floor(rang / 2);
  const colonne = rang % 2 === 0 ? -1 : 1;
  const s = G.modulo(sDepart - 10 - ligne * grille.pasLongitudinal, circuit.longueur);
  return { s, n: colonne * grille.decalageLateral };
}

// ---------------------------------------------------------------------------
// Ligne de course des bots
// ---------------------------------------------------------------------------

/**
 * Calcule la ligne de course : pour chaque repère, un décalage latéral visé et
 * une vitesse cible. Elle est calculée une fois par circuit, puis partagée par
 * tous les bots ; chaque niveau de difficulté en applique une fraction.
 *
 * @param {object} circuit
 * @param {object} params  paramètres physiques d'une voiture de référence
 */
export function construireLigneCourse(circuit, params) {
  const { frames, nbFrames, pas } = circuit;

  // --- Décalage latéral : on coupe à la corde ------------------------------
  const cible = new Float64Array(nbFrames);
  for (let k = 0; k < nbFrames; k++) {
    const f = frames[k];
    const demi = Math.max(1, f.largeur / 2 - 2.2);
    // Courbure latérale positive : la piste tourne vers le côté « positif »,
    // la corde est donc de ce côté.
    const intensite = Math.tanh(Math.abs(f.courbureLaterale) * 140);
    cible[k] = Math.sign(f.courbureLaterale) * demi * intensite;
  }
  // Une trajectoire doit être lisse : un bot ne peut pas téléporter son volant.
  const decalage = lisseTableau(cible, 18, 3);

  // --- Vitesse cible -------------------------------------------------------
  const vitesse = new Float64Array(nbFrames);
  const minimums = new Float64Array(nbFrames);
  const vMax = params.vitesseMax * PHYS.nitroSurvitesse;
  /** Plancher : un bot ne doit jamais se traîner, même sur une bosse. */
  const PLANCHER = 14;

  for (let k = 0; k < nbFrames; k++) {
    const f = frames[k];
    // Un trou dans la piste se franchit en l'air, à pleine vitesse : il ne doit
    // pas être vu comme une surface sans adhérence où il faudrait ralentir.
    const surf = coeffSurface(f.surface === 'vide' ? 'route' : f.surface);
    const muLat = params.adherence * surf.adherence;

    // Composante de gravité le long du « haut » de la piste : négative sur du
    // plat (la gravité plaque la voiture), positive quand la piste est au-dessus.
    const gHaut = -PHYS.gravite * f.haut.y;

    // Courbure latérale ressentie sur la trajectoire choisie.
    const kappa = Math.abs(f.courbureLaterale) + 1e-5;

    // Force normale disponible à la vitesse v : N(v) = v²·courbureNormale − g·haut.
    // On cherche la plus grande vitesse telle que v²·kappa <= mu · N(v) :
    //   v²·(kappa − mu·kN) <= −mu·gHaut
    //
    // La courbure normale est bornée à zéro : sur une bosse elle est négative et
    // conduirait à ramper. Une bosse se prend vite, la voiture décolle, c'est voulu.
    const kN = Math.max(f.courbureNormale, 0);
    const gauche = kappa - muLat * kN;
    const droite = -muLat * gHaut;

    let v;
    if (gauche <= 1e-9 || droite <= 0) {
      // Soit la piste plaque la voiture plus vite que le virage ne la déporte
      // (virage très relevé), soit on est en portion retournée : dans les deux
      // cas la contrainte n'est pas une vitesse maximale.
      v = vMax;
    } else {
      v = Math.sqrt(droite / gauche);
    }

    // Deuxième limite, tout aussi contraignante que l'adhérence : le braquage.
    // Suivre une courbure `kappa` à la vitesse v demande v·kappa rad/s, or le
    // volant plafonne à maniabilite/(1 + v/52). D'où :
    //     kappa·v²/52 + kappa·v − maniabilite <= 0
    // Sans cette limite, une épingle relevée « autorise » 200 km/h par simple
    // effet de dévers, alors que la voiture ne peut pas tourner aussi court.
    // On ne vise que 70 % du braquage disponible : le reste est la marge dont
    // le pilote a besoin pour corriger sa trajectoire. Sans cette marge, il
    // roule volant à fond en permanence et part au mur à la moindre erreur.
    const MARGE_BRAQUAGE = 0.7;
    const vBraquage = 26 * (-1 + Math.sqrt(1 + (4 * MARGE_BRAQUAGE * params.maniabilite) / (52 * kappa)));
    v = Math.min(v, vBraquage);

    // Vitesse minimale pour ne pas décrocher dans un looping : v²·κ_n >= g·haut.
    // Le seuil sur la courbure est indispensable : une courbure quasi nulle
    // ferait tendre cette vitesse vers l'infini (cas d'un mur vertical presque droit).
    let vMin = 0;
    if (f.courbureNormale > 2e-3 && gHaut > 0) {
      vMin = Math.min(vMax, Math.sqrt(gHaut / f.courbureNormale) * 1.3);
    }
    minimums[k] = vMin;

    vitesse[k] = Math.max(vMin, PLANCHER, Math.min(vMax * surf.adherence, v));
  }

  // --- Passe arrière : anticiper le freinage -------------------------------
  const decel = PHYS.freinage * 0.55;
  for (let tour = 0; tour < 2; tour++) {
    for (let i = nbFrames - 1; i >= 0; i--) {
      const suivant = vitesse[(i + 1) % nbFrames];
      const possible = Math.sqrt(suivant * suivant + 2 * decel * pas);
      if (vitesse[i] > possible) vitesse[i] = possible;
    }
  }

  // Le freinage ne doit pas passer sous la vitesse de survie d'un looping :
  // on remet les planchers après coup.
  for (let k = 0; k < nbFrames; k++) {
    vitesse[k] = Math.max(vitesse[k], minimums[k], PLANCHER);
  }

  return {
    decalage,
    vitesse,
    /** Décalage latéral visé à l'abscisse `s`. */
    decalageA(s) { return echantillonne(decalage, circuit, s); },
    /** Vitesse cible à l'abscisse `s`. */
    vitesseA(s) { return echantillonne(vitesse, circuit, s); }
  };
}

function echantillonne(tableau, circuit, s) {
  const brut = G.modulo(s, circuit.longueur) / circuit.pas;
  const k = Math.floor(brut) % circuit.nbFrames;
  const t = brut - Math.floor(brut);
  const a = tableau[k];
  const b = tableau[(k + 1) % circuit.nbFrames];
  return a + (b - a) * t;
}

function lisseTableau(src, rayon, passes) {
  const n = src.length;
  let a = Float64Array.from(src);
  let b = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < n; k++) {
      let somme = 0;
      for (let d = -rayon; d <= rayon; d++) somme += a[G.modulo(k + d, n)];
      b[k] = somme / (2 * rayon + 1);
    }
    [a, b] = [b, a];
  }
  return a;
}
