// Course multijoueur côté serveur.
//
// Répartition du travail, choisie pour que le ping ne fausse rien :
//
//  - chaque client simule SA voiture et envoie son état 20 fois par seconde.
//    Le chronométrage se fait donc sur sa machine : un joueur avec 150 ms de
//    latence n'est pas pénalisé sur son temps au tour ;
//  - le serveur simule les bots avec la même physique que le navigateur
//    (/shared), et rediffuse à 20 Hz un instantané contenant tout le monde ;
//  - le serveur vérifie la plausibilité des temps annoncés. Il ne recalcule pas
//    la course — ce serait injouable en pratique — mais il rejette ce qui est
//    physiquement impossible.
//
// Le départ est synchronisé par une heure absolue : le serveur annonce
// « la course part à T », chaque client ayant mesuré son décalage d'horloge.

import { COURSE, RESEAU } from '../shared/config.js';
import { creerBot, entreesBot } from '../shared/bots.js';
import { parametresVoiture } from '../shared/cars.js';
import { creerVoiture, pasPhysique, instantane, progressionNormalisee, videEvenements } from '../shared/physics.js';
import { placeGrille } from '../shared/track.js';
import { prepareBots, salonPublic } from './rooms.js';

const HZ_SIMULATION = 60;
const DT = 1 / HZ_SIMULATION;
const DELAI_DEPART = 3.5; // secondes avant le feu vert, compte à rebours compris

/** Tours attribués en session de contre-la-montre : personne ne les bouclera. */
const TOURS_SESSION = 999;

/**
 * Marge de tolérance du contrôle de plausibilité.
 *
 * On compare le temps annoncé au meilleur temps qu'un bot difficile peut faire
 * avec la voiture favorite entièrement améliorée. Un joueur excellent peut
 * battre ce repère, mais pas de 25 %.
 */
const MARGE_PLAUSIBILITE = 0.75;

export class CourseServeur {
  /**
   * @param {object}   salon
   * @param {object}   circuit
   * @param {object}   ligne
   * @param {Function} diffuser   (evenement, charge) -> void
   * @param {number}   reference  meilleur temps au tour connu, pour la plausibilité
   * @param {Function} [apresFin] appelée avec la charge des résultats juste avant
   *                             leur diffusion, et libre de l'enrichir (Grand Prix)
   */
  constructor(salon, circuit, ligne, diffuser, reference, apresFin = null) {
    this.salon = salon;
    this.circuit = circuit;
    this.ligne = ligne;
    this.diffuser = diffuser;
    this.tempsReference = reference ?? 0;
    this.apresFin = apresFin;

    /**
     * Session de contre-la-montre : pas d'arrivée, un chronomètre. Chacun
     * enchaîne les tours pendant la durée prévue, et c'est le meilleur tour qui
     * classe. On donne alors un nombre de tours volontairement hors d'atteinte
     * pour que la progression ne se termine jamais d'elle-même.
     */
    this.session = salon.mode === 'contre-la-montre';
    this.duree = this.session ? (salon.duree ?? COURSE.dureeContreLaMontre) : null;

    this.tours = this.session
      ? TOURS_SESSION
      : (salon.tours ?? circuit.tours ?? COURSE.toursParDefaut);
    this.heureDepart = Date.now() + DELAI_DEPART * 1000;
    this.heureFin = this.session ? this.heureDepart + this.duree * 1000 : null;
    this.demarree = false;
    this.finie = false;
    this.premierArriveA = null;
    this.classement = [];

    this.bots = [];
    this.minuteurSim = null;
    this.minuteurInstantane = null;
    this.dernierPas = Date.now();

    this.placeParticipants();
  }

