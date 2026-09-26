// Couche temps réel : Socket.io.
//
// Elle ne contient aucune règle de jeu. Elle traduit des messages en appels aux
// modules salons/course, et rediffuse. Tout ce qui décide vit ailleurs, ce qui
// permet de tester les règles sans ouvrir une socket.
//
// Authentification : le même jeton JWT que l'API. Un joueur sans jeton est
// accepté en invité — il peut jouer, mais ne gagnera pas de crédits.

import { Server } from 'socket.io';

import { COURSE } from '../shared/config.js';
import { VOITURE_DEPART, PEINTURE_DEPART, IDS_VOITURES, PEINTURES, niveauxVides } from '../shared/cars.js';
import { IDS_NIVEAUX } from '../shared/bots.js';
import { joueurDepuisJeton } from './auth.js';
import { circuit as chargeCircuit, ligneCourse, ORDRE } from './circuits.js';
import { CourseServeur } from './race.js';
import {
  ajouteBot, ajouteHumain, creerSalon, estHote, nettoieSalons, retireBot, retireHumain,
  salonPublic, salons, supprimeSalon, totalParticipants, tousPrets,
} from './rooms.js';
import {
  ajouteParticipants, circuitCourant, creerGrandPrix, enregistreCourse,
  grandPrixPublic, grandPrixTermine, mancheCourante, retireParticipant,
} from '../shared/grandprix.js';
import { meilleurTour } from '../scripts/simulation.js';
import { NIVEAU_MAX } from '../shared/cars.js';

/**
 * Repère de plausibilité par circuit : le meilleur tour d'un bot difficile
 * avec la voiture favorite entièrement améliorée. Calculé une fois au
 * démarrage, il sert à rejeter les temps impossibles.
 */
const referenceTour = new Map();

function calculeReferences() {
  const niveauxMax = Object.fromEntries(
    Object.keys(niveauxVides()).map((stat) => [stat, NIVEAU_MAX]),
  );

  for (const id of ORDRE) {
    try {
      const c = chargeCircuit(id);
      const r = meilleurTour(c, ligneCourse(id), {
        voiture: c.voitureFavorite, niveaux: niveauxMax, niveau: 'difficile', tempsMax: 400,
      });
      if (r.meilleur) referenceTour.set(id, r.meilleur);
    } catch (e) {
      console.warn(`  [multi] référence impossible pour ${id} : ${e.message}`);
    }
  }
}

const erreur = (socket, message) => socket.emit('salon:erreur', { message });

// --- Chat -------------------------------------------------------------------
/** Longueur maximale d'un message, coupée sans prévenir. */
const CHAT_LONGUEUR_MAX = 200;
/** Anti-inondation : au plus N messages par fenêtre glissante. */
const CHAT_FENETRE_MS = 5000;
const CHAT_PAR_FENETRE = 5;

/**
 * Nettoie un message : espaces normalisés, caractères de contrôle retirés,
 * longueur bornée. L'échappement HTML est fait à l'affichage, côté client.
 */
function nettoieMessage(texte) {
  return String(texte ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_LONGUEUR_MAX);
}

/** Participants d'un salon, sous la forme attendue par le module Grand Prix. */
function inscrits(salon) {
  return [...salon.humains.values()].map((h) => ({
    id: h.id, nom: h.pseudo, humain: true, bot: false, voiture: h.voiture,
  })).concat(salon.bots.map((b) => ({
    id: b.id, nom: b.pseudo, humain: false, bot: true, voiture: b.voiture,
  })));
}

/**
 * Prépare la manche à venir : crée le championnat au premier lancement, en
 * ouvre un nouveau quand le précédent est allé au bout, et cale le circuit du
 * salon sur la manche courante.
 */
