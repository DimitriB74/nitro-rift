// Outil d'écriture de circuits.
//
// Taper à la main les points de contrôle d'un looping, avec leurs vecteurs « haut »,
// est impraticable. On décrit donc le tracé comme une suite de commandes de pilotage
// (avance tout droit, tourne de 90° à 80 m de rayon avec 25° de dévers, fais un
// looping de 22 m...) et cet outil en déduit les points de contrôle.
//
// Le JSON produit dans /shared/tracks reste le format lu par le jeu : on peut le
// retoucher à la main sans repasser par ce script.

import * as G from '../shared/geom.js';

const DEG = Math.PI / 180;
const HAUT_MONDE = G.v3(0, 1, 0);

export class Piste {
  constructor(meta) {
    this.meta = {
      tours: 3,
      largeurDefaut: 16,
      bordDefaut: 'mur',
      ...meta
    };
    /** Distance entre deux points de contrôle. */
    this.espacement = meta.espacement ?? 20;

    this.pos = G.v3(0, 0, 0);
    this.dir = G.v3(0, 0, 1);

    // Deux repères distincts, et c'est essentiel :
    //  - `hautRef` porte la trajectoire. Un virage fait pivoter la direction
    //    autour de lui, et lui seul. Il ne bouge qu'avec le tangage.
    //  - le dévers (`roulis`) ne fait que rouler la surface autour de la
    //    direction ; il n'a aucun effet sur le tracé vu de dessus.
    // Les confondre ferait grimper et dévier tous les virages relevés.
    this.hautRef = G.v3(0, 1, 0);
    this.roulis = 0;          // dévers courant (rad)

    this.parcouru = 0;
    this.reste = 0;

    this.largeur = this.meta.largeurDefaut;
    this.bord = this.meta.bordDefaut;
    this.surface = 'route';

    /** Angle (rad) de rotation du repère au-delà duquel on force un point. */
    this.angleMax = (meta.angleMax ?? 8) * DEG;
    this.dirEmis = G.copie(this.dir);
    this.hautEmis = G.v3(0, 1, 0);

    this.points = [];
    this.reperes = {};        // noms -> distance, pour placer les checkpoints
    this.decors = [];

    this.emet();
  }

  // -------------------------------------------------------------------------
  // Émission des points de contrôle
  // -------------------------------------------------------------------------
  /** Vecteur haut réellement émis : la référence, roulée du dévers courant. */
  get haut() {
    return G.normalise(G.tourneAutour(this.hautRef, this.dir, this.roulis));
  }

