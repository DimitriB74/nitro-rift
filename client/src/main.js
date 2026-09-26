// Point d'entrée du client NITRO RIFT.
//
// Gère les écrans, la boucle de jeu et l'enchaînement des courses.

import * as THREE from 'three';

import { GAME_NAME, PHYS, QUALITES, LIBELLES_TOUCHES, CAMERA, COURSE } from '@shared/config.js';
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
    montre('ecran-menu');
    this.boucle(performance.now());
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
    montre('ecran-course');
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
          this.hud.message(
            ev.palier === 3 ? 'Dérapage parfait !' : 'Dérapage !',
            'style', 1.2, this.horloge
          );
          break;
        case 'atterrissage':
          this.cameraPoursuite.secoue(Math.min(1, ev.force));
          break;
        case 'looping':
          this.hud.message('Looping !', 'style', 1.2, this.horloge);
          break;
        case 'checkpoint':
          this.noteIntermediaire(ev);
          break;
        case 'tour':
          this.noteTour(ev);
          break;
        case 'reapparition':
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
    montre('ecran-resultats');
  }

  quitteCourse() {
    this.course = null;
    montre('ecran-menu');
  }
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

function construitInterface(jeu) {
  // --- Menu principal ------------------------------------------------------
  document.getElementById('note-menu').textContent =
    'Étapes 1 à 5 : conduite, physique 3D, checkpoints, bots et course solo complète.';

  brancheActions(document, {
    'grand-prix': () => ouvreConfig(jeu, 'course'),
    'contre-la-montre': () => ouvreConfig(jeu, 'contre-la-montre'),
    'parametres': () => { construitParametres(jeu); montre('ecran-parametres'); },
    'retour-menu': () => { jeu.course = null; montre('ecran-menu'); },
    'lancer': () => jeu.lanceCourse(),
    'reprendre': () => jeu.basculePause(),
    'recommencer': () => jeu.lanceCourse(),
    'quitter-course': () => jeu.quitteCourse(),
    'rejouer': () => jeu.lanceCourse(),
    'touches-defaut': () => { reinitialiseTouches(); construitParametres(jeu); }
  });
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

  // Le détail des gains est calculé par le serveur à l'étape 10.
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
    '<p class="note">Les crédits, médailles et défis arriveront à l’étape 10, ' +
    'calculés par le serveur.</p>';
}

/** Ordinal français : 1re, 2e, 3e... */
const ordinal = (n) => `${n}<sup>${n === 1 ? 're' : 'e'}</sup>`;

const ligneStat = (libelle, valeur) =>
  `<div class="ligne-gain"><span>${libelle}</span><span>${valeur}</span></div>`;

// ---------------------------------------------------------------------------
const jeu = new Jeu();
// Accès depuis la console du navigateur pendant le développement, pour régler
// la physique sans repasser par les menus. Absent de la version construite.
if (import.meta.env.DEV) window.jeu = jeu;
jeu.demarre().catch((e) => {
  console.error(e);
  document.getElementById('chargement-texte').textContent =
    `Erreur au démarrage : ${e.message}`;
});