  /** Grille de départ : humains devant, bots derrière, dans l'ordre d'arrivée. */
  placeParticipants() {
    prepareBots(this.salon, this.circuit);

    let rang = 0;
    for (const humain of this.salon.humains.values()) {
      humain.rang = rang++;
      humain.depart = placeGrille(this.circuit, humain.rang, COURSE.grille);
      humain.resultat = null;
      humain.etat = null;
      humain.dernierRecu = 0;
      humain.meilleurTour = null;
    }

    for (const bot of this.salon.bots) {
      bot.rang = rang++;
      const depart = placeGrille(this.circuit, bot.rang, COURSE.grille);
      const params = parametresVoiture(bot.voiture, bot.niveaux);
      const etat = creerVoiture(this.circuit, params, depart, { tours: this.tours });

      this.bots.push({
        ref: bot,
        etat,
        cerveau: creerBot(this.circuit, this.ligne, bot.niveau, 1 + bot.rang * 17),
      });
      bot.resultat = null;
      bot.meilleurTour = null;
    }
  }

  demarrer() {
    this.salon.phase = 'course';

    this.diffuser('course:demarrer', {
      circuit: this.circuit.id,
      mode: this.session ? 'contre-la-montre' : 'course',
      tours: this.tours,
      duree: this.duree,
      heureDepart: this.heureDepart,
      heureFin: this.heureFin,
      maintenant: Date.now(),
      grille: this.grillePublique(),
    });

    // Simulation des bots à 60 Hz, diffusion à 20 Hz : on simule finement mais
    // on n'inonde pas le réseau.
    this.minuteurSim = setInterval(() => this.pas(), 1000 / HZ_SIMULATION);
    this.minuteurInstantane = setInterval(() => this.envoieInstantane(), 1000 / RESEAU.hzServeur);
  }

  grillePublique() {
    const ligne = (p) => ({
      id: p.id,
      pseudo: p.pseudo,
      voiture: p.voiture,
      peinture: p.peinture ?? null,
      bot: !!p.bot,
      rang: p.rang,
      depart: p.depart ?? null,
    });
    return [...this.salon.humains.values()].map(ligne)
      .concat(this.salon.bots.map((b) => ({ ...ligne(b), depart: placeGrille(this.circuit, b.rang, COURSE.grille) })));
  }

  get enCourse() {
    return Date.now() >= this.heureDepart;
  }

  pas() {
    if (this.finie) return;

    const maintenant = Date.now();
    // On borne le pas : si l'événement a été retardé (ramassage mémoire,
    // serveur chargé), mieux vaut rattraper en plusieurs pas que faire un bond
    // de physique qui enverrait les bots dans le décor.
    let reste = Math.min((maintenant - this.dernierPas) / 1000, 0.25);
    this.dernierPas = maintenant;

    if (!this.enCourse) return;
    this.demarree = true;

    while (reste > 0) {
      const dt = Math.min(DT, reste);
      reste -= dt;

      for (const bot of this.bots) {
        if (bot.ref.resultat) continue;
        const entrees = entreesBot(bot.cerveau, bot.etat, this.circuit, dt);
        pasPhysique(bot.etat, entrees, dt, this.circuit);
        videEvenements(bot.etat);

        if (this.session) this.releveTours(bot.ref, bot.etat.progression.tempsTours);

        if (bot.etat.progression.termine) {
          this.enregistreArrivee(bot.ref, {
            tempsTotal: bot.etat.progression.tempsTotal,
            tempsTours: bot.etat.progression.tempsTours.slice(),
          }, true);
        }
      }
    }

    if (this.session) {
      if (Date.now() >= this.heureFin) return this.termineSession();
      return;
    }

    this.verifieFin();
  }

  /**
   * Retient le meilleur tour d'un participant.
   * @returns {boolean} vrai si le record du participant a été amélioré
   */
  releveTours(participant, tours) {
    if (!Array.isArray(tours) || tours.length === 0) return false;
    const meilleur = Math.min(...tours);
    if (!Number.isFinite(meilleur) || meilleur <= 0) return false;
    if (participant.meilleurTour != null && meilleur >= participant.meilleurTour) return false;

    participant.meilleurTour = meilleur;
    participant.tousLesTours = tours.length;
    this.classementChange = true;
    return true;
  }