  emet() {
    const h = this.haut;
    this.dirEmis = G.copie(this.dir);
    this.hautEmis = h;
    this.points.push({
      p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)],
      up: [r(h.x, 4), r(h.y, 4), r(h.z, 4)],
      largeur: r(this.largeur, 1),
      bord: Array.isArray(this.bord) ? [...this.bord] : this.bord,
      surface: this.surface
    });
  }

  /** Mémorise la distance parcourue sous un nom (checkpoints, décors...). */
  repere(nom) {
    this.reperes[nom] = this.parcouru;
    return this;
  }

  /** Ajoute un élément de décor à la position courante. */
  decor(type, options = {}) {
    this.decors.push({
      type,
      p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)],
      s: r(this.parcouru, 1),
      ...options
    });
    return this;
  }

  // -------------------------------------------------------------------------
  // Déplacement élémentaire
  // -------------------------------------------------------------------------
  /**
   * @param {number} distance
   * @param {object} o
   *   lacet   : rad/m autour du haut (virage)
   *   tangage : rad/m autour du côté (montée, looping)
   *   devers  : dévers visé en degrés
   *   transition : distance (m) sur laquelle le dévers se met en place
   */
  avance(distance, o = {}) {
    if (o.largeur !== undefined) this.largeur = o.largeur;
    if (o.bord !== undefined) this.bord = o.bord;
    if (o.surface !== undefined) this.surface = o.surface;

    const cibleRoulis = (o.devers ?? 0) * DEG;
    const transition = o.transition ?? 28;
    const vitesseRoulis = Math.abs(cibleRoulis - this.roulis) / Math.max(1, transition);

    const pasFin = 0.5;
    const n = Math.max(1, Math.round(distance / pasFin));
    const ds = distance / n;

    for (let i = 0; i < n; i++) {
      // Virage : rotation de cap autour de la verticale du monde, pas autour de
      // la surface. C'est ce qui donne un virage à dénivelé constant — un lacet
      // de montagne ou une rampe de parking en spirale monte à pente régulière.
      // (Les loopings, eux, passent par le tangage, jamais par le lacet.)
      if (o.lacet) {
        const a = o.lacet * ds;
        this.dir = G.normalise(G.tourneAutour(this.dir, HAUT_MONDE, a));
        this.hautRef = G.normalise(G.tourneAutour(this.hautRef, HAUT_MONDE, a));
      }
      // Montée ou looping : rotation autour de l'axe transversal.
      // `dir × hautRef` et non l'inverse : un tangage positif doit faire monter.
      if (o.tangage) {
        const cote = G.normalise(G.produitVectoriel(this.dir, this.hautRef));
        const a = o.tangage * ds;
        this.dir = G.normalise(G.tourneAutour(this.dir, cote, a));
        this.hautRef = G.normalise(G.tourneAutour(this.hautRef, cote, a));
      }
      // Dévers : simple roulis de la surface, mis en place progressivement.
      if (Math.abs(cibleRoulis - this.roulis) > 1e-6) {
        this.roulis += Math.sign(cibleRoulis - this.roulis) *
          Math.min(vitesseRoulis * ds, Math.abs(cibleRoulis - this.roulis));
      }
      // Tire-bouchon : roulis continu, sans cible.
      if (o.roulis) this.roulis += o.roulis * ds;

      // Ré-orthogonalisation : les erreurs d'arrondi s'accumulent vite.
      this.hautRef = G.normalise(G.orthogonalise(this.hautRef, this.dir));

      this.pos = G.ajouteEchelle(this.pos, this.dir, ds);
      this.parcouru += ds;
      this.reste += ds;

      // Échantillonnage adaptatif : dans un looping, un tire-bouchon ou une mise
      // en dévers rapide, l'orientation change beaucoup sur quelques mètres. Des
      // points tous les 20 m n'y suffiraient pas : la spline qui les relie
      // dépasserait la cible, jusqu'à passer au-delà de la verticale sur un mur.
      const tourne =
        G.produitScalaire(this.dir, this.dirEmis) < Math.cos(this.angleMax) ||
        G.produitScalaire(this.haut, this.hautEmis) < Math.cos(this.angleMax);

      if (this.reste >= this.espacement || tourne) {
        this.emet();
        this.reste = 0;
      }
    }
    // Un tire-bouchon complet ramène la surface dans sa position initiale :
    // on remet le roulis dans (-180°, 180°] pour ne pas le dérouler ensuite.
    this.roulis = ((this.roulis + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return this;
  }

  // -------------------------------------------------------------------------
  // Commandes de tracé
  // -------------------------------------------------------------------------

  /** Ligne droite. */
  droite(longueur, o = {}) {
    return this.avance(longueur, { ...o, lacet: 0, tangage: 0 });
  }

  /**
   * Virage à plat ou relevé.
   * @param {number} angle   degrés, positif = vers la gauche de l'écran
   * @param {number} rayon   mètres
   */
  virage(angle, rayon, o = {}) {
    const rad = angle * DEG;
    const longueur = Math.abs(rad) * rayon;
    // Dévers automatique si non précisé : le virage est d'autant plus relevé
    // qu'il est serré. Plafonné pour rester roulable.
    const devers = o.devers ?? Math.min(38, 1500 / rayon) * Math.sign(angle) * -1;
    return this.avance(longueur, { ...o, lacet: Math.sign(rad) / rayon, devers });
  }

  /** Montée ou descente à pente constante, avec raccords doux. */
  pente(longueur, angle, o = {}) {
    const raccord = Math.min(o.raccord ?? 30, longueur / 3);
    const rad = angle * DEG;
    this.avance(raccord, { ...o, tangage: rad / raccord });
    this.avance(longueur - 2 * raccord, { ...o, tangage: 0 });
    this.avance(raccord, { ...o, tangage: -rad / raccord });
    return this;
  }

  /** Looping vertical complet. Il faut arriver lancé pour ne pas décrocher. */
  looping(rayon, o = {}) {
    const longueur = 2 * Math.PI * rayon;
    return this.avance(longueur, { ...o, tangage: 1 / rayon, transition: 12 });
  }

  /**
   * Tire-bouchon : la piste s'enroule en hélice autour d'un axe droit, la voiture
   * roulant à l'intérieur du tube.
   *
   * Ce n'est surtout pas une ligne droite qui tournerait sur elle-même : rouler à
   * l'envers sur une piste rectiligne est impossible, il n'y a aucune force
   * centripète pour plaquer la voiture. Ici la trajectoire est réellement courbe,
   * et c'est elle qui la tient — comme dans un looping.
   *
   * @param {number} longueur  longueur mesurée le long de l'axe
   * @param {number} tours     nombre de tours d'hélice
   * @param {number} rayon     rayon du tube
   */
  tireBouchon(longueur, tours = 1, rayon = 15, o = {}) {
    if (o.largeur !== undefined) this.largeur = o.largeur;
    if (o.bord !== undefined) this.bord = o.bord;
    if (o.surface !== undefined) this.surface = o.surface;

    const axe = G.copie(this.dir);
    const hautDepart = G.copie(this.hautRef);
    // L'axe de l'hélice passe au-dessus de la voiture : elle tourne à l'intérieur.
    const origineAxe = G.ajouteEchelle(this.pos, hautDepart, rayon);
    const angleTotal = tours * 2 * Math.PI;

    // Le dévers éventuel n'a plus de sens ici : l'inclinaison vient de l'hélice.
    this.roulis = 0;

    const pasFin = 0.5;
    const n = Math.max(8, Math.round(Math.hypot(longueur, tours * 2 * Math.PI * rayon) / pasFin));

    let precedente = this.pos;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const theta = angleTotal * t;
      const centre = G.ajouteEchelle(origineAxe, axe, longueur * t);
      // Vecteur allant de l'axe vers la route.
      const radial = G.tourneAutour(G.multiplie(hautDepart, -rayon), axe, theta);

      this.pos = G.ajoute(centre, radial);
      // Le haut de la piste pointe vers l'axe : c'est ce qui rend le tube roulable.
      this.hautRef = G.normalise(G.multiplie(radial, -1));
      // Tangente de l'hélice : avance le long de l'axe + rotation du rayon.
      this.dir = G.normalise(G.ajoute(
        G.multiplie(axe, longueur),
        G.multiplie(G.produitVectoriel(axe, radial), angleTotal)
      ));
      this.hautRef = G.normalise(G.orthogonalise(this.hautRef, this.dir));

      const pas = G.distance(this.pos, precedente);
      precedente = this.pos;
      this.parcouru += pas;
      this.reste += pas;

      const tourne =
        G.produitScalaire(this.dir, this.dirEmis) < Math.cos(this.angleMax) ||
        G.produitScalaire(this.haut, this.hautEmis) < Math.cos(this.angleMax);
      if (this.reste >= this.espacement || tourne) {
        this.emet();
        this.reste = 0;
      }
    }
    return this;
  }

  /** Portion de mur vertical : un virage très serré et très relevé. */
  murVertical(angle, rayon, o = {}) {
    return this.virage(angle, rayon, { ...o, devers: -Math.sign(angle) * 88, transition: 34 });
  }

  /** Tremplin : bosse franche qui envoie la voiture en l'air. */
  tremplin(longueur, angle, o = {}) {
    return this.avance(longueur, { ...o, tangage: (angle * DEG) / longueur, transition: 10 });
  }

  /** Ramène la piste à l'horizontale, quelle que soit la pente courante. */
  aPlat(longueur = 40, o = {}) {
    const pente = Math.asin(G.serre(this.dir.y, -1, 1)) / DEG;
    if (Math.abs(pente) < 0.05) return this;
    return this.tremplin(longueur, -pente, o);
  }

  /** Trou dans la piste : le ruban continue (la physique en a besoin) mais n'est pas dessiné. */
  vide(longueur, o = {}) {
    return this.avance(longueur, { ...o, surface: 'vide' });
  }

  // -------------------------------------------------------------------------
  // Raccord automatique
  // -------------------------------------------------------------------------

  /**
   * Calcule et trace la portion qui ramène la piste à son point de départ.
   *
   * Un tracé écrit à la main ne retombe jamais pile sur son origine, ni avec la
   * bonne orientation. On résout donc le raccord géométriquement : c'est un
   * problème de Dubins (arc — ligne droite — arc) dans le plan horizontal. On
   * essaie les quatre combinaisons de sens de virage et on garde la plus courte.
   *
   * Le circuit doit être revenu à l'horizontale (piste à plat, sans dévers) avant
   * l'appel : la liaison se fait dans le plan.
   */
  raccorde(rayon = 90, o = {}) {
    if (this.hautRef.y < 0.97) {
      console.warn(`  ! ${this.meta.id} : la piste n'est pas horizontale au raccord ` +
        `(hautRef.y = ${this.hautRef.y.toFixed(3)}). Terminer par une portion à plat.`);
    }

    const p1 = { x: this.pos.x, z: this.pos.z };
    const d1 = plan(this.dir);
    const p2 = { x: 0, z: 0 };
    const d2 = { x: 0, z: 1 };
    const R = rayon;

    const candidats = [
      dubinsMemeSens(p1, d1, p2, d2, R, +1),
      dubinsMemeSens(p1, d1, p2, d2, R, -1),
      dubinsSensOppose(p1, d1, p2, d2, R, +1),
      dubinsSensOppose(p1, d1, p2, d2, R, -1)
    ].filter(Boolean);

    if (candidats.length === 0) {
      console.warn(`  ! ${this.meta.id} : aucun raccord trouvé avec un rayon de ${R} m.`);
      return this;
    }

    candidats.sort((a, b) => a.longueur - b.longueur);
    const c = candidats[0];
    this.raccordInfo = { longueur: c.longueur, type: c.type };

    if (Math.abs(c.a1) > 1e-4) this.virage(c.a1 / DEG, R, o);
    if (c.droite > 0.5) this.droite(c.droite, o);
    if (Math.abs(c.a2) > 1e-4) this.virage(c.a2 / DEG, R, o);
    return this;
  }

  // -------------------------------------------------------------------------
  // Fermeture et export
  // -------------------------------------------------------------------------

  /**
   * Referme la boucle. Un tracé écrit à la main ne revient jamais exactement à
   * son point de départ : on répartit l'écart résiduel sur l'ensemble des points,
   * proportionnellement à leur position dans le tour. Tant que l'écart reste
   * petit devant la taille du circuit, la déformation est invisible.
   */
  ferme() {
    const n = this.points.length;
    const debut = this.points[0];
    const fin = this.points[n - 1];

    const ecart = G.v3(
      debut.p[0] - fin.p[0],
      debut.p[1] - fin.p[1],
      debut.p[2] - fin.p[2]
    );
    // Le dernier point est remplacé par le premier : on corrige donc sur n-1.
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.points[i].p[0] = r(this.points[i].p[0] + ecart.x * t);
      this.points[i].p[1] = r(this.points[i].p[1] + ecart.y * t);
      this.points[i].p[2] = r(this.points[i].p[2] + ecart.z * t);
    }
    this.points.pop(); // le point final est confondu avec le premier

    this.ecartFermeture = G.norme(ecart);
    this.dYFinal = -ecart.y;   // altitude à laquelle la piste finissait avant correction
    this.desalignement = Math.acos(
      G.serre(G.produitScalaire(G.normalise(this.dir), G.v3(0, 0, 1)), -1, 1)
    ) / DEG;
    return this;
  }

  json() {
    return {
      id: this.meta.id,
      nom: this.meta.nom,
      decor: this.meta.decor,
      description: this.meta.description ?? '',
      tours: this.meta.tours,
      voitureFavorite: this.meta.voitureFavorite,
      largeurDefaut: this.meta.largeurDefaut,
      bordDefaut: this.meta.bordDefaut,
      longueurApprox: r(this.parcouru, 1),
      depart: { s: 0 },
      checkpoints: this.meta.checkpoints ?? null,
      medailles: this.meta.medailles ?? null,
      ciel: this.meta.ciel ?? null,
      points: this.points,
      zones: this.meta.zones ?? [],
      decors: this.decors
    };
  }
}

