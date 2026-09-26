// Showroom du garage : la voiture sélectionnée sur un plateau tournant.
//
// Rendu dans son propre canvas, indépendant de celui de la course : le garage
// est un écran opaque posé par-dessus, et on ne veut pas mêler sa scène à
// celle d'un circuit peut-être encore chargé. Le contexte est créé à la
// première ouverture et réutilisé ensuite.
//
// La boucle ne tourne que lorsque le showroom est visible : un garage ouvert ne
// doit pas faire chauffer la machine.

import * as THREE from 'three';

import { creerVoiture, detruitVoiture, orienteVoiture, animeRoues } from './voiture.js';
import { qualiteActive } from '../reglages.js';

/** Tours par minute du plateau. */
const VITESSE_ROTATION = 6;

export class Showroom {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.angle = 0.6;
    this.hauteur = 0.34;          // 0 = de face, 1 = vue de dessus
    this.distance = 6.2;
    this.tourne = true;
    this.voiture = null;
    this.derniereImage = 0;
    this.actif = false;

    this.rendu = new THREE.WebGLRenderer({
      canvas, antialias: qualiteActive().antiAliasing, alpha: true, stencil: false,
    });
    this.rendu.outputColorSpace = THREE.SRGBColorSpace;
    this.rendu.toneMapping = THREE.ACESFilmicToneMapping;
    this.rendu.shadowMap.enabled = qualiteActive().ombres;
    this.rendu.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    this.construitDecor();
    this.brancheSouris();
    this.redimensionne();
  }

  /** Plateau, lumières et fond : un petit studio photo. */
  construitDecor() {
    const socle = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.3, 0.22, 64),
      new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.55, metalness: 0.3 }),
    );
    socle.position.y = -0.11;
    socle.receiveShadow = true;
    this.scene.add(socle);

    // Un anneau lumineux donne l'échelle et sépare la voiture du fond noir.
    const anneau = new THREE.Mesh(
      new THREE.TorusGeometry(3.15, 0.035, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x34e0ff }),
    );
    anneau.rotation.x = Math.PI / 2;
    anneau.position.y = 0.005;
    this.scene.add(anneau);

    this.scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x0b1020, 1.1));

    // Trois sources : une clé chaude, un remplissage froid, un contre-jour.
    const cle = new THREE.DirectionalLight(0xfff0dc, 2.1);
    cle.position.set(4, 6, 4);
    cle.castShadow = qualiteActive().ombres;
    cle.shadow.mapSize.set(1024, 1024);
    cle.shadow.camera.left = -5; cle.shadow.camera.right = 5;
    cle.shadow.camera.top = 5; cle.shadow.camera.bottom = -5;
    this.scene.add(cle);

    const remplissage = new THREE.DirectionalLight(0x9ec8ff, 0.8);
    remplissage.position.set(-5, 3, 2);
    this.scene.add(remplissage);

    const contre = new THREE.SpotLight(0x34e0ff, 26, 18, 0.7, 0.6);
    contre.position.set(-2, 4, -6);
    this.scene.add(contre);
  }

  /** Glisser pour tourner autour, molette pour s'approcher. */
  brancheSouris() {
    let attrape = null;

    this.canvas.addEventListener('pointerdown', (e) => {
      attrape = { x: e.clientX, y: e.clientY };
      this.tourne = false;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!attrape) return;
      this.angle -= (e.clientX - attrape.x) * 0.008;
      this.hauteur = Math.max(0.05, Math.min(0.85, this.hauteur + (e.clientY - attrape.y) * 0.004));
      attrape = { x: e.clientX, y: e.clientY };
    });
    const relache = (e) => {
      if (!attrape) return;
      attrape = null;
      this.canvas.releasePointerCapture?.(e.pointerId);
      // La rotation automatique reprend : sinon la voiture reste figée de dos.
      this.tourne = true;
    };
    this.canvas.addEventListener('pointerup', relache);
    this.canvas.addEventListener('pointercancel', relache);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = Math.max(4, Math.min(11, this.distance + Math.sign(e.deltaY) * 0.5));
    }, { passive: false });
  }

  /** Remplace la voiture exposée. */
  montre(idVoiture, peinture, modele = null) {
    if (this.voiture) {
      this.scene.remove(this.voiture);
      detruitVoiture(this.voiture);
      this.voiture = null;
    }
    if (!idVoiture) return;

    this.voiture = creerVoiture(idVoiture, peinture, modele);
    this.voiture.traverse((o) => { if (o.isMesh) o.castShadow = qualiteActive().ombres; });
    // La voiture est posée à plat : le showroom n'a ni piste ni gravité.
    orienteVoiture(this.voiture, {
      pos: { x: 0, y: 0, z: 0 },
      avant: { x: 0, y: 0, z: 1 },
      haut: { x: 0, y: 1, z: 0 },
    }, 0.45);
    this.scene.add(this.voiture);
  }

  redimensionne() {
    const l = this.canvas.clientWidth || 420;
    const h = this.canvas.clientHeight || 280;
    this.rendu.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.rendu.setSize(l, h, false);
    this.camera.aspect = l / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // Boucle
  // -------------------------------------------------------------------------

  demarre() {
    if (this.actif) return;
    this.actif = true;
    this.derniereImage = performance.now();
    this.redimensionne();
    const image = (t) => {
      if (!this.actif) return;
      const dt = Math.min((t - this.derniereImage) / 1000, 0.1);
      this.derniereImage = t;
      this.maj(dt);
      requestAnimationFrame(image);
    };
    requestAnimationFrame(image);
  }

  arrete() {
    this.actif = false;
  }

  maj(dt) {
    if (this.tourne) this.angle += (VITESSE_ROTATION * Math.PI / 30) * dt / 6;

    const y = 0.6 + this.hauteur * 4.2;
    const rayon = this.distance * Math.cos(this.hauteur * 0.9);
    this.camera.position.set(
      Math.sin(this.angle) * rayon, y, Math.cos(this.angle) * rayon,
    );
    this.camera.lookAt(0, 0.6, 0);

    // Les roues tournent doucement : une voiture parfaitement figée paraît
    // morte, et on voit mieux les jantes.
    if (this.voiture) animeRoues(this.voiture, 1.2, 0, dt);

    this.rendu.render(this.scene, this.camera);
  }

  detruit() {
    this.arrete();
    if (this.voiture) detruitVoiture(this.voiture);
    this.rendu.dispose();
  }
}
