// Point d'entrée du client NITRO RIFT.
//
// Gère les écrans, la boucle de jeu et l'enchaînement des courses.

import * as THREE from 'three';

import { GAME_NAME, PHYS, QUALITES, LIBELLES_TOUCHES, CAMERA, COURSE, RESEAU } from '@shared/config.js';
import { instantane, progressionNormalisee } from '@shared/physics.js';
import { VOITURES, IDS_VOITURES, PEINTURE_DEPART, niveauxVides } from '@shared/cars.js';
import { NIVEAUX, IDS_NIVEAUX, tirePseudos, choisitVoiture, ameliorationsBot } from '@shared/bots.js';

import { reglages, enregistre, qualiteActive, libelleTouche, reinitialiseTouches } from './reglages.js';
import { Clavier } from './game/entrees.js';
import { catalogue, prepare } from './game/circuits.js';
import { Course, moyenneHumains } from './game/course.js';
import { creerRendu, creerScene, redimensionne, suitOmbres } from './render/scene.js';
import { construitPiste, detruitPiste } from './render/piste.js';
import { creerVoiture, chargeModele, orienteVoiture, animeRoues, ajusteTransparence } from './render/voiture.js';
import { CameraPoursuite } from './render/camera.js';
import { Hud, formateChrono, echappe, nomVoiture } from './ui/hud.js';
import { demandeConnexion, majBandeau } from './ui/auth.js';
import { deconnexion, reprendSession } from './net/api.js';
import { Reseau, TamponDistant } from './net/socket.js';
import { EcranSalon } from './ui/salon.js';
import { Garage, Classements } from './ui/garage.js';
import { Audio } from './audio/audio.js';
import { jetonActuel } from './net/api.js';

// ---------------------------------------------------------------------------
// Écrans
// ---------------------------------------------------------------------------
const ecrans = {};
for (const section of document.querySelectorAll('.ecran')) ecrans[section.id] = section;

function montre(id) {
  for (const [cle, el] of Object.entries(ecrans)) el.classList.toggle('actif', cle === id);
}

for (const el of document.querySelectorAll('[data-nom-jeu]')) el.textContent = GAME_NAME;
document.title = GAME_NAME;

// ---------------------------------------------------------------------------
// Jeu
// ---------------------------------------------------------------------------
class Jeu {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.reseau = null;
    this.salonUi = null;
    this.tampon = new TamponDistant();
    this.audio = new Audio(reglages.volumes);
    this.dernierBip = -1;
    this.derniereEmission = 0;
    this.arriveeAnnoncee = false;
    this.rendu = creerRendu(this.canvas);
    this.clavier = new Clavier();
    this.hud = new Hud();
    this.cameraPoursuite = new CameraPoursuite();

    this.scene = null;
    this.piste = null;
    this.course = null;
    this.mobiles = new Map();          // participant -> objet 3D
    this.enPause = false;
    this.horloge = 0;
    this.dernierInstant = 0;
    this.fps = 60;

    // Réglages de la course à lancer.
    this.config = {
      circuit: null,
      voiture: 'comete',
      peinture: PEINTURE_DEPART,
      bots: 5,
      niveau: 'moyen',
      mode: 'course',
      grandPrix: false
    };

    this.meilleursSplits = new Map();  // circuit -> [temps par checkpoint]
    this.meilleurTourSession = new Map();

