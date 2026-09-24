// Caméra de poursuite.
//
// Elle suit l'orientation complète de la voiture, vecteur haut compris : sans
// cela, un looping ou un mur vertical deviendrait illisible. Le lissage est
// exponentiel et indépendant de la fréquence d'images.

import * as THREE from 'three';
import { CAMERA } from '@shared/config.js';
import { distanceCamera, qualiteActive } from '../reglages.js';

export class CameraPoursuite {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovMin, 16 / 9, 0.3, 2000);
    this.position = new THREE.Vector3();
    this.regard = new THREE.Vector3();
    this.haut = new THREE.Vector3(0, 1, 0);
    this.fov = CAMERA.fovMin;
    this.secousse = 0;
    this.initialisee = false;

    this._avant = new THREE.Vector3();
    this._hautVoiture = new THREE.Vector3();
    this._voiture = new THREE.Vector3();
    this._cible = new THREE.Vector3();
    this._regardCible = new THREE.Vector3();
  }

  /** Recale la caméra sans transition (départ de course, réapparition). */
  replace(etat) {
    this.initialisee = false;
    this.maj(etat, 0);
  }

  /**
   * @param {object} etat  état physique de la voiture suivie
   * @param {number} dt
   */
  maj(etat, dt) {
    const q = qualiteActive();
    const distance = distanceCamera();

    this._avant.set(etat.avant.x, etat.avant.y, etat.avant.z).normalize();
    this._hautVoiture.set(etat.haut.x, etat.haut.y, etat.haut.z).normalize();
    this._voiture.set(etat.pos.x, etat.pos.y, etat.pos.z);

    // Position visée : derrière et au-dessus, dans le repère de la voiture.
    this._cible.copy(this._voiture)
      .addScaledVector(this._avant, -distance)
      .addScaledVector(this._hautVoiture, CAMERA.hauteur);

    this._regardCible.copy(this._voiture)
      .addScaledVector(this._avant, CAMERA.regardDevant)
      .addScaledVector(this._hautVoiture, 1.1);

    if (!this.initialisee) {
      this.position.copy(this._cible);
      this.regard.copy(this._regardCible);
      this.haut.copy(this._hautVoiture);
      this.initialisee = true;
    } else {
      const kPos = 1 - Math.exp(-CAMERA.lissagePosition * dt);
      const kDir = 1 - Math.exp(-CAMERA.lissageOrientation * dt);
      this.position.lerp(this._cible, kPos);
      this.regard.lerp(this._regardCible, kPos);
      this.haut.lerp(this._hautVoiture, kDir).normalize();
    }

    // Champ de vision : il s'ouvre avec la vitesse, ce qui donne la sensation
    // d'accélération sans toucher à la vitesse réelle.
    const regime = Math.min(etat.vitesseScalaire / etat.params.vitesseMax, 1.25);
    const fovCible = CAMERA.fovMin + (CAMERA.fovMax - CAMERA.fovMin) * regime;
    this.fov += (fovCible - this.fov) * (1 - Math.exp(-4 * dt));

    // Secousse d'atterrissage.
    if (this.secousse > 0) {
      this.secousse = Math.max(0, this.secousse - dt * 2.2);
      const a = this.secousse * CAMERA.secousseAtterrissage;
      this.position.x += (Math.random() - 0.5) * a;
      this.position.y += (Math.random() - 0.5) * a;
      this.position.z += (Math.random() - 0.5) * a;
    }

    this.camera.position.copy(this.position);
    this.camera.up.copy(this.haut);
    this.camera.lookAt(this.regard);
    this.camera.fov = this.fov;
    this.camera.far = q.distanceAffichage;
    this.camera.updateProjectionMatrix();
  }

  /** Déclenche une secousse, d'intensité 0 à 1. */
  secoue(force) {
    this.secousse = Math.min(1.4, this.secousse + force);
  }
}