function prepareGrandPrix(salon) {
  if (!salon.grandPrix || grandPrixTermine(salon.grandPrix)) {
    salon.grandPrix = creerGrandPrix(COURSE.grandPrix, inscrits(salon));
  } else {
    // Quelqu'un a pu arriver entre deux manches : il court, mais à zéro point.
    ajouteParticipants(salon.grandPrix, inscrits(salon));
  }
  salon.circuit = circuitCourant(salon.grandPrix) ?? COURSE.grandPrix[0];
}

/**
 * Compte les points d'une manche et complète la charge des résultats.
 *
 * Appelée par la course juste avant la diffusion : le client reçoit donc le
 * classement de la manche et celui du championnat dans le même message.
 */
function compteManche(salon, charge) {
  const gp = salon.grandPrix;
  if (!gp) return;

  const courue = mancheCourante(gp);

  enregistreCourse(gp, charge.classement.map((c) => ({
    id: c.id,
    position: c.place,
    meilleurTour: c.meilleurTour,
  })));

  // La manche suivante est annoncée dès maintenant : le salon affiche le bon
  // circuit sans attendre un autre message.
  if (!grandPrixTermine(gp)) salon.circuit = circuitCourant(gp);

  // `manche` désigne la prochaine à courir ; l'écran de résultats a besoin de
  // celle qui vient de se terminer.
  charge.grandPrix = { ...grandPrixPublic(gp), mancheCourue: courue };
}

