// Fantômes : enregistrement et relecture d'un tour.
//
// Un fantôme est une voiture translucide qui rejoue votre meilleur tour. Il faut
// donc stocker une trajectoire complète — position ET orientation, car les
// loopings retournent la voiture — dans quelque chose d'assez compact pour
// tenir dans un document MongoDB à côté du record.
//
// Choix du format : 20 échantillons par seconde, neuf entiers 16 bits chacun
// (position au décimètre, vecteurs « avant » et « haut » à 1/32000), le tout en
// base64. Un tour d'une minute pèse ainsi environ 25 ko au lieu des 70 ko d'un
// JSON de nombres décimaux, et reste lisible par le navigateur comme par Node.

/** Échantillons par seconde. 20 Hz suffit : la relecture interpole. */
export const HZ_FANTOME = 20;

/** Valeurs par échantillon : pos(3) + avant(3) + haut(3). */
const PAR_ECHANTILLON = 9;

/** Facteurs de quantification, choisis pour rester dans ±32767. */
const ECHELLE_POS = 10;      // décimètre
const ECHELLE_VEC = 32000;   // vecteurs unitaires

/** Taille maximale de la chaîne encodée, alignée sur la limite du serveur. */
export const TAILLE_MAX = 60000;

const borne = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));

/**
 * Enregistreur d'un tour.
 *
 * On l'alimente à chaque image avec le temps écoulé dans le tour courant ; il
 * ne retient qu'un échantillon tous les 1/HZ_FANTOME s.
 */
export class Enregistreur {
  constructor(hz = HZ_FANTOME) {
    this.hz = hz;
    this.pas = 1 / hz;
    this.valeurs = [];
    this.prochain = 0;
    this.precedent = null;   // { t, brut[] } de l'appel précédent
  }

  /** Repart de zéro : appelé au début de chaque tour. */
  reinitialise() {
    this.valeurs.length = 0;
    this.prochain = 0;
    this.precedent = null;
  }

  /**
   * @param {number} tempsTour  temps écoulé depuis le début du tour (s)
   * @param {{pos:object, avant:object, haut:object}} etat
   */
  echantillonne(tempsTour, etat) {
    const brut = [
      etat.pos.x * ECHELLE_POS, etat.pos.y * ECHELLE_POS, etat.pos.z * ECHELLE_POS,
      etat.avant.x * ECHELLE_VEC, etat.avant.y * ECHELLE_VEC, etat.avant.z * ECHELLE_VEC,
      etat.haut.x * ECHELLE_VEC, etat.haut.y * ECHELLE_VEC, etat.haut.z * ECHELLE_VEC,
    ];
    const avant = this.precedent;

    // Les images ne tombent pas sur les instants d'échantillonnage : on
    // interpole entre l'image précédente et celle-ci. Sans cela, un échantillon
    // serait posé jusqu'à une image trop tard — un demi-mètre à 110 km/h, soit
    // un décalage visible quand on se bat contre son propre fantôme. La boucle
    // comble aussi les images longues, qui sinon accéléreraient la relecture.
    while (tempsTour >= this.prochain) {
      if (!avant || tempsTour <= avant.t) {
        for (const v of brut) this.valeurs.push(borne(v));
      } else {
        const f = (this.prochain - avant.t) / (tempsTour - avant.t);
        for (let k = 0; k < PAR_ECHANTILLON; k++) {
          this.valeurs.push(borne(avant.brut[k] + (brut[k] - avant.brut[k]) * f));
        }
      }
      this.prochain += this.pas;
    }

    this.precedent = { t: tempsTour, brut };
  }

  get nombreEchantillons() {
    return this.valeurs.length / PAR_ECHANTILLON;
  }

  /** Chaîne encodée, ou `null` si le tour est vide ou trop long à stocker. */
  encode() {
    if (this.nombreEchantillons < 2) return null;
    const texte = encodeFantome(this.valeurs, this.hz);
    return texte.length <= TAILLE_MAX ? texte : null;
  }
}

// ---------------------------------------------------------------------------
// Encodage
// ---------------------------------------------------------------------------

