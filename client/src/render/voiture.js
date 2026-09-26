// Modèle 3D d'une voiture.
//
// Si le fichier glTF correspondant est présent dans /client/assets/models/cars,
// il est utilisé. Sinon on génère une voiture de remplacement : une carrosserie
// profilée, des vitres et quatre roues — pas un cube — pour que le jeu reste
// jouable et lisible sans aucun asset.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VOITURES, PEINTURES } from '@shared/cars.js';
import { CHEMINS } from '@shared/config.js';
import { qualiteActive } from '../reglages.js';

const chargeur = new GLTFLoader();
const modeles = new Map();

/**
 * Tente de charger le modèle glTF d'une voiture.
 * @returns {Promise<THREE.Object3D|null>} null si le fichier n'existe pas
 */
export function chargeModele(id) {
  if (modeles.has(id)) return modeles.get(id);
  const promesse = new Promise((resout) => {
    chargeur.load(
      `${CHEMINS.modeles}${id}.glb`,
      (gltf) => resout(gltf.scene),
      undefined,
      () => resout(null)   // fichier absent : on passera par le modèle procédural
    );
  });
  modeles.set(id, promesse);
  return promesse;
}

// ---------------------------------------------------------------------------
// Carrosserie procédurale
// ---------------------------------------------------------------------------

/**
 * Sections transversales de la carrosserie, du pare-chocs arrière au capot.
 * z : position le long de la voiture, l : demi-largeur, b : bas, h : haut.
 */
const SECTIONS = [
  { z: -2.15, l: 0.70, b: 0.34, h: 0.86 },
  { z: -1.70, l: 0.94, b: 0.24, h: 1.02 },
  { z: -0.90, l: 0.97, b: 0.21, h: 1.12 },
  { z: 0.10, l: 0.97, b: 0.20, h: 1.14 },
  { z: 0.95, l: 0.94, b: 0.22, h: 1.00 },
  { z: 1.65, l: 0.82, b: 0.26, h: 0.82 },
  { z: 2.15, l: 0.58, b: 0.34, h: 0.70 }
];

const COTES = 12;

/** Contour d'une section : une super-ellipse, qui donne des flancs galbés. */
function contour(section) {
  const points = [];
  const cy = (section.b + section.h) / 2;
  const hy = (section.h - section.b) / 2;
  for (let i = 0; i < COTES; i++) {
    const a = (i / COTES) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    points.push(new THREE.Vector3(
      section.l * Math.sign(cos) * Math.abs(cos) ** 0.62,
      cy + hy * Math.sign(sin) * Math.abs(sin) ** 0.62,
      section.z
    ));
  }
  return points;
}