const r = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------
// Géométrie du raccord (problème de Dubins, dans le plan horizontal)
// ---------------------------------------------------------------------------
//
// Convention : un virage d'angle positif fait tourner la direction vers le
// centre situé en `npos(d) = (d.z, -d.x)` ; c'est la même convention que
// `tourneAutour(dir, haut, +angle)` avec haut vertical.

const plan = (v) => {
  const n = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / n, z: v.z / n };
};
const npos = (d) => ({ x: d.z, z: -d.x });
const nneg = (d) => ({ x: -d.z, z: d.x });
/** Angle tel que d = (sin a, cos a). Croît avec les rotations positives. */
const ang = (d) => Math.atan2(d.x, d.z);
const TAU = Math.PI * 2;
const versPositif = (a) => ((a % TAU) + TAU) % TAU;
const versNegatif = (a) => versPositif(a) - TAU;

/** Les deux virages tournent dans le même sens : tangente extérieure. */
function dubinsMemeSens(p1, d1, p2, d2, R, sens) {
  const n = sens > 0 ? npos : nneg;
  const c1 = { x: p1.x + R * n(d1).x, z: p1.z + R * n(d1).z };
  const c2 = { x: p2.x + R * n(d2).x, z: p2.z + R * n(d2).z };
  const vx = c2.x - c1.x;
  const vz = c2.z - c1.z;
  const D = Math.hypot(vx, vz);
  if (D < 1e-6) return null;

  const phi = Math.atan2(vx, vz);
  const norme = sens > 0 ? versPositif : versNegatif;
  const a1 = norme(phi - ang(d1));
  const a2 = norme(ang(d2) - phi);

  return {
    type: sens > 0 ? 'PP' : 'NN',
    a1, a2, droite: D,
    longueur: R * (Math.abs(a1) + Math.abs(a2)) + D
  };
}

/** Les deux virages tournent en sens opposés : tangente intérieure. */
function dubinsSensOppose(p1, d1, p2, d2, R, sens) {
  const nA = sens > 0 ? npos : nneg;
  const nB = sens > 0 ? nneg : npos;
  const c1 = { x: p1.x + R * nA(d1).x, z: p1.z + R * nA(d1).z };
  const c2 = { x: p2.x + R * nB(d2).x, z: p2.z + R * nB(d2).z };
  const vx = c2.x - c1.x;
  const vz = c2.z - c1.z;
  const D = Math.hypot(vx, vz);
  if (D < 2 * R) return null; // les cercles se chevauchent : pas de tangente

  const L = Math.sqrt(D * D - 4 * R * R);
  const psi = Math.atan2(vx, vz);
  const phi = psi - Math.atan2(sens > 0 ? -2 * R : 2 * R, L);

  const a1 = (sens > 0 ? versPositif : versNegatif)(phi - ang(d1));
  const a2 = (sens > 0 ? versNegatif : versPositif)(ang(d2) - phi);

  return {
    type: sens > 0 ? 'PN' : 'NP',
    a1, a2, droite: L,
    longueur: R * (Math.abs(a1) + Math.abs(a2)) + L
  };
}
