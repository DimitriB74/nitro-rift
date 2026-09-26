// Son du jeu, entièrement synthétisé avec l'API Web Audio.
//
// Aucun fichier audio n'est nécessaire : moteur, crissements, nitro, chocs et
// musiques sont produits par oscillateurs et bruit filtré. Le dépôt reste
// léger et il n'y a aucune question de licence. Les fichiers attendus, si un
// jour on veut de vrais sons, sont listés dans client/assets/audio/README.md.
//
// Cinq catégories, chacune avec son curseur de volume dans les paramètres :
// Général, Musique, Moteur, Effets, Interface.

const CATEGORIES = ['musique', 'moteur', 'effets', 'interface'];

export class Audio {
  constructor(volumes) {
    this.ctx = null;
    this.gains = {};
    this.volumes = { general: 70, musique: 55, moteur: 70, effets: 80, interface: 70, ...volumes };
    this.bruit = null;
    this.moteur = null;
    this.musique = null;
    this.rivaux = new Map();
  }

  /**
   * Doit être appelé depuis un geste de l'utilisateur : les navigateurs
   * refusent de démarrer le son autrement.
   */
  demarre() {
    if (this.ctx) return;
    const Contexte = window.AudioContext ?? window.webkitAudioContext;
    if (!Contexte) return;

    this.ctx = new Contexte();
    this.maitre = this.ctx.createGain();
    this.maitre.connect(this.ctx.destination);

    for (const categorie of CATEGORIES) {
      const gain = this.ctx.createGain();
      gain.connect(this.maitre);
      this.gains[categorie] = gain;
    }

    // Une seconde de bruit blanc, réutilisée par tous les sons percussifs.
    const taille = this.ctx.sampleRate;
    this.bruit = this.ctx.createBuffer(1, taille, this.ctx.sampleRate);
    const donnees = this.bruit.getChannelData(0);
    for (let i = 0; i < taille; i++) donnees[i] = Math.random() * 2 - 1;

    this.appliqueVolumes();
  }

  reprend() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  appliqueVolumes(volumes = this.volumes) {
    this.volumes = { ...this.volumes, ...volumes };
    if (!this.ctx) return;
    const general = this.volumes.general / 100;
    this.maitre.gain.value = general;
    for (const categorie of CATEGORIES) {
      this.gains[categorie].gain.value = (this.volumes[categorie] ?? 70) / 100;
    }
  }

  get pret() {
    return !!this.ctx;
  }

  // -------------------------------------------------------------------------
  //  Briques de base
  // -------------------------------------------------------------------------

  souffle({ duree, coupure, gain, type = 'lowpass', sortie = 'effets' }) {
    if (!this.ctx) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.bruit;

    const filtre = this.ctx.createBiquadFilter();
    filtre.type = type;
    filtre.frequency.value = coupure;

    const enveloppe = this.ctx.createGain();
    const t = this.ctx.currentTime;
    enveloppe.gain.setValueAtTime(gain, t);
    enveloppe.gain.exponentialRampToValueAtTime(0.0001, t + duree);

    source.connect(filtre).connect(enveloppe).connect(this.gains[sortie]);
    source.start(t);
    source.stop(t + duree);
  }

