// Mise en place du rendu : moteur, ciel, lumières et brouillard par décor.

import * as THREE from 'three';
import { qualiteActive } from '../reglages.js';

/**
 * Ambiance de chaque décor. Tant qu'aucun HDRI n'est fourni dans
 * /client/assets/hdri, le ciel est un dégradé procédural, qui sert aussi de carte
 * d'environnement pour les reflets de la carrosserie.
 */
export const AMBIANCES = {
  test: {
    cielHaut: 0x2a4a7a, cielBas: 0x9fc4e8, horizon: 0xcfe2f5,
    soleil: 0xfff4e0, intensiteSoleil: 2.6, ambiante: 0x8fa8c8, intensiteAmbiante: 0.55,
    brouillard: 0xa8c4e0, densiteBrouillard: 0.0011,
    directionSoleil: [0.5, 0.8, 0.3], sol: 0x5b6b58
  },
  canyon: {
    cielHaut: 0x1e4d85, cielBas: 0xe8b07a, horizon: 0xf3d2a8,
    soleil: 0xffdcae, intensiteSoleil: 3.2, ambiante: 0xc08a5a, intensiteAmbiante: 0.6,
    brouillard: 0xe0b98c, densiteBrouillard: 0.00085,
    directionSoleil: [0.6, 0.55, -0.4], sol: 0xc19060
  },
  ville: {
    cielHaut: 0x05060f, cielBas: 0x14183a, horizon: 0x2a1f4d,
    soleil: 0x6a7ad0, intensiteSoleil: 0.8, ambiante: 0x3a3070, intensiteAmbiante: 0.75,
    brouillard: 0x120f26, densiteBrouillard: 0.0022,
    directionSoleil: [-0.4, 0.7, 0.5], sol: 0x14141c, nuit: true
  },
  stade: {
    cielHaut: 0x0a1030, cielBas: 0x1b2a6b, horizon: 0x3550a8,
    soleil: 0xdfe8ff, intensiteSoleil: 3.4, ambiante: 0x6f8ae0, intensiteAmbiante: 1.2,
    brouillard: 0x16204a, densiteBrouillard: 0.0009,
    directionSoleil: [0.2, 0.9, 0.35], sol: null
  },
  montagne: {
    cielHaut: 0x2f6fb5, cielBas: 0xd8e8f5, horizon: 0xeef5fb,
    soleil: 0xffffff, intensiteSoleil: 3.0, ambiante: 0xbdd4e8, intensiteAmbiante: 0.8,
    brouillard: 0xdbe8f2, densiteBrouillard: 0.0016,
    directionSoleil: [-0.5, 0.7, 0.4], sol: 0xe8eef5
  }
};

export const ambiance = (decor) => AMBIANCES[decor] ?? AMBIANCES.test;

// ---------------------------------------------------------------------------
// Moteur de rendu
// ---------------------------------------------------------------------------

export function creerRendu(canvas) {
  const q = qualiteActive();
  const rendu = new THREE.WebGLRenderer({
    canvas,
    antialias: q.antiAliasing,
    powerPreference: 'high-performance',
    stencil: false
  });
  rendu.outputColorSpace = THREE.SRGBColorSpace;
  rendu.toneMapping = THREE.ACESFilmicToneMapping;
  rendu.toneMappingExposure = 1.0;
  rendu.shadowMap.enabled = q.ombres;
  rendu.shadowMap.type = THREE.PCFSoftShadowMap;
  return rendu;
}

/**
 * Ajuste la taille du rendu.
 * La résolution interne suit le préréglage de qualité : c'est le réglage qui
 * pèse le plus lourd sur une carte graphique intégrée.
 */