    window.addEventListener('resize', () => this.redimensionne());
    this.redimensionne();
  }

  redimensionne() {
    redimensionne(this.rendu, this.cameraPoursuite.camera, this.canvas);
  }

  // -------------------------------------------------------------------------
  // Démarrage
  // -------------------------------------------------------------------------
  async demarre() {
    const texte = document.getElementById('chargement-texte');
    const barre = document.getElementById('chargement-barre');
    const avance = (p, t) => { barre.style.width = `${p}%`; texte.textContent = t; };

    avance(10, 'Connexion au serveur…');
    await this.attendServeur(avance);

    avance(45, 'Chargement des circuits…');
    this.catalogue = await catalogue();
    this.config.circuit = this.catalogue[0]?.id ?? 'canyon';

    avance(70, 'Préparation des voitures…');
    // Les modèles glTF sont optionnels : si les fichiers ne sont pas là, on
    // utilisera la voiture de remplacement procédurale.
    this.modeles = {};
    await Promise.all(IDS_VOITURES.map(async (id) => {
      this.modeles[id] = await chargeModele(id);
    }));

    avance(100, 'Prêt.');
    construitInterface(this);

    // On boucle le rendu tout de suite : l'écran de connexion se superpose au
    // canvas, et la scène reste animée derrière.
    this.boucle(performance.now());

    // Reprise de session si un jeton valide traîne en localStorage, sinon on
    // demande de se connecter. Le mode invité rend null et reste jouable.
    // Les navigateurs refusent de démarrer le son sans geste de l'utilisateur :
    // on s'accroche au premier clic, quel qu'il soit.
    const eveille = () => {
      this.audio.demarre();
      this.audio.reprend();
      this.audio.joueMusique('menu');
      document.removeEventListener('pointerdown', eveille);
    };
    document.addEventListener('pointerdown', eveille);

    this.profil = await reprendSession();
    if (!this.profil) this.profil = await demandeConnexion(montre);

    majBandeau(this.profil);

    this.garage = new Garage(() => jetonActuel(), (profil) => {
      this.profil = profil;
      majBandeau(profil);
    });
    this.classements = new Classements(this.catalogue, this.profil?.pseudo ?? null);

    montre('ecran-menu');
  }

  /**
   * Le service gratuit de Render s'endort après un quart d'heure d'inactivité
   * et met jusqu'à une minute à se réveiller. On réessaie donc patiemment,
   * en le disant au joueur plutôt que d'afficher une erreur.
   */
  async attendServeur(avance) {
    const debut = Date.now();
    for (let essai = 0; ; essai++) {
      try {
        const r = await fetch('/health', { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch { /* serveur endormi ou indisponible */ }

      const secondes = Math.round((Date.now() - debut) / 1000);
      avance(Math.min(40, 10 + essai * 3), `Réveil du serveur… (${secondes} s)`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // -------------------------------------------------------------------------
  // Lancement d'une course
  // -------------------------------------------------------------------------
  async lanceCourse() {
    montre('ecran-chargement');
    document.getElementById('chargement-texte').textContent = 'Construction du circuit…';
    document.getElementById('chargement-barre').style.width = '30%';

    const { circuit, ligne } = await prepare(this.config.circuit);
    document.getElementById('chargement-barre').style.width = '70%';

    this.construitScene(circuit);

    // --- Participants -------------------------------------------------------
    const joueur = {
      id: 'moi',
      nom: 'Vous',
      humain: true,
      voiture: this.config.voiture,
      peinture: this.config.peinture,
      niveaux: niveauxVides()
    };

    const participants = [joueur];
    const moyenne = moyenneHumains(participants);
    const pseudos = tirePseudos(this.config.bots);
    for (let i = 0; i < this.config.bots; i++) {
      const niveau = this.config.niveau;
      const voiture = choisitVoiture(circuit, niveau);
      participants.push({
        id: `bot-${i}`,
        nom: pseudos[i],
        humain: false,
        niveau,
        voiture,
        peinture: IDS_VOITURES.indexOf(voiture) % 2 === 0 ? 'bleu' : 'jaune',
        niveaux: ameliorationsBot(moyenne, niveau)
      });
    }

    this.course = new Course({
      circuit, ligne, participants,
      mode: this.config.mode,
      tours: this.config.mode === 'contre-la-montre' ? 1 : circuit.tours
    });
    this.course.tempsAvantDepartInitial = this.course.tempsAvantDepart;

    this.construitMobiles();
    this.hud.prepare(this.course);
    this.cameraPoursuite.replace(this.course.moi.etat);

    this.enPause = false;
    document.getElementById('voile-pause').hidden = true;
    this.clavier.videImpulsions();
    this.dernierBip = -1;
    this.audio.joueMusique(circuit.decor ?? 'desert');
    montre('ecran-course');
  }

  /**
   * Course en réseau.
   *
   * Différences avec le solo : les autres voitures sont marquées « distant »
   * (leur état vient du serveur, on ne les simule pas), et le compte à rebours
   * est calé sur l'heure de départ annoncée par le serveur, convertie dans
   * l'horloge locale grâce au décalage mesuré.
   */
  async lanceCourseReseau(depart) {
    montre('ecran-chargement');
    document.getElementById('chargement-texte').textContent = 'Construction du circuit…';
    document.getElementById('chargement-barre').style.width = '30%';

    const { circuit, ligne } = await prepare(depart.circuit);
    document.getElementById('chargement-barre').style.width = '70%';
    this.construitScene(circuit);

    const monId = this.reseau.socket.id;
    const participants = depart.grille
      .slice()
      .sort((a, b) => a.rang - b.rang)
      .map((p) => ({
        id: p.id,
        nom: p.pseudo,
        humain: p.id === monId,
        distant: p.id !== monId,
        voiture: p.voiture,
        peinture: p.peinture,
        niveaux: niveauxVides(),
        niveau: 'moyen',
      }));

    this.course = new Course({
      circuit, ligne, participants, mode: 'course', tours: depart.tours,
    });
    this.course.reseau = true;

    // Le serveur annonce une heure absolue. On la ramène dans notre horloge :
    // tout le monde voit donc « 3, 2, 1, partez » au même instant réel.
    const departLocal = depart.heureDepart - this.reseau.decalage;
    this.course.tempsAvantDepart = Math.max(0, (departLocal - Date.now()) / 1000);
    this.course.tempsAvantDepartInitial = this.course.tempsAvantDepart;

    this.tampon.vide();
    this.derniereEmission = 0;
    this.arriveeAnnoncee = false;

    this.construitMobiles();
    this.hud.prepare(this.course);
    this.cameraPoursuite.replace(this.course.moi.etat);

    this.enPause = false;
    document.getElementById('voile-pause').hidden = true;
    this.clavier.videImpulsions();
    this.dernierBip = -1;
    this.audio.joueMusique(circuit.decor ?? 'desert');
    montre('ecran-course');
  }

  /** Envoi de notre état et application de celui des autres. */
  majReseau() {
    const course = this.course;
    if (!course?.reseau || !this.reseau?.connecte) return;

    // Émission à la fréquence prévue, pas à celle de l'écran.
    const maintenant = performance.now();
    if (maintenant - this.derniereEmission >= 1000 / RESEAU.hzClient) {
      this.derniereEmission = maintenant;
      const moi = course.moi;
      this.reseau.envoyerEtat({
        ...instantane(moi.etat),
        s: progressionNormalisee(moi.etat, course.circuit),
      });
    }

    // Les autres voitures sont affichées dans un léger passé, où l'on dispose
    // toujours de deux instantanés à interpoler.
    const t = this.reseau.maintenantServeur;
    for (const p of course.participants) {
      if (!p.distant) continue;
      const echantillon = this.tampon.echantillon(p.id, t);
      if (echantillon) course.appliqueEtatDistant(p.id, echantillon);
    }

    // Notre arrivée est annoncée une seule fois : le chrono vient de notre
    // machine, le serveur ne fait que vérifier qu'il est plausible.
    if (course.moi.arrive && !this.arriveeAnnoncee) {
      this.arriveeAnnoncee = true;
      this.reseau.annoncerArrivee({
        tempsTotal: course.moi.etat.progression.tempsTotal,
        tempsTours: course.moi.etat.progression.tempsTours.slice(),
      });
    }
  }

  /** Moteur, vent et bips du compte à rebours. */
  majAudio() {
    const course = this.course;
    if (!this.audio.pret || !course) return;

    if (course.phase === 'compte') {
      // Un bip par seconde pendant le décompte, le dernier plus aigu.
      const restant = Math.ceil(course.tempsAvantDepart);
      if (restant !== this.dernierBip && restant >= 0 && restant <= 3) {
        this.dernierBip = restant;
        this.audio.bip(restant === 0);
      }
      return;
    }

    const etat = course.moi.etat;
    const vitesse01 = Math.min(1, Math.abs(etat.vitesseScalaire) / (etat.params?.vitesseMax ?? 80));
    this.audio.demarreMoteur();
    this.audio.majMoteur(vitesse01, course.moi.derniereEntree?.accel ?? 0, etat.nitro?.actif ?? false);
    this.audio.majVent(vitesse01);

    // Crissement tant que la voiture dérape.
    if (etat.derapage?.actif) {
      this.tempsCrissement = (this.tempsCrissement ?? 0) + 1;
      if (this.tempsCrissement % 12 === 0) this.audio.crissement(Math.min(1, vitesse01));
    }
  }

  construitScene(circuit) {
    if (this.piste) {
      detruitPiste(this.piste);
      this.scene.remove(this.piste);
    }
    if (!this.scene || this.decorActuel !== circuit.decor) {
      const { scene, soleil } = creerScene(this.rendu, circuit.decor);
      this.scene = scene;
      this.soleil = soleil;
      this.decorActuel = circuit.decor;
      this.mobiles.clear();
    }
    this.piste = construitPiste(circuit);
    this.scene.add(this.piste);
  }

  construitMobiles() {
    for (const objet of this.mobiles.values()) this.scene.remove(objet);
    this.mobiles.clear();
    for (const p of this.course.participants) {
      const objet = creerVoiture(p.voiture, p.peinture, this.modeles[p.voiture]);
      this.scene.add(objet);
      this.mobiles.set(p, objet);
    }
  }

  // -------------------------------------------------------------------------
  // Boucle
  // -------------------------------------------------------------------------
  boucle(instant) {
    requestAnimationFrame((t) => this.boucle(t));

    const dt = Math.min((instant - this.dernierInstant) / 1000, 0.1);
    this.dernierInstant = instant;
    if (!(dt > 0)) return;

    this.horloge += dt;
    this.fps += (1 / dt - this.fps) * 0.08;

    if (this.course && ecrans['ecran-course'].classList.contains('actif')) {
      this.majCourse(dt);
      this.majReseau();
      this.majAudio(dt);
    }

    if (this.scene) this.rendu.render(this.scene, this.cameraPoursuite.camera);
    this.hud.majFps(this.fps, reglages.afficherFps &&
      ecrans['ecran-course'].classList.contains('actif'));
  }

  majCourse(dt) {
    const course = this.course;

    // --- Touches hors conduite ---------------------------------------------
    if (this.clavier.consommeImpulsion('pause')) this.basculePause();
    if (!this.enPause) {
      if (this.clavier.consommeImpulsion('checkpoint')) course.retourDernierCheckpoint();
      if (this.clavier.consommeImpulsion('recommencer') && !this.config.enLigne) {
        this.lanceCourse();
        return;
      }
    }

    if (!this.enPause) {
      const entrees = course.moi.arrive
        ? { accel: 0, frein: 0, direction: 0, derapage: false, nitro: false }
        : this.clavier.entrees();
      course.maj(dt, entrees);
      this.traiteEvenements(course.videEvenements());
    }

    // --- Rendu des voitures -------------------------------------------------
    const posCamera = this.cameraPoursuite.camera.position;
    for (const [p, objet] of this.mobiles) {
      orienteVoiture(objet, p.etat, PHYS.hauteurCaisse);
      animeRoues(objet, p.etat.vitesseScalaire, p.derniereEntree.direction, dt);
      objet.visible = !p.etat.reapparition.actif;
      if (p !== course.moi) ajusteTransparence(objet, objet.position.distanceTo(posCamera));
    }

    this.cameraPoursuite.maj(course.moi.etat, dt);
    if (this.soleil) suitOmbres(this.soleil, this.cameraPoursuite.camera.position);

    this.hud.maj(course, this.horloge, dt);

    if (course.phase === 'fini') this.termine();
  }

  traiteEvenements(evenements) {
    const moi = this.course.moi;
    for (const ev of evenements) {
      if (ev.participant && ev.participant !== moi) continue;

      switch (ev.type) {
        case 'derapage-boost':
          this.audio.boostDerapage(ev.palier ?? 1);
          this.hud.message(
            ev.palier === 3 ? 'Dérapage parfait !' : 'Dérapage !',
            'style', 1.2, this.horloge
          );
          break;
        case 'atterrissage':
          this.audio.atterrissage(Math.min(1, ev.force));
          this.cameraPoursuite.secoue(Math.min(1, ev.force));
          break;
        case 'looping':
          this.audio.note({ freq: 520, freqFin: 1040, duree: 0.35, gain: 0.16, type: 'triangle' });
          this.hud.message('Looping !', 'style', 1.2, this.horloge);
          break;
        case 'checkpoint':
          this.audio.checkpoint(ev.avance === true);
          this.noteIntermediaire(ev);
          break;
        case 'tour':
          this.noteTour(ev);
          break;
        case 'reapparition':
          this.audio.souffle({ duree: 0.3, coupure: 700, gain: 0.18 });
          if (ev.cause !== 'manuel') this.hud.message('Retour au checkpoint', '', 1.2, this.horloge);
          break;
        case 'premier-arrive':
          if (ev.participant !== moi) {
            this.hud.message(`${COURSE.delaiApresPremier} s pour finir`, '', 2.5, this.horloge);
          }
          break;
        default:
          break;
      }
    }
  }

  /** Temps intermédiaire comparé au meilleur tour réalisé dans cette session. */
  noteIntermediaire(ev) {
    const etat = this.course.moi.etat;
    const debutTour = etat.progression.tempsTours.reduce((a, b) => a + b, 0);
    const split = etat.temps - debutTour;
    const refs = this.meilleursSplits.get(this.course.circuit.id);
    const reference = refs ? refs[ev.index] : undefined;
    this.hud.intermediaire(split, reference, this.horloge);
    this.splitsEnCours ??= [];
    this.splitsEnCours[ev.index] = split;
  }

  noteTour(ev) {
    const etat = this.course.moi.etat;
    const tours = etat.progression.tempsTours;
    if (tours.length === 0) return;
    const dernier = tours.at(-1);
    const id = this.course.circuit.id;
    const meilleur = this.meilleurTourSession.get(id);

    if (meilleur === undefined || dernier < meilleur) {
      this.meilleurTourSession.set(id, dernier);
      this.meilleursSplits.set(id, [...(this.splitsEnCours ?? [])]);
      if (meilleur !== undefined) {
        this.hud.message(`Meilleur tour ! ${formateChrono(dernier, 3)}`, 'record', 2.2, this.horloge);
      }
    }
    this.splitsEnCours = [];

    const restants = this.course.tours - ev.tour;
    if (restants === 1) this.hud.message('Dernier tour !', '', 2, this.horloge);
  }

  basculePause() {
    this.enPause = !this.enPause;
    document.getElementById('voile-pause').hidden = !this.enPause;
  }

  termine() {
    afficheResultats(this);
    this.audio?.arreteMoteur();
    this.audio?.arreteVent();
    this.audio?.joueMusique('victoire');
    montre('ecran-resultats');
  }

  quitteCourse() {
    if (this.course?.reseau) this.reseau?.quitter();
    this.course = null;
    this.audio.arreteMoteur();
    this.audio.arreteVent();
    this.audio.joueMusique('menu');
    montre('ecran-menu');
  }

  /**
   * Connexion au serveur temps réel, une seule fois. On en profite pour
   * mesurer le décalage d'horloge, dont dépend le départ synchronisé.
   */
  async connecteReseau() {
    if (this.reseau?.connecte) return;

    this.reseau = new Reseau();
    await this.reseau.connecter(this.profil?.pseudo);
    this.salonUi = new EcranSalon(this.reseau, this.catalogue);

    this.reseau.on('salon:maj', (salon) => {
      this.salonUi.affiche(salon);
      if (document.querySelector('.ecran.actif')?.id === 'ecran-multi') montre('ecran-salon');
    });

    this.reseau.on('salon:erreur', ({ message }) => this.salonUi.erreur(message));

    this.reseau.on('salon:exclu', () => {
      this.salonUi.erreur('');
      montre('ecran-multi');
      document.getElementById('multi-erreur').textContent = "L'hôte t'a exclu du salon.";
    });

    this.reseau.on('salon:nouvel-hote', ({ pseudo }) =>
      this.hud.message(`${pseudo} est le nouvel hôte`));

    this.reseau.on('salon:remplacement', ({ pseudo }) =>
      this.hud.message(`${pseudo} a repris la voiture d'un joueur déconnecté`));

    this.reseau.on('course:demarrer', (depart) => this.lanceCourseReseau(depart));

    this.reseau.on('course:instantane', (paquet) => {
      for (const voiture of paquet.j) {
        // Notre propre voiture nous revient : on garde la nôtre, qui est en
        // avance sur ce que le serveur a reçu.
        if (voiture.i === this.reseau.socket.id) continue;
        this.tampon.ajoute(voiture.i, voiture, paquet.t);
      }
    });

    this.reseau.on('course:premier', ({ pseudo, delai }) =>
      this.hud.message(`${pseudo} a franchi la ligne — ${delai} s pour finir`));

    this.reseau.on('course:resultats', (resultats) => this.afficheResultatsReseau(resultats));

    this.reseau.on('deconnecte', () => {
      if (this.course?.reseau) this.hud.message('Connexion perdue');
    });
  }

  afficheResultatsReseau(resultats) {
    this.course = null;
    this.derniersResultats = resultats;
    afficheResultatsMulti(resultats, this.reseau.socket.id);
  }
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

function construitInterface(jeu) {
  // --- Menu principal ------------------------------------------------------

  brancheActions(document, {
    'grand-prix': () => ouvreMode(jeu, 'course', 'Grand Prix'),
    'contre-la-montre': () => ouvreMode(jeu, 'contre-la-montre', 'Contre-la-montre'),
    'mode-solo': () => ouvreConfig(jeu, jeu.format),
    'mode-multi': async () => {
      const bouton = document.querySelector('[data-action="mode-multi"]');
      bouton.disabled = true;
      try {
        await jeu.connecteReseau();
        document.getElementById('multi-erreur').textContent = '';
        montre('ecran-multi');
      } catch (e) {
        document.getElementById('note-menu').textContent = `Serveur injoignable : ${e.message}`;
      } finally {
        bouton.disabled = false;
      }
    },
    'retour-mode': () => montre('ecran-mode'),
    'quitter-salon': () => { jeu.reseau?.quitter(); montre('ecran-multi'); },
    'parametres': () => { construitParametres(jeu); montre('ecran-parametres'); },
    'garage': () => {
      if (!jeu.profil) {
        document.getElementById('note-menu').textContent =
          'Le garage demande un compte : déconnecte-toi pour en créer un.';
        return;
      }
      jeu.garage.ouvre(jeu.profil);
      montre('ecran-garage');
    },
    'classements': () => { jeu.classements.ouvre(); montre('ecran-classements'); },
    'retour-menu': () => { jeu.course = null; montre('ecran-menu'); },
    'deconnexion': async () => {
      deconnexion();
      jeu.profil = await demandeConnexion(montre);
      majBandeau(jeu.profil);
      montre('ecran-menu');
    },
    'lancer': () => jeu.lanceCourse(),
    'reprendre': () => jeu.basculePause(),
    'recommencer': () => jeu.lanceCourse(),
    'quitter-course': () => jeu.quitteCourse(),
    'rejouer': () => jeu.lanceCourse(),
    'touches-defaut': () => { reinitialiseTouches(); construitParametres(jeu); }
  });

  // --- Créer / rejoindre un salon ------------------------------------------
  document.getElementById('multi-creer').onclick = async () => {
    const reponse = await jeu.reseau.creerSalon();
    if (!reponse?.ok) {
      document.getElementById('multi-erreur').textContent = reponse?.message ?? 'Création impossible';
      return;
    }
    jeu.salonUi.affiche(reponse.salon);
    montre('ecran-salon');
  };

  const champCode = document.getElementById('multi-code');
  const rejoindre = async () => {
    const code = champCode.value.trim().toUpperCase();
    if (code.length !== 4) {
      document.getElementById('multi-erreur').textContent = 'Le code fait 4 caractères.';
      return;
    }
    const reponse = await jeu.reseau.rejoindre(code);
    if (!reponse?.ok) {
      document.getElementById('multi-erreur').textContent = reponse?.message ?? 'Salon introuvable';
      return;
    }
    jeu.salonUi.affiche(reponse.salon);
    montre('ecran-salon');
  };
  document.getElementById('multi-rejoindre').onclick = rejoindre;
  champCode.onkeydown = (e) => { if (e.key === 'Enter') rejoindre(); };
}

function ouvreMode(jeu, format, titre) {
  jeu.format = format;
  jeu.config.mode = format;
  document.getElementById('mode-titre').textContent = titre;
  montre('ecran-mode');
}

/** Résultats d'une course en réseau : le classement vient du serveur. */
function afficheResultatsMulti(resultats, monId) {
  document.getElementById('resultats-titre').textContent = 'Résultats';
  document.getElementById('resultats-gains').textContent = '';

  document.getElementById('resultats-corps').innerHTML = resultats.classement.map((c) => {
    const temps = c.tempsTotal != null ? formateChrono(c.tempsTotal)
      : c.rejete ? 'temps rejeté' : 'abandon';
    const etiquette = c.bot && !c.pseudo.endsWith('(bot)') ? ' (bot)' : '';
    return `<tr class="${c.id === monId ? 'moi' : ''}">
      <td>${ordinal(c.place)}</td>
      <td>${echappe(c.pseudo)}${etiquette}</td>
      <td>${echappe(nomVoiture(c.voiture))}</td>
      <td>${temps}</td>
    </tr>`;
  }).join('');

  montre('ecran-resultats');
}

/** Un curseur par catégorie sonore, appliqué en direct. */
function construitVolumes(jeu) {
  const bloc = document.getElementById('reglages-volumes');
  if (!bloc) return;

  const libelles = {
    general: 'Général', musique: 'Musique', moteur: 'Moteur',
    effets: 'Effets', interface: 'Interface',
  };

  bloc.innerHTML = Object.entries(libelles).map(([cle, nom]) => `
    <div class="ligne-reglage">
      <label for="vol-${cle}">${nom}</label>
      <input type="range" id="vol-${cle}" min="0" max="100" value="${reglages.volumes[cle] ?? 70}">
      <span class="valeur" id="vol-${cle}-valeur">${reglages.volumes[cle] ?? 70}</span>
    </div>`).join('');

  for (const cle of Object.keys(libelles)) {
    const curseur = document.getElementById(`vol-${cle}`);
    curseur.oninput = () => {
      reglages.volumes[cle] = Number(curseur.value);
      document.getElementById(`vol-${cle}-valeur`).textContent = curseur.value;
      // Appliqué immédiatement : on règle au son, pas à l'aveugle.
      jeu.audio.appliqueVolumes(reglages.volumes);
      enregistre();
    };
  }
}

function brancheActions(racine, actions) {
  racine.addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton || bouton.disabled) return;
    const fn = actions[bouton.dataset.action];
    if (fn) fn(bouton);
  });
}

function ouvreConfig(jeu, mode) {
  jeu.config.mode = mode;
  document.getElementById('config-titre').textContent =
    mode === 'contre-la-montre' ? 'Contre‑la‑montre — solo' : 'Course solo';
  document.getElementById('panneau-adversaires').hidden = mode === 'contre-la-montre';
  if (mode === 'contre-la-montre') jeu.config.bots = 0;

  construitChoixCircuits(jeu);
  construitChoixVoitures(jeu);
  construitReglagesBots(jeu);
  montre('ecran-config');
}

function construitChoixCircuits(jeu) {
  const conteneur = document.getElementById('liste-circuits');
  conteneur.innerHTML = '';
  for (const c of jeu.catalogue) {
    const b = document.createElement('button');
    b.className = 'carte';
    b.classList.toggle('actif', c.id === jeu.config.circuit);
    b.innerHTML =
      `<strong>${echappe(c.nom)}</strong>` +
      `<span>${echappe(c.description)}</span>` +
      `<span>${(c.longueur / 1000).toFixed(2).replace('.', ',')} km · ${c.tours} tours · ` +
      `avantage ${echappe(nomVoiture(c.voitureFavorite))}</span>`;
    b.addEventListener('click', () => {
      jeu.config.circuit = c.id;
      construitChoixCircuits(jeu);
    });
    conteneur.appendChild(b);
  }
}

function construitChoixVoitures(jeu) {
  const conteneur = document.getElementById('liste-voitures');
  conteneur.innerHTML = '';
  for (const id of IDS_VOITURES) {
    const v = VOITURES[id];
    const b = document.createElement('button');
    b.className = 'carte';
    b.classList.toggle('actif', id === jeu.config.voiture);
    const stats = Object.entries(v.stats)
      .map(([cle, val]) => `${cle.slice(0, 4)} ${val}`).join(' · ');
    b.innerHTML =
      `<strong><span class="pastille-couleur" style="background:${v.couleurBase}"></span>` +
      `${echappe(v.nom)}</strong>` +
      `<span>${echappe(v.profil)} — ${echappe(v.description)}</span>` +
      `<span>${stats}</span>`;
    b.addEventListener('click', () => {
      jeu.config.voiture = id;
      construitChoixVoitures(jeu);
    });
    conteneur.appendChild(b);
  }
}

function construitReglagesBots(jeu) {
  const curseur = document.getElementById('nb-bots');
  const valeur = document.getElementById('nb-bots-valeur');
  curseur.value = jeu.config.bots;
  valeur.textContent = jeu.config.bots;
  curseur.oninput = () => {
    jeu.config.bots = Number(curseur.value);
    valeur.textContent = curseur.value;
  };

  const segments = document.getElementById('niveau-bots');
  for (const b of segments.querySelectorAll('.segment')) {
    b.classList.toggle('actif', b.dataset.niveau === jeu.config.niveau);
    b.onclick = () => {
      jeu.config.niveau = b.dataset.niveau;
      construitReglagesBots(jeu);
    };
  }
}

function construitParametres(jeu) {
  construitVolumes(jeu);

  // Qualité graphique
  const qualite = document.getElementById('choix-qualite');
  qualite.innerHTML = '';
  for (const [cle, q] of Object.entries(QUALITES)) {
    const b = document.createElement('button');
    b.className = `segment ${cle === reglages.qualite ? 'actif' : ''}`;
    b.textContent = q.nom;
    b.onclick = () => {
      reglages.qualite = cle;
      enregistre();
      jeu.redimensionne();
      construitParametres(jeu);
    };
    qualite.appendChild(b);
  }

  // Caméra
  const cam = document.getElementById('choix-camera');
  cam.innerHTML = '';
  for (const cle of Object.keys(CAMERA.distances)) {
    const b = document.createElement('button');
    b.className = `segment ${cle === reglages.camera ? 'actif' : ''}`;
    b.textContent = CAMERA.libelles[cle] ?? cle;
    b.onclick = () => { reglages.camera = cle; enregistre(); construitParametres(jeu); };
    cam.appendChild(b);
  }

  const fps = document.getElementById('afficher-fps');
  fps.checked = reglages.afficherFps;
  fps.onchange = () => { reglages.afficherFps = fps.checked; enregistre(); };

  // Touches
  const liste = document.getElementById('liste-touches');
  liste.innerHTML = '';
  for (const [action, libelle] of Object.entries(LIBELLES_TOUCHES)) {
    const ligne = document.createElement('div');
    ligne.className = 'touche-ligne';
    const codes = reglages.touches[action] ?? [];
    const bouton = document.createElement('button');
    bouton.className = 'touche-bouton';
    bouton.textContent = codes.map(libelleTouche).join(' / ') || '—';
    bouton.onclick = async () => {
      bouton.classList.add('ecoute');
      bouton.textContent = 'Appuyez sur une touche…';
      const r = await jeu.clavier.capture(action);
      bouton.classList.remove('ecoute');
      if (r) {
        reglages.touches[action] = [r.code];
        enregistre();
      }
      construitParametres(jeu);
    };
    ligne.innerHTML = `<span>${libelle}</span>`;
    ligne.appendChild(bouton);
    liste.appendChild(ligne);
  }
}

// ---------------------------------------------------------------------------
// Résultats
// ---------------------------------------------------------------------------

function afficheResultats(jeu) {
  const course = jeu.course;
  const resultats = course.resultats();

  document.getElementById('resultats-titre').textContent =
    `${course.circuit.nom} — résultats`;

  const corps = document.getElementById('resultats-corps');
  corps.innerHTML = resultats.map((r) => {
    const temps = r.arrive ? formateChrono(r.temps, 2) : `${r.tours} tour(s)`;
    const meilleur = r.meilleurTour ? formateChrono(r.meilleurTour, 3) : '—';
    return `<tr class="${r.humain ? 'moi' : ''}">` +
      `<td>${r.position}</td>` +
      `<td>${echappe(r.nom)}${r.humain ? '' : ` <small>(${NIVEAUX[r.niveau]?.nom ?? ''})</small>`}</td>` +
      `<td>${echappe(nomVoiture(r.voiture))}</td>` +
      `<td class="temps">${temps}</td>` +
      `<td class="temps">${meilleur}</td>` +
      '</tr>';
  }).join('');

  const moi = resultats.find((r) => r.humain);
  const gains = document.getElementById('resultats-gains');
  gains.innerHTML =
    '<h3>Votre course</h3>' +
    ligneStat('Position', `${ordinal(moi.position)} sur ${resultats.length}`) +
    ligneStat('Meilleur tour', moi.meilleurTour ? formateChrono(moi.meilleurTour, 3) : '—') +
    ligneStat('Dérapages (paliers 1 / 2 / 3)', moi.stats.derapages.join(' / ')) +
    ligneStat('Sauts', moi.stats.sauts) +
    ligneStat('Loopings', moi.stats.loopings) +
    ligneStat('Murs touchés', moi.stats.murs) +
    ligneStat('Réapparitions', moi.stats.reapparitions) +
    '<div id="resultats-credits"></div>';

  envoieResultat(jeu, course, resultats, moi);
}

/**
 * Déclare le résultat au serveur, qui calcule les crédits.
 *
 * Le client n'annonce que ce qu'il a fait ; le barème, les plafonds et les
 * défis sont appliqués côté serveur. En mode invité, on n'envoie rien et on
 * le dit.
 */
async function envoieResultat(jeu, course, resultats, moi) {
  const bloc = document.getElementById('resultats-credits');
  if (!bloc) return;

  if (!jeu.profil) {
    bloc.innerHTML = '<p class="note">Mode invité : aucun crédit n’est gagné. ' +
      'Crée un compte pour progresser.</p>';
    return;
  }

  bloc.innerHTML = '<p class="note">Calcul des gains…</p>';

  const adversaires = resultats
    .filter((r) => !r.humain)
    .map((r) => ({ type: 'bot', niveau: r.niveau ?? 'moyen' }));

  try {
    const reponse = await fetch('/api/course/resultat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jetonActuel()}` },
      body: JSON.stringify({
        circuit: course.circuit.id,
        mode: course.mode,
        voiture: moi.voiture,
        position: moi.position,
        arrive: moi.arrive,
        participants: resultats.length,
        meilleurTour: moi.meilleurTour,
        adversaires,
        stats: moi.stats,
      }),
    });
    const data = await reponse.json();
    if (!reponse.ok) throw new Error(data.erreur ?? 'Erreur serveur');

    jeu.profil = data.profil;
    majBandeau(data.profil);

    const lignes = (data.lignes ?? [])
      .map((l) => ligneStat(l.libelle + (l.detail ? ` <small style="opacity:.6">${echappe(l.detail)}</small>` : ''),
        `+${l.credits} ¤`))
      .join('');

    bloc.innerHTML = `<h3 style="margin-top:14px">Gains</h3>${lignes}` +
      ligneStat('<b>Total</b>', `<b>+${data.gains} ¤</b>`) +
      (data.defis.length
        ? `<p class="note">Défi réussi : ${data.defis.map((d) => echappe(d.nom)).join(', ')}</p>`
        : '');
  } catch (e) {
    bloc.innerHTML = `<p class="erreur">Gains non enregistrés : ${echappe(e.message)}</p>`;
  }
}

/** Ordinal français : 1re, 2e, 3e... */
const ordinal = (n) => `${n}<sup>${n === 1 ? 're' : 'e'}</sup>`;

const ligneStat = (libelle, valeur) =>
  `<div class="ligne-gain"><span>${libelle}</span><span>${valeur}</span></div>`;

// ---------------------------------------------------------------------------
const jeu = new Jeu();

// Poignée de diagnostic : le serveur décidant de tout ce qui compte, l'exposer
// ne crée aucune faille qu'un navigateur n'offrirait pas déjà. Elle sert aux
// tests automatiques et au débogage.
window.__jeu = jeu;
// Accès depuis la console du navigateur pendant le développement, pour régler
// la physique sans repasser par les menus. Absent de la version construite.
if (import.meta.env.DEV) window.jeu = jeu;
jeu.demarre().catch((e) => {
  console.error(e);
  document.getElementById('chargement-texte').textContent =
    `Erreur au démarrage : ${e.message}`;
});