function geometrieCarrosserie() {
  const anneaux = SECTIONS.map(contour);
  const positions = [];

  const quad = (a, b, c, d) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  };

  for (let s = 0; s < anneaux.length - 1; s++) {
    const A = anneaux[s];
    const B = anneaux[s + 1];
    for (let i = 0; i < COTES; i++) {
      const j = (i + 1) % COTES;
      // Sens de parcours choisi pour que les normales pointent vers l'extérieur :
      // dans l'autre sens, on verrait l'intérieur de la carrosserie.
      quad(A[i], A[j], B[j], B[i]);
    }
  }

  // Bouchons avant et arrière.
  for (const [anneau, sens] of [[anneaux[0], -1], [anneaux.at(-1), 1]]) {
    const centre = new THREE.Vector3();
    for (const p of anneau) centre.add(p);
    centre.divideScalar(COTES);
    for (let i = 0; i < COTES; i++) {
      const j = (i + 1) % COTES;
      const a = anneau[i];
      const b = anneau[j];
      if (sens > 0) positions.push(centre.x, centre.y, centre.z, a.x, a.y, a.z, b.x, b.y, b.z);
      else positions.push(centre.x, centre.y, centre.z, b.x, b.y, b.z, a.x, a.y, a.z);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function geometrieHabitacle() {
  const sections = [
    { z: -1.15, l: 0.80, b: 0.95, h: 1.10 },
    { z: -0.70, l: 0.86, b: 0.98, h: 1.42 },
    { z: 0.10, l: 0.86, b: 1.00, h: 1.46 },
    { z: 0.75, l: 0.78, b: 0.96, h: 1.22 },
    { z: 1.05, l: 0.62, b: 0.92, h: 1.02 }
  ];
  const anneaux = sections.map(contour);
  const positions = [];
  for (let s = 0; s < anneaux.length - 1; s++) {
    const A = anneaux[s];
    const B = anneaux[s + 1];
    for (let i = 0; i < COTES; i++) {
      const j = (i + 1) % COTES;
      positions.push(A[i].x, A[i].y, A[i].z, A[j].x, A[j].y, A[j].z, B[j].x, B[j].y, B[j].z);
      positions.push(A[i].x, A[i].y, A[i].z, B[j].x, B[j].y, B[j].z, B[i].x, B[i].y, B[i].z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// Géométries partagées par toutes les voitures : on ne les construit qu'une fois.
let geoCache = null;
function geometries() {
  if (!geoCache) {
    geoCache = {
      carrosserie: geometrieCarrosserie(),
      habitacle: geometrieHabitacle(),
      roue: new THREE.CylinderGeometry(0.37, 0.37, 0.30, 16),
      jante: new THREE.CylinderGeometry(0.21, 0.21, 0.32, 12),
      aileron: new THREE.BoxGeometry(1.75, 0.09, 0.42),
      montant: new THREE.BoxGeometry(0.1, 0.32, 0.1),
      phare: new THREE.BoxGeometry(0.42, 0.14, 0.1),
      feu: new THREE.BoxGeometry(0.5, 0.12, 0.08)
    };
    geoCache.roue.rotateZ(Math.PI / 2);
    geoCache.jante.rotateZ(Math.PI / 2);
  }
  return geoCache;
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

export function materiauCarrosserie(peintureId) {
  const p = PEINTURES[peintureId] ?? PEINTURES.rouge;
  const extra = p.materiau ?? {};
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(p.couleur),
    metalness: extra.metalness ?? 0.55,
    roughness: extra.roughness ?? 0.28,
    clearcoat: extra.clearcoat ?? 0.85,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.2
  });
  if (extra.emissive) {
    mat.emissive = new THREE.Color(extra.emissive);
    mat.emissiveIntensity = extra.emissiveIntensity ?? 1;
  }
  return mat;
}

/**
 * @param {string} idVoiture
 * @param {string} peintureId
 * @param {THREE.Object3D|null} modele  modèle glTF éventuel
 */
export function creerVoiture(idVoiture, peintureId, modele = null) {
  const q = qualiteActive();
  const groupe = new THREE.Group();
  groupe.name = `voiture-${idVoiture}`;

  const matCorps = materiauCarrosserie(peintureId);
  const roues = [];

  if (modele) {
    const copie = modele.clone(true);
    copie.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = q.ombres;
      // Un nœud nommé « roue » / « wheel » est animé séparément.
      if (/roue|wheel/i.test(o.name)) roues.push(o);
      else if (/carrosserie|body|paint/i.test(o.name)) o.material = matCorps;
    });
    groupe.add(copie);
    groupe.userData.roues = roues;
    groupe.userData.materiau = matCorps;
    groupe.userData.materiaux = [matCorps];
    return groupe;
  }

  const g = geometries();

  const carrosserie = new THREE.Mesh(g.carrosserie, matCorps);
  carrosserie.castShadow = q.ombres;
  carrosserie.name = 'carrosserie';
  groupe.add(carrosserie);

  const matVitres = new THREE.MeshPhysicalMaterial({
    color: 0x0d1420, metalness: 0.2, roughness: 0.08,
    transmission: 0.55, thickness: 0.4, transparent: true, opacity: 0.72,
    envMapIntensity: 1.4
  });
  const habitacle = new THREE.Mesh(g.habitacle, matVitres);
  habitacle.castShadow = q.ombres;
  habitacle.name = 'habitacle';
  groupe.add(habitacle);

  const matPneu = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9, metalness: 0.0 });
  const matJante = new THREE.MeshStandardMaterial({ color: 0xb9c2cf, roughness: 0.25, metalness: 0.95 });

  for (const [ix, iz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const roue = new THREE.Group();
    const pneu = new THREE.Mesh(g.roue, matPneu);
    const jante = new THREE.Mesh(g.jante, matJante);
    pneu.castShadow = q.ombres;
    roue.add(pneu, jante);
    roue.position.set(ix * 0.92, 0.37, iz * 1.38);
    roue.userData.avant = iz > 0;
    groupe.add(roue);
    roues.push(roue);
  }

  // Aileron.
  const aileron = new THREE.Mesh(g.aileron, matCorps);
  aileron.position.set(0, 1.12, -1.95);
  aileron.castShadow = q.ombres;
  groupe.add(aileron);
  for (const ix of [-1, 1]) {
    const montant = new THREE.Mesh(g.montant, matCorps);
    montant.position.set(ix * 0.62, 0.97, -1.95);
    groupe.add(montant);
  }

  // Phares et feux.
  const matPhare = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 2.2, roughness: 0.2
  });
  const matFeu = new THREE.MeshStandardMaterial({
    color: 0xff2b3a, emissive: 0xff2030, emissiveIntensity: 2.4, roughness: 0.3
  });
  for (const ix of [-1, 1]) {
    const phare = new THREE.Mesh(g.phare, matPhare);
    phare.position.set(ix * 0.55, 0.72, 2.06);
    groupe.add(phare);
    const feu = new THREE.Mesh(g.feu, matFeu);
    feu.position.set(ix * 0.5, 0.86, -2.12);
    groupe.add(feu);
  }

  groupe.userData.roues = roues;
  groupe.userData.materiau = matCorps;
  groupe.userData.materiaux = [matCorps, matVitres];
  groupe.userData.pharesArriere = matFeu;
  return groupe;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

const _mat = new THREE.Matrix4();
const _lat = new THREE.Vector3();
const _avant = new THREE.Vector3();
const _haut = new THREE.Vector3();

/**
 * Place et oriente la voiture à partir de son état physique.
 * On reconstruit la base (latéral, haut, avant) : la voiture doit suivre
 * l'orientation de la piste, y compris à l'envers dans un looping.
 */
export function orienteVoiture(groupe, etat, hauteurCaisse = 0) {
  _avant.set(etat.avant.x, etat.avant.y, etat.avant.z).normalize();
  _haut.set(etat.haut.x, etat.haut.y, etat.haut.z).normalize();
  _lat.crossVectors(_haut, _avant).normalize();
  _mat.makeBasis(_lat, _haut, _avant);
  groupe.quaternion.setFromRotationMatrix(_mat);
  groupe.position.set(etat.pos.x, etat.pos.y, etat.pos.z)
    .addScaledVector(_haut, hauteurCaisse);
}

/** Rotation et braquage des roues. */
export function animeRoues(groupe, vitesse, braquage, dt) {
  const roues = groupe.userData.roues;
  if (!roues) return;
  const angle = (vitesse / 0.37) * dt;
  for (const roue of roues) {
    roue.rotation.x -= angle;
    if (roue.userData?.avant) roue.rotation.y = -braquage * 0.5;
  }
}

/**
 * Une voiture adverse trop près de la caméra devient translucide : les voitures
 * se traversent, il ne faut pas qu'elles masquent la piste.
 */
export function ajusteTransparence(groupe, distance) {
  const mats = groupe.userData.materiaux;
  if (!mats) return;
  const opacite = THREE.MathUtils.clamp((distance - 3) / 7, 0.12, 1);
  for (const m of mats) {
    const cible = m === groupe.userData.materiaux[1] ? Math.min(opacite, 0.72) : opacite;
    m.transparent = cible < 0.99;
    m.opacity = cible;
    m.depthWrite = cible > 0.95;
  }
}

export function detruitVoiture(groupe) {
  groupe.traverse((o) => {
    if (o.isMesh && o.material && !Object.values(geoCache ?? {}).includes(o.geometry)) {
      o.geometry.dispose?.();
    }
  });
  for (const m of groupe.userData.materiaux ?? []) m.dispose();
}