export function redimensionne(rendu, camera, canvas) {
  const q = qualiteActive();
  const l = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const pixels = Math.min(window.devicePixelRatio, 2) * q.resolution;
  rendu.setPixelRatio(pixels);
  rendu.setSize(l, h, false);
  if (camera) {
    camera.aspect = l / h;
    camera.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------------------
// Ciel procédural
// ---------------------------------------------------------------------------

const VERTEX_CIEL = /* glsl */`
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_CIEL = /* glsl */`
  uniform vec3 couleurHaut;
  uniform vec3 couleurBas;
  uniform vec3 couleurHorizon;
  varying vec3 vDirection;

  void main() {
    float h = normalize(vDirection).y;
    // Bande d'horizon resserrée, puis dégradé doux vers le zénith.
    float bande = 1.0 - smoothstep(0.0, 0.16, abs(h));
    vec3 couleur = mix(couleurBas, couleurHaut, smoothstep(-0.1, 0.75, h));
    couleur = mix(couleur, couleurHorizon, bande * 0.75);
    gl_FragColor = vec4(couleur, 1.0);
  }
`;

export function creerCiel(amb) {
  const geo = new THREE.SphereGeometry(1, 32, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      couleurHaut: { value: new THREE.Color(amb.cielHaut) },
      couleurBas: { value: new THREE.Color(amb.cielBas) },
      couleurHorizon: { value: new THREE.Color(amb.horizon) }
    },
    vertexShader: VERTEX_CIEL,
    fragmentShader: FRAGMENT_CIEL,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const ciel = new THREE.Mesh(geo, mat);
  ciel.scale.setScalar(1);
  ciel.frustumCulled = false;
  return ciel;
}

// ---------------------------------------------------------------------------
// Scène
// ---------------------------------------------------------------------------

/**
 * @param {THREE.WebGLRenderer} rendu
 * @param {string} decor
 */
export function creerScene(rendu, decor) {
  const q = qualiteActive();
  const amb = ambiance(decor);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(amb.brouillard, amb.densiteBrouillard);

  // Le ciel est rendu dans une scène à part, utilisée comme fond et comme source
  // de reflets : on évite ainsi d'avoir à fournir un fichier HDRI.
  const sceneCiel = new THREE.Scene();
  sceneCiel.add(creerCiel(amb));

  const pmrem = new THREE.PMREMGenerator(rendu);
  pmrem.compileEquirectangularShader();
  const environnement = pmrem.fromScene(sceneCiel, 0, 0.1, 100);
  scene.environment = environnement.texture;
  scene.background = environnement.texture;
  scene.environmentIntensity = amb.nuit ? 0.45 : 1.0;
  pmrem.dispose();

  // --- Lumières ------------------------------------------------------------
  const ambiante = new THREE.HemisphereLight(
    amb.ambiante,
    amb.sol ?? amb.brouillard,
    amb.intensiteAmbiante
  );
  scene.add(ambiante);

  const soleil = new THREE.DirectionalLight(amb.soleil, amb.intensiteSoleil);
  const d = amb.directionSoleil;
  soleil.position.set(d[0], d[1], d[2]).normalize().multiplyScalar(300);
  soleil.castShadow = q.ombres;
  if (q.ombres) {
    const portee = 90;
    soleil.shadow.mapSize.set(q.tailleOmbres, q.tailleOmbres);
    soleil.shadow.camera.left = -portee;
    soleil.shadow.camera.right = portee;
    soleil.shadow.camera.top = portee;
    soleil.shadow.camera.bottom = -portee;
    soleil.shadow.camera.near = 1;
    soleil.shadow.camera.far = 700;
    soleil.shadow.bias = -0.0008;
    soleil.shadow.normalBias = 0.5;
  }
  scene.add(soleil);
  scene.add(soleil.target);

  return { scene, soleil, ambiante, amb, environnement };
}

/**
 * La zone d'ombre suit la voiture : une carte d'ombre de 1024 px couvrant tout
 * un circuit de 3 km ne donnerait rien. On la recentre à chaque image.
 */
export function suitOmbres(soleil, cible) {
  if (!soleil.castShadow) return;
  const d = soleil.position.clone().normalize().multiplyScalar(220);
  soleil.position.copy(cible).add(d);
  soleil.target.position.copy(cible);
  soleil.target.updateMatrixWorld();
}