  note({ freq, freqFin, duree, gain, type = 'sine', sortie = 'effets', retard = 0 }) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const t = this.ctx.currentTime + retard;
    osc.frequency.setValueAtTime(freq, t);
    if (freqFin) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqFin), t + duree);

    const enveloppe = this.ctx.createGain();
    enveloppe.gain.setValueAtTime(0.0001, t);
    enveloppe.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, duree / 4));
    enveloppe.gain.exponentialRampToValueAtTime(0.0001, t + duree);

    osc.connect(enveloppe).connect(this.gains[sortie]);
    osc.start(t);
    osc.stop(t + duree + 0.02);
  }

  // -------------------------------------------------------------------------
  //  Moteur
  // -------------------------------------------------------------------------

  /**
   * Le moteur est une nappe continue dont la hauteur suit le régime : deux
   * dents de scie légèrement désaccordées pour l'épaisseur, filtrées passe-bas.
   * On ne recrée jamais les oscillateurs — on ne fait que déplacer la
   * fréquence, sinon on entendrait des clics à chaque image.
   */
  demarreMoteur() {
    if (!this.ctx || this.moteur) return;

    const grave = this.ctx.createOscillator();
    const aigu = this.ctx.createOscillator();
    grave.type = 'sawtooth';
    aigu.type = 'sawtooth';
    aigu.detune.value = 12;

    const filtre = this.ctx.createBiquadFilter();
    filtre.type = 'lowpass';
    filtre.frequency.value = 900;
    filtre.Q.value = 3;

    const volume = this.ctx.createGain();
    volume.gain.value = 0;

    grave.connect(filtre);
    aigu.connect(filtre);
    filtre.connect(volume).connect(this.gains.moteur);
    grave.start();
    aigu.start();

    this.moteur = { grave, aigu, filtre, volume };
  }

  /**
   * @param {number} regime  0 à 1
   * @param {number} charge  0 à 1 (accélérateur enfoncé)
   * @param {boolean} nitro
   */
  majMoteur(regime, charge, nitro = false) {
    if (!this.moteur) return;
    const t = this.ctx.currentTime;
    const base = 55 + regime * 210 + (nitro ? 40 : 0);

    // Rampes courtes plutôt que des sauts : la hauteur glisse au lieu de
    // craquer quand le régime change d'un coup.
    this.moteur.grave.frequency.setTargetAtTime(base, t, 0.04);
    this.moteur.aigu.frequency.setTargetAtTime(base * 1.5, t, 0.04);
    this.moteur.filtre.frequency.setTargetAtTime(500 + regime * 2600 + (nitro ? 900 : 0), t, 0.06);
    this.moteur.volume.gain.setTargetAtTime(0.08 + charge * 0.1 + regime * 0.06, t, 0.08);
  }

  arreteMoteur() {
    if (!this.moteur) return;
    const { grave, aigu, volume } = this.moteur;
    const t = this.ctx.currentTime;
    volume.gain.setTargetAtTime(0, t, 0.08);
    grave.stop(t + 0.4);
    aigu.stop(t + 0.4);
    this.moteur = null;
  }

  // -------------------------------------------------------------------------
  //  Effets de course
  // -------------------------------------------------------------------------

  crissement(intensite) {
    this.souffle({ duree: 0.18, coupure: 1400 + intensite * 2200, gain: 0.06 + intensite * 0.1, type: 'bandpass' });
  }

  boostDerapage(palier) {
    const base = [520, 660, 880][Math.min(palier, 2)] ?? 520;
    this.note({ freq: base, freqFin: base * 2, duree: 0.28, gain: 0.22, type: 'triangle' });
    this.souffle({ duree: 0.3, coupure: 2400, gain: 0.12 });
  }

  nitro() {
    this.souffle({ duree: 0.7, coupure: 3200, gain: 0.2, type: 'highpass' });
    this.note({ freq: 140, freqFin: 420, duree: 0.6, gain: 0.16, type: 'sawtooth' });
  }

  choc(force) {
    this.souffle({ duree: 0.22, coupure: 900, gain: Math.min(0.45, 0.12 + force * 0.4) });
    this.note({ freq: 110, freqFin: 60, duree: 0.25, gain: 0.2 });
  }

  atterrissage(force) {
    this.souffle({ duree: 0.3, coupure: 600, gain: Math.min(0.4, 0.1 + force * 0.3) });
  }

  checkpoint(enAvance) {
    this.note({ freq: enAvance ? 880 : 520, duree: 0.12, gain: 0.18, type: 'square', sortie: 'interface' });
  }

  record() {
    for (const [i, f] of [660, 880, 1320].entries()) {
      this.note({ freq: f, duree: 0.3, gain: 0.2, type: 'triangle', sortie: 'interface', retard: i * 0.1 });
    }
  }

  bip(dernier = false) {
    this.note({ freq: dernier ? 880 : 440, duree: dernier ? 0.4 : 0.14, gain: 0.25, type: 'square', sortie: 'interface' });
  }

  clic() {
    this.note({ freq: 1200, duree: 0.05, gain: 0.12, type: 'square', sortie: 'interface' });
  }

  achat() {
    this.note({ freq: 880, freqFin: 1320, duree: 0.18, gain: 0.18, type: 'triangle', sortie: 'interface' });
  }

  /** Bruit de vent, dont le volume suit la vitesse. */
  majVent(vitesse01) {
    if (!this.ctx) return;
    if (!this.vent) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.bruit;
      source.loop = true;
      const filtre = this.ctx.createBiquadFilter();
      filtre.type = 'bandpass';
      filtre.frequency.value = 1200;
      const volume = this.ctx.createGain();
      volume.gain.value = 0;
      source.connect(filtre).connect(volume).connect(this.gains.effets);
      source.start();
      this.vent = { source, filtre, volume };
    }
    const t = this.ctx.currentTime;
    this.vent.volume.gain.setTargetAtTime(Math.max(0, vitesse01 - 0.35) * 0.12, t, 0.15);
    this.vent.filtre.frequency.setTargetAtTime(800 + vitesse01 * 2200, t, 0.2);
  }

  arreteVent() {
    if (!this.vent) return;
    this.vent.volume.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  // -------------------------------------------------------------------------
  //  Musiques
  // -------------------------------------------------------------------------

  /**
   * Boucle musicale simple : une nappe grave et un arpège. Chaque décor a sa
   * gamme et son tempo, ce qui suffit à donner une couleur différente sans
   * un seul fichier.
   */
  joueMusique(ambiance) {
    if (!this.ctx) return;
    this.arreteMusique();

    const themes = {
      menu: { gamme: [220, 262, 330, 392], tempo: 0.46, nappe: 110 },
      desert: { gamme: [196, 233, 294, 349], tempo: 0.38, nappe: 98 },
      ville: { gamme: [262, 311, 392, 466], tempo: 0.3, nappe: 131 },
      stade: { gamme: [294, 349, 440, 523], tempo: 0.26, nappe: 147 },
      montagne: { gamme: [175, 220, 262, 330], tempo: 0.42, nappe: 87 },
      victoire: { gamme: [262, 330, 392, 523], tempo: 0.22, nappe: 131 },
    };
    const theme = themes[ambiance] ?? themes.menu;

    const nappe = this.ctx.createOscillator();
    nappe.type = 'sine';
    nappe.frequency.value = theme.nappe;
    const gainNappe = this.ctx.createGain();
    gainNappe.gain.value = 0.05;
    nappe.connect(gainNappe).connect(this.gains.musique);
    nappe.start();

    let pas = 0;
    const minuteur = setInterval(() => {
      if (!this.ctx) return;
      const freq = theme.gamme[pas % theme.gamme.length] * (pas % 8 < 4 ? 1 : 2);
      this.note({ freq, duree: theme.tempo * 0.9, gain: 0.05, type: 'triangle', sortie: 'musique' });
      pas++;
    }, theme.tempo * 1000);

    this.musique = { nappe, gainNappe, minuteur };
  }

  arreteMusique() {
    if (!this.musique) return;
    clearInterval(this.musique.minuteur);
    const t = this.ctx.currentTime;
    this.musique.gainNappe.gain.setTargetAtTime(0, t, 0.3);
    this.musique.nappe.stop(t + 1);
    this.musique = null;
  }
}
