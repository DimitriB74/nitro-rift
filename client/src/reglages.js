// Réglages locaux du joueur.
//
// Ils restent dans le localStorage et ne sont jamais envoyés au serveur : la
// qualité graphique, les volumes et les touches dépendent de la machine, pas du
// compte. Un même joueur sur deux PC veut deux réglages différents.

import { QUALITES, QUALITE_DEFAUT, TOUCHES_DEFAUT, VOLUMES_DEFAUT, CAMERA } from '@shared/config.js';

const CLE = 'nitro-rift.reglages';

const DEFAUTS = {
  qualite: QUALITE_DEFAUT,
  volumes: { ...VOLUMES_DEFAUT },
  touches: structuredClone(TOUCHES_DEFAUT),
  camera: 'normale',
  afficherFps: false
};

function charge() {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return structuredClone(DEFAUTS);
    const lu = JSON.parse(brut);
    return {
      ...structuredClone(DEFAUTS),
      ...lu,
      volumes: { ...DEFAUTS.volumes, ...(lu.volumes ?? {}) },
      touches: { ...structuredClone(DEFAUTS.touches), ...(lu.touches ?? {}) }
    };
  } catch {
    // localStorage indisponible (navigation privée, site bloqué) : on continue
    // avec les valeurs par défaut plutôt que d'empêcher de jouer.
    return structuredClone(DEFAUTS);
  }
}

export const reglages = charge();

export function enregistre() {
  try {
    localStorage.setItem(CLE, JSON.stringify(reglages));
  } catch { /* pas grave : les réglages valent pour la session */ }
}

export function qualiteActive() {
  return QUALITES[reglages.qualite] ?? QUALITES[QUALITE_DEFAUT];
}

export function distanceCamera() {
  return CAMERA.distances[reglages.camera] ?? CAMERA.distances.normale;
}

export function reinitialiseTouches() {
  reglages.touches = structuredClone(TOUCHES_DEFAUT);
  enregistre();
}

/** Libellé lisible d'un `event.code`, en tenant compte du clavier AZERTY. */
export function libelleTouche(code) {
  const table = {
    KeyW: 'Z (W)', KeyA: 'Q (A)', KeyS: 'S', KeyD: 'D',
    KeyQ: 'A (Q)', KeyZ: 'W (Z)', KeyM: 'M', Space: 'Espace',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite',
    ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droite',
    AltLeft: 'Alt', AltRight: 'Alt Gr',
    Enter: 'Entrée', Backspace: 'Retour arrière', Escape: 'Échap', Tab: 'Tab'
  };
  if (table[code]) return table[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Pavé ${code.slice(6)}`;
  return code;
}
