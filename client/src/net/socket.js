// Liaison temps réel avec le serveur.
//
// Deux responsabilités seulement : parler au serveur, et savoir quelle heure
// il est chez lui. Tout le reste (règles, affichage) vit ailleurs.

import { io } from 'socket.io-client';
import { RESEAU } from '@shared/config.js';
import { jetonActuel } from './api.js';

export class Reseau {
  constructor() {
    this.socket = null;
    this.decalage = 0;      // heure serveur − heure locale, en millisecondes
    this.ping = 0;
    this.salon = null;
    this.ecouteurs = new Map();
  }

  get connecte() {
    return !!this.socket?.connected;
  }

  /** Heure du serveur estimée, base du départ synchronisé. */
  get maintenantServeur() {
    return Date.now() + this.decalage;
  }

  connecter(pseudo) {
    if (this.socket) return Promise.resolve();

    this.socket = io({ auth: { jeton: jetonActuel(), pseudo }, transports: ['websocket', 'polling'] });

    for (const evenement of [
      'salon:maj', 'salon:erreur', 'salon:exclu', 'salon:nouvel-hote', 'salon:remplacement',
      'course:demarrer', 'course:instantane', 'course:premier', 'course:resultats',
    ]) {
      this.socket.on(evenement, (charge) => {
        if (evenement === 'salon:maj') this.salon = charge;
        this.emet(evenement, charge);
      });
    }

    this.socket.on('disconnect', () => this.emet('deconnecte'));

    return new Promise((resoudre) => {
      this.socket.once('bienvenue', async (accueil) => {
        this.pseudoServeur = accueil.pseudo;
        this.invite = accueil.invite;
        await this.synchroniseHorloge();
        resoudre(accueil);
      });
    });
  }

  /**
   * Mesure du décalage d'horloge.
   *
   * On garde l'échange dont l'aller-retour a été le plus court : c'est celui
   * dont l'estimation est la moins polluée par la gigue du réseau. Sans cela,
   * un seul paquet retardé fausserait le départ synchronisé de tout le monde.
   */
  async synchroniseHorloge(essais = 5) {
    let meilleur = Infinity;
    for (let i = 0; i < essais; i++) {
      const envoi = Date.now();
      const reponse = await new Promise((r) => this.socket.emit('sync', envoi, r));
      const aller = Date.now() - envoi;
      if (aller < meilleur) {
        meilleur = aller;
        this.ping = Math.round(aller / 2);
        this.decalage = Math.round(reponse.serveur - (envoi + aller / 2));
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    return { ping: this.ping, decalage: this.decalage };
  }

  // ---- petit bus d'événements --------------------------------------------

  on(evenement, rappel) {
    if (!this.ecouteurs.has(evenement)) this.ecouteurs.set(evenement, new Set());
    this.ecouteurs.get(evenement).add(rappel);
    return () => this.ecouteurs.get(evenement).delete(rappel);
  }

  emet(evenement, charge) {
    for (const rappel of this.ecouteurs.get(evenement) ?? []) rappel(charge);
  }

  // ---- salon ---------------------------------------------------------------

  creerSalon() {
    return new Promise((r) => this.socket.emit('salon:creer', {}, r));
  }

  rejoindre(code) {
    return new Promise((r) => this.socket.emit('salon:rejoindre', { code }, r));
  }

  reglages(reglages) { this.socket.emit('salon:reglages', reglages); }
  ajouterBot(niveau) { this.socket.emit('salon:bot-ajouter', { niveau }); }
  retirerBot(id) { this.socket.emit('salon:bot-retirer', { id }); }
  choisirVoiture(voiture, peinture) { this.socket.emit('salon:voiture', { voiture, peinture }); }
  pret(pret) { this.socket.emit('salon:pret', { pret }); }
  exclure(id) { this.socket.emit('salon:exclure', { id }); }
  lancer() { this.socket.emit('salon:lancer'); }

  quitter() {
    this.socket?.emit('salon:quitter');
    this.salon = null;
  }

  // ---- course --------------------------------------------------------------

  envoyerEtat(instantane) {
    this.socket?.emit('course:etat', instantane);
  }

  annoncerArrivee(resultat) {
    return new Promise((r) => this.socket.emit('course:arrivee', resultat, r));
  }
}

/**
 * Tampon d'interpolation.
 *
 * Les instantanés arrivent 20 fois par seconde alors que l'écran affiche 60
 * images : sans interpolation, les voitures des autres avanceraient par
 * saccades. On les affiche donc avec un léger retard, dans un passé où l'on
 * dispose toujours de deux échantillons à interpoler.
 */
export class TamponDistant {
  constructor(retardMs = RESEAU.retardInterpolation) {
    this.retard = retardMs;
    this.parId = new Map();
  }

  ajoute(id, echantillon, horodatage) {
    if (!this.parId.has(id)) this.parId.set(id, []);
    const file = this.parId.get(id);
    file.push({ t: horodatage, e: echantillon });
    // Deux secondes d'historique suffisent largement et bornent la mémoire.
    while (file.length > 2 && horodatage - file[0].t > 2000) file.shift();
  }

  /** Échantillon interpolé à afficher maintenant, ou null. */
  echantillon(id, maintenantServeur) {
    const file = this.parId.get(id);
    if (!file || file.length === 0) return null;

    const cible = maintenantServeur - this.retard;

    if (file.length === 1 || cible >= file[file.length - 1].t) {
      return file[file.length - 1].e;
    }

    for (let i = file.length - 1; i > 0; i--) {
      const apres = file[i];
      const avant = file[i - 1];
      if (avant.t <= cible && cible <= apres.t) {
        const duree = apres.t - avant.t;
        const k = duree > 0 ? (cible - avant.t) / duree : 0;
        return melange(avant.e, apres.e, k);
      }
    }
    return file[0].e;
  }

  oublie(id) { this.parId.delete(id); }
  vide() { this.parId.clear(); }
}

const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

function melange(a, b, k) {
  return {
    p: lerp3(a.p, b.p, k),
    // Les vecteurs d'orientation sont interpolés puis renormalisés : une simple
    // interpolation linéaire les raccourcit et déforme la voiture.
    a: normalise(lerp3(a.a, b.a, k)),
    u: normalise(lerp3(a.u, b.u, k)),
    v: lerp(a.v, b.v, k),
    d: b.d,
    n: b.n,
    s: lerp(a.s, b.s, k),
    t: b.t,
  };
}

function normalise(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-6 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 1];
}
