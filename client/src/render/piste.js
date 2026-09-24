// Génération du maillage d'un circuit à partir de ses repères.
//
// Tout est construit automatiquement depuis les données du circuit : route,
// bandes de rive, murs, accotements hors piste, checkpoints et ligne d'arrivée.
// Rien n'est modélisé à la main.

import * as THREE from 'three';
import { PHYS } from '@shared/config.js';
import { qualiteActive } from '../reglages.js';

/** Un sommet tous les N repères (les repères sont espacés d'un mètre). */
const PAS_MAILLE = 2;

/** Hauteur des murs. */
const HAUTEUR_MUR = 3.2;

/** Largeur de la bande de rive peinte au bord de la route. */
const LARGEUR_RIVE = 0.7;

const COULEURS_SURFACE = {
  route: 0x52565f,
  glace: 0xa8d6ee,
  sable: 0xd4ab74,
  neige: 0xedf3f8,
  terre: 0x7a6852,
  boost: 0x4a3524
};

export function construitPiste(circuit) {
  const groupe = new THREE.Group();
  groupe.name = `piste-${circuit.id}`;
  const q = qualiteActive();

  const indices = echantillons(circuit);

  groupe.add(maillageRoute(circuit, indices, q));
  const rives = maillageRives(circuit, indices);
  if (rives) groupe.add(rives);
  const boosts = maillageBoosts(circuit, indices);
  if (boosts) groupe.add(boosts);
  const murs = maillageMurs(circuit, indices, q);
  if (murs) groupe.add(murs);
  const accotements = maillageAccotements(circuit, indices, q);
  if (accotements) groupe.add(accotements);

  groupe.add(portiques(circuit));
  groupe.add(ligneArrivee(circuit));

  return groupe;
}

/** Indices des repères retenus pour le maillage, bouclés sur le circuit. */
function echantillons(circuit) {
  const liste = [];
  for (let k = 0; k < circuit.nbFrames; k += PAS_MAILLE) liste.push(k);
  liste.push(0); // on referme la boucle
  return liste;
}

const vec = (o) => new THREE.Vector3(o.x, o.y, o.z);

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

function maillageRoute(circuit, indices, q) {
  const positions = [];
  const normales = [];
  const couleurs = [];
  const uvs = [];

  const c = new THREE.Color();
  let longueurUV = 0;

  for (let i = 0; i < indices.length - 1; i++) {
    const a = circuit.frames[indices[i]];
    const b = circuit.frames[indices[i + 1]];

    // Un trou dans la piste n'est pas dessiné : c'est le ravin du Canyon ou la
    // trouée du tremplin de la Montagne. Le ruban existe quand même pour la
    // physique, qui s'en sert pour savoir où la voiture va retomber.
    if (a.surface === 'vide') { longueurUV += PAS_MAILLE; continue; }

    const da = a.largeur / 2 - LARGEUR_RIVE;
    const db = b.largeur / 2 - LARGEUR_RIVE;
    const l0 = vec(a.pos).addScaledVector(vec(a.lateral), da);
    const r0 = vec(a.pos).addScaledVector(vec(a.lateral), -da);
    const l1 = vec(b.pos).addScaledVector(vec(b.lateral), db);
    const r1 = vec(b.pos).addScaledVector(vec(b.lateral), -db);

    const na = vec(a.haut);
    const nb = vec(b.haut);
    c.setHex(COULEURS_SURFACE[a.surface] ?? COULEURS_SURFACE.route);

    const v0 = longueurUV / 8;
    const v1 = (longueurUV + PAS_MAILLE) / 8;
    longueurUV += PAS_MAILLE;

    pousseTriangle(positions, normales, couleurs, uvs,
      [l0, r0, r1], [na, na, nb], c, [[0, v0], [1, v0], [1, v1]]);
    pousseTriangle(positions, normales, couleurs, uvs,
      [l0, r1, l1], [na, nb, nb], c, [[0, v0], [1, v1], [0, v1]]);
  }

  const geo = geometrie(positions, normales, couleurs, uvs);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.06,
    envMapIntensity: q.reflets ? 0.8 : 0.3
  });
  const maille = new THREE.Mesh(geo, mat);
  maille.receiveShadow = q.ombres;
  maille.name = 'route';
  return maille;
}