export function brancheMultijoueur(serveurHttp) {
  const io = new Server(serveurHttp, {
    cors: { origin: true },
    pingInterval: 10000,
    pingTimeout: 20000,
  });

  calculeReferences();
  console.log(`  Multijoueur : prêt (références de temps sur ${referenceTour.size} circuits)`);

  setInterval(() => nettoieSalons(), 15 * 60 * 1000).unref?.();

  // -------------------------------------------------------------------------
  //  Authentification
  // -------------------------------------------------------------------------
  io.use(async (socket, next) => {
    const jeton = socket.handshake.auth?.jeton;
    const compte = jeton ? await joueurDepuisJeton(jeton) : null;

    if (compte) {
      socket.data.compteId = String(compte._id);
      socket.data.pseudo = compte.pseudo;
      socket.data.voiture = compte.voitureActive ?? VOITURE_DEPART;
      socket.data.peinture = compte.peintureActive ?? PEINTURE_DEPART;
      socket.data.niveaux = compte.ameliorations?.[compte.voitureActive] ?? niveauxVides();
      socket.data.invite = false;
    } else {
      const propose = String(socket.handshake.auth?.pseudo ?? '').trim().slice(0, 16);
      socket.data.compteId = null;
      socket.data.pseudo = propose || `Invité ${Math.floor(Math.random() * 900 + 100)}`;
      socket.data.voiture = VOITURE_DEPART;
      socket.data.peinture = PEINTURE_DEPART;
      socket.data.niveaux = niveauxVides();
      socket.data.invite = true;
    }
    next();
  });

  // -------------------------------------------------------------------------

  io.on('connection', (socket) => {
    socket.emit('bienvenue', {
      pseudo: socket.data.pseudo,
      invite: socket.data.invite,
      maintenant: Date.now(),
    });

    const monSalon = () => (socket.data.code ? salons.get(socket.data.code) : null);
    const diffuse = (salon) => io.to(salon.code).emit('salon:maj', salonPublic(salon));

    /** Synchronisation d'horloge : aller-retour minimal, sans aucune logique. */
    socket.on('sync', (envoye, repondre) => {
      if (typeof repondre === 'function') repondre({ client: envoye, serveur: Date.now() });
    });

    // ---- salons -----------------------------------------------------------

    socket.on('salon:creer', (_, repondre) => {
      if (monSalon()) return erreur(socket, 'Tu es déjà dans un salon');
      const salon = creerSalon({
        id: socket.id, pseudo: socket.data.pseudo, compteId: socket.data.compteId,
        voiture: socket.data.voiture, peinture: socket.data.peinture, niveaux: socket.data.niveaux,
      });
      socket.data.code = salon.code;
      socket.join(salon.code);
      repondre?.({ ok: true, salon: salonPublic(salon) });
      diffuse(salon);
    });

    socket.on('salon:rejoindre', ({ code } = {}, repondre) => {
      const propre = String(code ?? '').toUpperCase().trim();
      const salon = salons.get(propre);
      if (!salon) return repondre?.({ ok: false, message: 'Aucun salon avec ce code' });
      if (monSalon()) return repondre?.({ ok: false, message: 'Tu es déjà dans un salon' });
      if (totalParticipants(salon) >= COURSE.participantsMax) {
        return repondre?.({ ok: false, message: 'Ce salon est complet' });
      }
      // Un salon en course n'accepte personne : on attend la fin.
      if (salon.phase === 'course') {
        return repondre?.({ ok: false, message: 'Une course est en cours, réessaie dans un instant' });
      }

      ajouteHumain(salon, {
        id: socket.id, pseudo: socket.data.pseudo, compteId: socket.data.compteId,
        voiture: socket.data.voiture, peinture: socket.data.peinture, niveaux: socket.data.niveaux,
      });
      socket.data.code = salon.code;
      socket.join(salon.code);
      repondre?.({ ok: true, salon: salonPublic(salon) });
      diffuse(salon);
    });

    socket.on('salon:reglages', (reglages = {}) => {
      const salon = monSalon();
      if (!salon || !estHote(salon, socket.id)) return;
      if (salon.phase === 'course') return;

      if (['course', 'grand-prix', 'contre-la-montre'].includes(reglages.mode)
          && reglages.mode !== salon.mode) {
        salon.mode = reglages.mode;
        // Changer de mode remet le championnat à zéro : on ne mélange pas les
        // points d'un Grand Prix abandonné avec ceux du suivant.
        salon.grandPrix = null;
        if (salon.mode === 'grand-prix') salon.circuit = COURSE.grandPrix[0];
      }
      // En Grand Prix, l'ordre des manches est fixé : l'hôte ne choisit pas.
      if (salon.mode !== 'grand-prix' && ORDRE.includes(reglages.circuit)) {
        salon.circuit = reglages.circuit;
      }
      if (Number.isInteger(reglages.tours) && reglages.tours >= 1 && reglages.tours <= 10) {
        salon.tours = reglages.tours;
      }
      diffuse(salon);
    });

    socket.on('salon:bot-ajouter', ({ niveau } = {}) => {
      const salon = monSalon();
      if (!salon || !estHote(salon, socket.id) || salon.phase === 'course') return;
      const probleme = ajouteBot(salon, IDS_NIVEAUX.includes(niveau) ? niveau : 'moyen');
      if (probleme) return erreur(socket, probleme);
      diffuse(salon);
    });

    socket.on('salon:bot-retirer', ({ id } = {}) => {
      const salon = monSalon();
      if (!salon || !estHote(salon, socket.id) || salon.phase === 'course') return;
      if (retireBot(salon, id)) diffuse(salon);
    });

    socket.on('salon:voiture', ({ voiture, peinture } = {}) => {
      const salon = monSalon();
      const moi = salon?.humains.get(socket.id);
      if (!moi || salon.phase === 'course') return;

      // On ne vérifie ici que l'existence : la possession réelle est contrôlée
      // au garage, qui est la seule voie pour changer de voiture sur un compte.
      if (IDS_VOITURES.includes(voiture)) moi.voiture = voiture;
      if (PEINTURES[peinture]) moi.peinture = peinture;
      diffuse(salon);
    });

    socket.on('salon:pret', ({ pret } = {}) => {
      const salon = monSalon();
      const moi = salon?.humains.get(socket.id);
      if (!moi || salon.phase === 'course') return;
      moi.pret = !!pret;
      diffuse(salon);
    });

    socket.on('salon:exclure', ({ id } = {}) => {
      const salon = monSalon();
      if (!salon || !estHote(salon, socket.id) || id === socket.id) return;
      const cible = io.sockets.sockets.get(id);
      if (!cible || !salon.humains.has(id)) return;

      cible.emit('salon:exclu');
      cible.leave(salon.code);
      cible.data.code = null;
      retireHumain(salon, id);
      diffuse(salon);
    });

    socket.on('salon:quitter', () => quitte());

    // ---- chat -------------------------------------------------------------

    socket.on('chat', ({ texte } = {}) => {
      const salon = monSalon();
      if (!salon) return;

      const propre = nettoieMessage(texte);
      if (!propre) return;

      // Fenêtre glissante : on ne coupe pas la parole, on ignore l'excès.
      const maintenant = Date.now();
      const recents = (socket.data.chatEnvois ?? []).filter((t) => maintenant - t < CHAT_FENETRE_MS);
      if (recents.length >= CHAT_PAR_FENETRE) {
        return erreur(socket, 'Doucement avec le chat.');
      }
      recents.push(maintenant);
      socket.data.chatEnvois = recents;

      io.to(salon.code).emit('chat:message', {
        id: socket.id,
        pseudo: socket.data.pseudo,
        invite: socket.data.invite,
        texte: propre,
        heure: maintenant,
      });
    });

    // ---- course -----------------------------------------------------------

    socket.on('salon:lancer', () => {
      const salon = monSalon();
      if (!salon || !estHote(salon, socket.id)) return;
      if (salon.phase === 'course') return;
      if (!tousPrets(salon)) return erreur(socket, "Tout le monde n'est pas prêt");

      if (salon.mode === 'grand-prix') prepareGrandPrix(salon);

      let circuit;
      try {
        circuit = chargeCircuit(salon.circuit);
      } catch (e) {
        return erreur(socket, `Circuit indisponible : ${e.message}`);
      }

      salon.course = new CourseServeur(
        salon, circuit, ligneCourse(salon.circuit),
        (evenement, charge) => io.to(salon.code).emit(evenement, charge),
        referenceTour.get(salon.circuit) ?? 0,
        salon.mode === 'grand-prix' ? (charge) => compteManche(salon, charge) : null,
      );
      salon.course.demarrer();
    });

    socket.on('course:etat', (paquet) => {
      const salon = monSalon();
      if (salon?.course && !salon.course.finie) salon.course.majEtatClient(socket.id, paquet);
    });

    socket.on('course:arrivee', (resultat, repondre) => {
      const salon = monSalon();
      if (!salon?.course) return repondre?.({ accepte: false, raison: 'Aucune course' });
      repondre?.(salon.course.arriveeClient(socket.id, resultat));
    });

    // ---- départ -----------------------------------------------------------

    function quitte() {
      const salon = monSalon();
      if (!salon) return;

      socket.leave(salon.code);
      socket.data.code = null;

      const suite = retireHumain(salon, socket.id);

      // Un joueur parti avant d'avoir marqué le moindre point sort du tableau ;
      // s'il en a, sa ligne reste, pour que le classement garde un sens.
      if (salon.grandPrix) {
        const ligne = salon.grandPrix.lignes.find((l) => l.id === socket.id);
        if (ligne && ligne.points === 0) retireParticipant(salon.grandPrix, socket.id);
      }

      if (suite.salonVide) {
        salon.course?.arrete();
        supprimeSalon(salon.code);
        return;
      }
      if (suite.remplaceParBot) {
        io.to(salon.code).emit('salon:remplacement', {
          pseudo: suite.remplaceParBot.pseudo,
        });
      }
      if (suite.nouvelHote) {
        io.to(salon.code).emit('salon:nouvel-hote', { id: suite.nouvelHote.id, pseudo: suite.nouvelHote.pseudo });
      }
      diffuse(salon);
    }

    socket.on('disconnect', quitte);
  });

  return io;
}
