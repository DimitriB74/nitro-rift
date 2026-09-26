// Lecture du clavier.
//
// Les touches sont repérées par `event.code`, c'est-à-dire par leur position
// physique : la touche à gauche du S s'appelle `KeyA` quel que soit le clavier.
// ZQSD en AZERTY et WASD en QWERTY fonctionnent donc sans rien configurer.

import { reglages } from '../reglages.js';

/** Vrai si l'élément visé attend du texte plutôt qu'une commande de jeu. */
function saisieEnCours(cible) {
  if (!cible || cible.nodeType !== 1) return false;
  if (cible.isContentEditable) return true;
  const balise = cible.tagName;
  if (balise === 'TEXTAREA' || balise === 'SELECT') return true;
  if (balise !== 'INPUT') return false;
  // Une case à cocher ou un curseur de réglage ne consomme pas de texte : on
  // laisse le jeu répondre comme avant.
  return !['checkbox', 'radio', 'range', 'button', 'submit'].includes(cible.type);
}

export class Clavier {
  constructor() {
    this.enfoncees = new Set();
    /** Actions déclenchées une seule fois par appui. */
    this.impulsions = new Set();
    this.actif = true;
    this.captureEnCours = null;

    this._appui = (e) => this.appui(e);
    this._relache = (e) => this.relache(e);
    this._flou = () => this.enfoncees.clear();

    window.addEventListener('keydown', this._appui);
    window.addEventListener('keyup', this._relache);
    window.addEventListener('blur', this._flou);
  }

  detruit() {
    window.removeEventListener('keydown', this._appui);
    window.removeEventListener('keyup', this._relache);
    window.removeEventListener('blur', this._flou);
  }

  appui(e) {
    // Mode capture : la prochaine touche est affectée à une action.
    if (this.captureEnCours) {
      e.preventDefault();
      const { action, resout } = this.captureEnCours;
      this.captureEnCours = null;
      if (e.code !== 'Escape') resout({ action, code: e.code });
      else resout(null);
      return;
    }
    if (!this.actif) return;
    if (e.repeat) return;

    // Quand le joueur écrit — pseudo, mot de passe, code de salon, chat — le
    // clavier appartient au champ. Sans ce garde-fou, `preventDefault` plus bas
    // avalait toutes les lettres qui servent aussi à conduire : impossible de
    // taper un pseudo contenant un W, un A, un S, un D ou une espace.
    if (saisieEnCours(e.target)) return;

    // On n'empêche le comportement par défaut que pour les touches qui servent
    // vraiment au jeu : le reste du navigateur doit continuer de fonctionner.
    if (this.estUtilisee(e.code)) e.preventDefault();

    this.enfoncees.add(e.code);
    for (const [action, codes] of Object.entries(reglages.touches)) {
      if (codes.includes(e.code)) this.impulsions.add(action);
    }
  }

  relache(e) {
    this.enfoncees.delete(e.code);
  }

  estUtilisee(code) {
    for (const codes of Object.values(reglages.touches)) {
      if (codes.includes(code)) return true;
    }
    return false;
  }

  /** Vrai tant que l'une des touches de l'action est maintenue. */
  actionActive(action) {
    const codes = reglages.touches[action] ?? [];
    for (const c of codes) if (this.enfoncees.has(c)) return true;
    return false;
  }

  /** Vrai une seule fois, au moment de l'appui. */
  consommeImpulsion(action) {
    if (!this.impulsions.has(action)) return false;
    this.impulsions.delete(action);
    return true;
  }

  videImpulsions() { this.impulsions.clear(); }

  /** Attend la prochaine touche pour la réaffecter. */
  capture(action) {
    return new Promise((resout) => {
      this.captureEnCours = { action, resout };
    });
  }

  /** Entrées de conduite du joueur, au format attendu par la physique. */
  entrees() {
    const gauche = this.actionActive('gauche');
    const droite = this.actionActive('droite');
    return {
      accel: this.actionActive('accelerer') ? 1 : 0,
      frein: this.actionActive('freiner') ? 1 : 0,
      direction: (droite ? 1 : 0) - (gauche ? 1 : 0),
      derapage: this.actionActive('derapage'),
      nitro: this.actionActive('nitro')
    };
  }
}