// ---------------------------------------------------------------------------
// Bandes de rive : ce sont elles qui rendent la piste lisible à 300 km/h
// ---------------------------------------------------------------------------

function maillageRives(circuit, indices) {
  const positions = [];
  const normales = [];
  const couleurs = [];
  const uvs = [];
  const c = new THREE.Color();

  for (let i = 0; i < indices.length - 1; i++) {
    const a = circuit.frames[indices[i]];
    const b = circuit.frames[indices[i + 1]];
    if (a.surface === 'vide') continue;

    // Alternance rouge / blanc tous les 8 mètres.
    c.setHex(Math.floor(a.s / 8) % 2 === 0 ? 0xe9edf2 : 0xd0353f);

    for (const signe of [1, -1]) {
      const aInt = a.largeur / 2 - LARGEUR_RIVE;
      const bInt = b.largeur / 2 - LARGEUR_RIVE;
      const l0 = vec(a.pos).addScaledVector(vec(a.lateral), signe * aInt);
      const r0 = vec(a.pos).addScaledVector(vec(a.lateral), signe * (a.largeur / 2));
      const l1 = vec(b.pos).addScaledVector(vec(b.lateral), signe * bInt);
      const r1 = vec(b.pos).addScaledVector(vec(b.lateral), signe * (b.largeur / 2));
      const na = vec(a.haut);
      const nb = vec(b.haut);
      // Le sens de parcours s'inverse d'un côté à l'autre pour garder
      // les faces tournées vers le haut de la piste.
      const tri = signe > 0
        ? [[l0, r0, r1], [l0, r1, l1]]
        : [[r0, l0, l1], [r0, l1, r1]];
      pousseTriangle(positions, normales, couleurs, uvs, tri[0], [na, na, nb], c);
      pousseTriangle(positions, normales, couleurs, uvs, tri[1], [na, nb, nb], c);
    }
  }

  if (positions.length === 0) return null;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.0 });
  const maille = new THREE.Mesh(geometrie(positions, normales, couleurs, uvs), mat);
  maille.name = 'rives';
  return maille;
}

// ---------------------------------------------------------------------------
// Plaques de boost
// ---------------------------------------------------------------------------

function maillageBoosts(circuit, indices) {
  const positions = [];
  const normales = [];
  const couleurs = [];
  const uvs = [];
  const c = new THREE.Color(0xff8a2b);
  let trouve = false;

  for (let i = 0; i < indices.length - 1; i++) {
    const a = circuit.frames[indices[i]];
    const b = circuit.frames[indices[i + 1]];
    if (a.surface !== 'boost') continue;
    trouve = true;

    const da = a.largeur / 2 - LARGEUR_RIVE - 0.2;
    const db = b.largeur / 2 - LARGEUR_RIVE - 0.2;
    // Légèrement au-dessus de la route, pour éviter le combat de profondeur.
    const ha = vec(a.haut).multiplyScalar(0.05);
    const hb = vec(b.haut).multiplyScalar(0.05);
    const l0 = vec(a.pos).addScaledVector(vec(a.lateral), da).add(ha);
    const r0 = vec(a.pos).addScaledVector(vec(a.lateral), -da).add(ha);
    const l1 = vec(b.pos).addScaledVector(vec(b.lateral), db).add(hb);
    const r1 = vec(b.pos).addScaledVector(vec(b.lateral), -db).add(hb);
    const na = vec(a.haut);
    const nb = vec(b.haut);

    pousseTriangle(positions, normales, couleurs, uvs, [l0, r0, r1], [na, na, nb], c);
    pousseTriangle(positions, normales, couleurs, uvs, [l0, r1, l1], [na, nb, nb], c);
  }

  if (!trouve) return null;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.4,
    metalness: 0.2,
    emissive: new THREE.Color(0xff6a00),
    emissiveIntensity: 0.5
  });
  const maille = new THREE.Mesh(geometrie(positions, normales, couleurs, uvs), mat);
  maille.name = 'boosts';
  return maille;
}