  /**
   * Tour annoncé par un client pendant une session de contre-la-montre.
   *
   * Même garde-fou que pour une arrivée : le chronomètre vient de la machine du
   * joueur, mais un temps physiquement impossible est refusé.
   */
  tourClient(socketId, resultat) {
    if (!this.session || this.finie) return { accepte: false, raison: 'Aucune session en cours' };

    const humain = this.salon.humains.get(socketId);
    if (!humain) return { accepte: false, raison: 'Joueur inconnu' };

    const temps = Number(resultat?.temps);
    if (!Number.isFinite(temps) || temps <= 0) return { accepte: false, raison: 'Temps invalide' };

    const minimum = this.tempsReference * MARGE_PLAUSIBILITE;
    if (this.tempsReference > 0 && temps < minimum) {
      return { accepte: false, raison: 'Temps jugé impossible' };
    }

    const ameliore = this.releveTours(humain, [temps, humain.meilleurTour].filter((t) => t != null));
    if (ameliore) this.diffuseMeilleurs();
    return { accepte: true, meilleur: humain.meilleurTour, ameliore };
  }

  /** Classement en direct des meilleurs tours, envoyé à chaque amélioration. */
  diffuseMeilleurs() {
    this.diffuser('course:meilleurs', {
      heureFin: this.heureFin,
      lignes: this.participantsSession()
        .map((p) => ({ id: p.id, pseudo: p.pseudo, bot: !!p.bot, meilleurTour: p.meilleurTour ?? null }))
        .sort((a, b) => (a.meilleurTour ?? Infinity) - (b.meilleurTour ?? Infinity))
        .map((l, i) => ({ ...l, place: i + 1 })),
    });
  }

  participantsSession() {
    return [...this.salon.humains.values(), ...this.salon.bots, ...this.salon.partis];
  }

  /** Fin d'une session : le classement se fait au meilleur tour. */
  termineSession() {
    if (this.finie) return;

    const tous = this.participantsSession();
    for (const p of tous) {
      p.resultat = {
        tempsTotal: null,
        tempsTours: [],
        meilleurTour: p.meilleurTour ?? null,
        session: true,
        bot: !!p.bot,
      };
    }

    this.termine(tous);
  }

  /** État envoyé par un client pour sa propre voiture. */
  majEtatClient(socketId, paquet) {
    const humain = this.salon.humains.get(socketId);
    if (!humain || humain.resultat) return;
    humain.etat = paquet;
    humain.dernierRecu = Date.now();
  }

  envoieInstantane() {
    if (this.finie) return;

    const joueurs = [];

    for (const humain of this.salon.humains.values()) {
      if (!humain.etat) continue;
      joueurs.push({ i: humain.id, ...humain.etat });
    }

    for (const bot of this.bots) {
      if (bot.ref.resultat && !bot.etat) continue;
      joueurs.push({
        i: bot.ref.id,
        ...instantane(bot.etat),
        s: progressionNormalisee(bot.etat, this.circuit),
      });
    }

    this.diffuser('course:instantane', { t: Date.now(), j: joueurs });
  }

  /**
   * Arrivée annoncée par un client.
   *
   * Le temps vient de sa machine — c'est voulu — mais on refuse ce qui est
   * impossible. Sans ce garde-fou, n'importe qui pourrait annoncer 0,1 s.
   */
  arriveeClient(socketId, resultat) {
    const humain = this.salon.humains.get(socketId);
    if (!humain || humain.resultat) return { accepte: false, raison: 'Déjà arrivé' };

    const total = Number(resultat?.tempsTotal);
    const tours = Array.isArray(resultat?.tempsTours) ? resultat.tempsTours.map(Number) : [];

    if (!Number.isFinite(total) || total <= 0) {
      return { accepte: false, raison: 'Temps invalide' };
    }

    const minimum = this.tempsReference * this.tours * MARGE_PLAUSIBILITE;
    if (this.tempsReference > 0 && total < minimum) {
      console.warn(`  [course] temps rejeté pour ${humain.pseudo} : ${total.toFixed(2)} s ` +
        `(minimum plausible ${minimum.toFixed(2)} s)`);
      this.enregistreArrivee(humain, { tempsTotal: null, tempsTours: [], rejete: true }, false);
      return { accepte: false, raison: 'Temps jugé impossible' };
    }

    this.enregistreArrivee(humain, { tempsTotal: total, tempsTours: tours }, false);
    this.verifieFin();
    return { accepte: true };
  }