function versBase64(octets) {
  if (typeof Buffer !== 'undefined') return Buffer.from(octets).toString('base64');
  let s = '';
  // Par morceaux : String.fromCharCode(...) sur 25 000 arguments dépasse la
  // pile d'appels du navigateur.
  for (let i = 0; i < octets.length; i += 8192) {
    s += String.fromCharCode(...octets.subarray(i, i + 8192));
  }
  return btoa(s);
}

function depuisBase64(texte) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(texte, 'base64'));
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/**
 * @param {number[]} valeurs  entiers 16 bits, dans l'ordre de l'enregistreur
 * @param {number} hz
 * @returns {string} `f1:<hz>:<base64>`
 */
export function encodeFantome(valeurs, hz = HZ_FANTOME) {
  const tableau = new Int16Array(valeurs);
  return `f1:${hz}:${versBase64(new Uint8Array(tableau.buffer, tableau.byteOffset, tableau.byteLength))}`;
}

/**
 * Relecture d'un fantôme encodé.
 * @returns {Fantome|null} `null` si la chaîne est absente ou illisible
 */
export function decodeFantome(texte) {
  if (typeof texte !== 'string' || !texte.startsWith('f1:')) return null;
  const deux = texte.indexOf(':', 3);
  if (deux < 0) return null;

  const hz = Number(texte.slice(3, deux));
  if (!Number.isFinite(hz) || hz <= 0) return null;

  try {
    const octets = depuisBase64(texte.slice(deux + 1));
    // Une copie est nécessaire : Buffer.from peut rendre une vue non alignée
    // sur deux octets, ce qu'Int16Array refuse.
    const entiers = new Int16Array(octets.slice().buffer);
    if (entiers.length < PAR_ECHANTILLON * 2) return null;
    return new Fantome(entiers, hz);
  } catch {
    return null;
  }
}

/** Trajectoire relue, interpolée entre deux échantillons. */
export class Fantome {
  constructor(entiers, hz = HZ_FANTOME) {
    this.v = entiers;
    this.hz = hz;
    this.pas = 1 / hz;
    this.n = Math.floor(entiers.length / PAR_ECHANTILLON);
    this.duree = (this.n - 1) * this.pas;

    // Réutilisé à chaque image : on ne veut pas allouer 60 fois par seconde.
    this.pose = {
      pos: { x: 0, y: 0, z: 0 },
      avant: { x: 0, y: 0, z: 1 },
      haut: { x: 0, y: 1, z: 0 },
    };
  }

  /**
   * Pose à un instant du tour. Avant le début et après la fin, on reste sur le
   * premier ou le dernier échantillon : un fantôme ne disparaît pas, il attend.
   *
   * ATTENTION : l'objet rendu est réutilisé d'un appel à l'autre, pour ne pas
   * allouer soixante fois par seconde. Il faut le lire tout de suite, ou en
   * copier les valeurs ; deux appels ne donnent pas deux objets distincts.
   *
   * @param {number} temps  secondes depuis le début du tour
   */
  poseA(temps) {
    const brut = Math.max(0, Math.min(this.duree, temps)) / this.pas;
    const i = Math.min(this.n - 2, Math.floor(brut));
    const f = brut - i;

    const a = i * PAR_ECHANTILLON;
    const b = a + PAR_ECHANTILLON;
    const v = this.v;
    const lerp = (k) => (v[a + k] + (v[b + k] - v[a + k]) * f);

    const p = this.pose;
    p.pos.x = lerp(0) / ECHELLE_POS; p.pos.y = lerp(1) / ECHELLE_POS; p.pos.z = lerp(2) / ECHELLE_POS;
    p.avant.x = lerp(3) / ECHELLE_VEC; p.avant.y = lerp(4) / ECHELLE_VEC; p.avant.z = lerp(5) / ECHELLE_VEC;
    p.haut.x = lerp(6) / ECHELLE_VEC; p.haut.y = lerp(7) / ECHELLE_VEC; p.haut.z = lerp(8) / ECHELLE_VEC;
    return p;
  }
}