// ---------------------------------------------------------------------------
// Murs
// ---------------------------------------------------------------------------

function maillageMurs(circuit, indices, q) {
  const positions = [];
  const normales = [];
  const couleurs = [];
  const uvs = [];
  const c = new THREE.Color();

  for (let i = 0; i < indices.length - 1; i++) {
    const a = circuit.frames[indices[i]];
    const b = circuit.frames[indices[i + 1]];
    if (a.surface === 'vide') continue;

    // bord[1] = côté du latéral positif, bord[0] = côté négatif.
    for (const [idx, signe] of [[1, 1], [0, -1]]) {
      if (a.bord[idx] !== 'mur') continue;
      c.setHex(Math.floor(a.s / 16) % 2 === 0 ? 0x4a5160 : 0x39404d);

      const b0 = vec(a.pos).addScaledVector(vec(a.lateral), signe * a.largeur / 2);
      const b1 = vec(b.pos).addScaledVector(vec(b.lateral), signe * b.largeur / 2);
      const t0 = b0.clone().addScaledVector(vec(a.haut), HAUTEUR_MUR);
      const t1 = b1.clone().addScaledVector(vec(b.haut), HAUTEUR_MUR);
      const na = vec(a.lateral).multiplyScalar(-signe);
      const nb = vec(b.lateral).multiplyScalar(-signe);

      pousseTriangle(positions, normales, couleurs, uvs, [b0, t0, t1], [na, na, nb], c);
      pousseTriangle(positions, normales, couleurs, uvs, [b0, t1, b1], [na, nb, nb], c);
    }
  }

  if (positions.length === 0) return null;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide
  });
  const maille = new THREE.Mesh(geometrie(positions, normales, couleurs, uvs), mat);
  maille.castShadow = q.ombres;
  maille.receiveShadow = q.ombres;
  maille.name = 'murs';
  return maille;
}

// ---------------------------------------------------------------------------
// Accotements hors piste (sable, neige, terre)
// ---------------------------------------------------------------------------

function maillageAccotements(circuit, indices, q) {
  // Au Stade, au-delà de la piste il n'y a que le vide : pas d'accotement.
  if (circuit.horsPiste === null) return null;

  const positions = [];
  const normales = [];
  const couleurs = [];
  const uvs = [];
  const c = new THREE.Color(COULEURS_SURFACE[circuit.horsPiste] ?? COULEURS_SURFACE.terre);
  const marge = PHYS.margeHorsPiste;

  for (let i = 0; i < indices.length - 1; i++) {
    const a = circuit.frames[indices[i]];
    const b = circuit.frames[indices[i + 1]];
    if (a.surface === 'vide') continue;

    for (const [idx, signe] of [[1, 1], [0, -1]]) {
      if (a.bord[idx] !== 'ouvert') continue;
      const l0 = vec(a.pos).addScaledVector(vec(a.lateral), signe * a.largeur / 2);
      const l1 = vec(b.pos).addScaledVector(vec(b.lateral), signe * b.largeur / 2);
      // L'accotement s'affaisse légèrement : on voit qu'on a quitté la piste.
      const r0 = l0.clone()
        .addScaledVector(vec(a.lateral), signe * marge)
        .addScaledVector(vec(a.haut), -0.35);
      const r1 = l1.clone()
        .addScaledVector(vec(b.lateral), signe * marge)
        .addScaledVector(vec(b.haut), -0.35);
      const na = vec(a.haut);
      const nb = vec(b.haut);
      const tri = signe > 0
        ? [[l0, r0, r1], [l0, r1, l1]]
        : [[r0, l0, l1], [r0, l1, r1]];
      pousseTriangle(positions, normales, couleurs, uvs, tri[0], [na, na, nb], c);
      pousseTriangle(positions, normales, couleurs, uvs, tri[1], [na, nb, nb], c);
    }
  }

  if (positions.length === 0) return null;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide
  });
  const maille = new THREE.Mesh(geometrie(positions, normales, couleurs, uvs), mat);
  maille.receiveShadow = q.ombres;
  maille.name = 'accotements';
  return maille;
}