  enregistreArrivee(participant, resultat, estBot) {
    if (participant.resultat) return;

    participant.resultat = {
      ...resultat,
      bot: estBot,
      arriveA: Date.now(),
      place: null,
    };

    // Le premier arrivé lance le décompte des trente secondes laissées aux
    // autres : sans cela, un joueur bloqué ferait attendre tout le monde.
    if (this.premierArriveA === null) {
      this.premierArriveA = Date.now();
      this.diffuser('course:premier', {
        pseudo: participant.pseudo,
        delai: COURSE.delaiApresPremier,
      });
    }
  }

  verifieFin() {
    if (this.finie) return;

    // Les partis ayant déjà fini comptent dans le classement.
    const tous = [...this.salon.humains.values(), ...this.salon.bots, ...this.salon.partis];
    const restants = tous.filter((p) => !p.resultat);

    const delaiEcoule = this.premierArriveA !== null
      && Date.now() - this.premierArriveA > COURSE.delaiApresPremier * 1000;

    if (restants.length > 0 && !delaiEcoule) return;

    // Les retardataires sont classés sur leur progression, pas ignorés.
    for (const p of restants) {
      const etatBot = this.bots.find((b) => b.ref === p);
      const avancement = etatBot ? progressionNormalisee(etatBot.etat, this.circuit)
        : (p.etat?.s ?? 0);
      p.resultat = { tempsTotal: null, tempsTours: [], abandon: true, avancement, bot: !!p.bot };
    }

    this.termine(tous);
  }

  termine(tous) {
    this.finie = true;
    clearInterval(this.minuteurSim);
    clearInterval(this.minuteurInstantane);

    // En session de contre-la-montre, le temps total n'existe pas : c'est le
    // meilleur tour qui classe, et celui qui n'en a bouclé aucun ferme la
    // marche.
    this.classement = tous.slice().sort((a, b) => {
      const ra = a.resultat, rb = b.resultat;
      if (this.session) {
        return (ra?.meilleurTour ?? Infinity) - (rb?.meilleurTour ?? Infinity);
      }
      const aFini = ra?.tempsTotal != null, bFini = rb?.tempsTotal != null;
      if (aFini && bFini) return ra.tempsTotal - rb.tempsTotal;
      if (aFini) return -1;
      if (bFini) return 1;
      return (rb?.avancement ?? 0) - (ra?.avancement ?? 0);
    });

    this.classement.forEach((p, i) => { p.resultat.place = i + 1; });

    this.salon.phase = 'attente';
    for (const humain of this.salon.humains.values()) humain.pret = false;

    const charge = {
      circuit: this.circuit.id,
      mode: this.session ? 'contre-la-montre' : 'course',
      classement: this.classement.map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        voiture: p.voiture,
        bot: !!p.bot,
        deconnecte: !!p.deconnecte,
        place: p.resultat.place,
        tempsTotal: p.resultat.tempsTotal,
        meilleurTour: p.resultat.meilleurTour
          ?? (p.resultat.tempsTours?.length ? Math.min(...p.resultat.tempsTours) : null),
        abandon: !!p.resultat.abandon,
        rejete: !!p.resultat.rejete,
      })),
      salon: null,
    };

    // Le Grand Prix compte ses points ici : la charge part alors complète, et le
    // client n'a pas deux messages à recoller. `salonPublic` est relu ensuite,
    // car le championnat peut avoir changé le circuit de la manche suivante.
    this.apresFin?.(charge);
    charge.salon = salonPublic(this.salon);

    this.diffuser('course:resultats', charge);
  }

  arrete() {
    this.finie = true;
    clearInterval(this.minuteurSim);
    clearInterval(this.minuteurInstantane);
  }
}
