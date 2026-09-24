// Petite bibliothèque de maths vectorielles.
// Volontairement indépendante de Three.js : ce module tourne aussi côté serveur,
// où l'on ne veut pas charger tout le moteur de rendu.

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const copie = (a) => ({ x: a.x, y: a.y, z: a.z });
export const affecte = (a, b) => { a.x = b.x; a.y = b.y; a.z = b.z; return a; };

export const ajoute = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const soustrait = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const multiplie = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const ajouteEchelle = (a, b, k) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

export const produitScalaire = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const produitVectoriel = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});

export const norme = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const normeCarree = (a) => a.x * a.x + a.y * a.y + a.z * a.z;
export const distance = (a, b) => norme(soustrait(a, b));
export const distanceCarree = (a, b) => normeCarree(soustrait(a, b));

export function normalise(a) {
  const n = norme(a);
  if (n < 1e-9) return v3(0, 0, 0);
  return { x: a.x / n, y: a.y / n, z: a.z / n };
}

export const interpole = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t
});

/** Retire de `a` sa composante parallèle à `axe`, qui doit être unitaire. */
export function orthogonalise(a, axe) {
  const d = produitScalaire(a, axe);
  return { x: a.x - axe.x * d, y: a.y - axe.y * d, z: a.z - axe.z * d };
}

/** Rotation de `a` autour de l'axe unitaire `axe`, d'un angle en radians (Rodrigues). */
export function tourneAutour(a, axe, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = produitScalaire(axe, a);
  const cr = produitVectoriel(axe, a);
  return {
    x: a.x * c + cr.x * s + axe.x * d * (1 - c),
    y: a.y * c + cr.y * s + axe.y * d * (1 - c),
    z: a.z * c + cr.z * s + axe.z * d * (1 - c)
  };
}

/**
 * Fait pivoter le vecteur unitaire `de` vers le vecteur unitaire `vers`,
 * au plus de `angleMax` radians. Sert au lissage d'orientation.
 */
export function tourneVers(de, vers, angleMax) {
  const d = Math.max(-1, Math.min(1, produitScalaire(de, vers)));
  const angle = Math.acos(d);
  if (angle < 1e-6) return copie(de);
  if (angle <= angleMax) return copie(vers);
  let axe = produitVectoriel(de, vers);
  if (normeCarree(axe) < 1e-12) {
    // Vecteurs opposés : n'importe quel axe perpendiculaire convient.
    axe = normalise(orthogonalise(v3(1, 0, 0), de));
    if (normeCarree(axe) < 1e-12) axe = normalise(orthogonalise(v3(0, 1, 0), de));
  } else {
    axe = normalise(axe);
  }
  return normalise(tourneAutour(de, axe, angleMax));
}

export const serre = (x, min, max) => (x < min ? min : x > max ? max : x);
export const melange = (a, b, t) => a + (b - a) * t;

/** Lissage exponentiel, indépendant de la fréquence d'images. */
export const lissage = (actuel, cible, vitesse, dt) =>
  actuel + (cible - actuel) * (1 - Math.exp(-vitesse * dt));

/** Catmull-Rom uniforme sur quatre valeurs scalaires. */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function catmullRomV3(p0, p1, p2, p3, t) {
  return {
    x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
    y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
    z: catmullRom(p0.z, p1.z, p2.z, p3.z, t)
  };
}

/** Modulo toujours positif (utile pour boucler sur la longueur d'un circuit). */
export const modulo = (x, m) => ((x % m) + m) % m;

/**
 * Plus court écart signé entre deux abscisses sur un circuit fermé de longueur `m`.
 * Renvoie une valeur dans [-m/2, m/2].
 */
export function ecartCirculaire(a, b, m) {
  let d = modulo(a - b, m);
  if (d > m / 2) d -= m;
  return d;
}