// ---------------------------------------------------------------------------
// Portiques de checkpoint et ligne d'arrivée
// ---------------------------------------------------------------------------

function portiques(circuit) {
  const groupe = new THREE.Group();
  groupe.name = 'checkpoints';
  const matPoteau = new THREE.MeshStandardMaterial({
    color: 0x1b2230, roughness: 0.5, metalness: 0.6
  });
  const matBarre = new THREE.MeshStandardMaterial({
    color: 0x34e0ff, emissive: 0x18b8d8, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.2
  });

  for (const cp of circuit.checkpoints) {
    if (cp.ligneArrivee) continue;
    const f = circuit.frames[Math.floor(cp.s / circuit.pas) % circuit.nbFrames];
    const demi = f.largeur / 2;
    const haut = vec(f.haut);
    const lat = vec(f.lateral);
    const centre = vec(f.pos);

    const hauteur = 6;
    for (const signe of [1, -1]) {
      const poteau = new THREE.Mesh(new THREE.BoxGeometry(0.45, hauteur, 0.45), matPoteau);
      poteau.position.copy(centre)
        .addScaledVector(lat, signe * (demi + 0.3))
        .addScaledVector(haut, hauteur / 2);
      orienteSurPiste(poteau, f);
      groupe.add(poteau);
    }
    const barre = new THREE.Mesh(new THREE.BoxGeometry(demi * 2 + 1.2, 0.5, 0.3), matBarre);
    barre.position.copy(centre).addScaledVector(haut, hauteur - 0.4);
    orienteSurPiste(barre, f);
    groupe.add(barre);
  }
  return groupe;
}

function ligneArrivee(circuit) {
  const f = circuit.frames[0];
  const demi = f.largeur / 2;
  const damier = new THREE.Mesh(
    new THREE.PlaneGeometry(demi * 2, 3),
    new THREE.MeshStandardMaterial({ map: textureDamier(), roughness: 0.7 })
  );
  damier.position.copy(vec(f.pos)).addScaledVector(vec(f.haut), 0.06);
  orienteSurPiste(damier, f);
  damier.rotateX(-Math.PI / 2);
  damier.name = 'ligne-arrivee';
  return damier;
}

function textureDamier() {
  const taille = 64;
  const toile = document.createElement('canvas');
  toile.width = toile.height = taille;
  const ctx = toile.getContext('2d');
  const carre = taille / 8;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f2f4f8' : '#14171f';
      ctx.fillRect(x * carre, y * carre, carre, carre);
    }
  }
  const tex = new THREE.CanvasTexture(toile);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Oriente un objet selon le repère de la piste (avant, haut, latéral). */
export function orienteSurPiste(objet, frame) {
  const m = new THREE.Matrix4().makeBasis(
    vec(frame.lateral), vec(frame.haut), vec(frame.avant)
  );
  objet.quaternion.setFromRotationMatrix(m);
}

// ---------------------------------------------------------------------------
// Utilitaires de géométrie
// ---------------------------------------------------------------------------

function pousseTriangle(positions, normales, couleurs, uvs, points, normalesPoints, couleur, coordsUV) {
  for (let i = 0; i < 3; i++) {
    positions.push(points[i].x, points[i].y, points[i].z);
    const n = normalesPoints[i];
    normales.push(n.x, n.y, n.z);
    couleurs.push(couleur.r, couleur.g, couleur.b);
    const uv = coordsUV ? coordsUV[i] : [0, 0];
    uvs.push(uv[0], uv[1]);
  }
}

function geometrie(positions, normales, couleurs, uvs) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normales, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(couleurs, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeBoundingSphere();
  return geo;
}

/** Libère la mémoire GPU d'un circuit qu'on quitte. */
export function detruitPiste(groupe) {
  groupe.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
