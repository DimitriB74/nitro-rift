// Salons privés.
//
// Pas de matchmaking : on crée un salon, on donne son code à quatre caractères
// à ses amis, ils le tapent. Les salons vivent uniquement en mémoire — Render
// efface le disque, et un salon n'a aucune raison de survivre au redémarrage.
//
// Ce module ne connaît rien au réseau : il manipule des structures. C'est le
// module socket qui les diffuse. Ça le rend testable sans serveur.

import { RESEAU, COURSE } from '../shared/config.js';
import { VOITURE_DEPART, PEINTURE_DEPART, niveauxVides } from '../shared/cars.js';
import { IDS_NIVEAUX, tirePseudos, choisitVoiture, ameliorationsBot } from '../shared/bots.js';
import { STATS } from '../shared/cars.js';
import { grandPrixPublic } from '../shared/grandprix.js';

export const salons = new Map(); // code → salon

/** Code à quatre caractères, sans I, O, 0 ni 1 : on les dicte au téléphone. */
function nouveauCode() {
  const alphabet = RESEAU.alphabetCode;
  for (let essai = 0; essai < 200; essai++) {
    let code = '';
    for (let i = 0; i < RESEAU.longueurCode; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!salons.has(code)) return code;
  }
  // Après 200 échecs, l'espace est saturé : mieux vaut le dire que boucler.
  throw new Error('Plus de code de salon disponible');
}

let compteurBot = 0;

/**
 * Un pseudo de bot non déjà utilisé dans ce salon.
 *
 * tirePseudos tire au hasard dans une liste : deux appels peuvent rendre le
 * même nom. On tire donc un lot et on garde le premier libre, plutôt que de
 * risquer deux « Mémé Nitro » sur la grille.
 */
function pseudoLibre(salon) {
  const pris = new Set([...salon.humains.values(), ...salon.bots].map((p) => p.pseudo));
  for (const candidat of tirePseudos(24)) {
    if (!pris.has(candidat)) return candidat;
  }
  return `Bot ${salon.bots.length + 1}`;
}

/**
 * Niveau d'amélioration moyen des humains du salon, toutes stats confondues.
 * C'est la référence qui cale la difficulté des bots sur la progression des
 * joueurs : des débutants n'affrontent pas des voitures améliorées au maximum.
 */
function moyenneAmeliorations(salon) {
  const humains = [...salon.humains.values()];
  if (humains.length === 0) return 0;

  let total = 0;
  let compte = 0;
  for (const humain of humains) {
    for (const stat of STATS) {
      total += humain.niveaux?.[stat] ?? 0;
      compte++;
    }
  }
  return compte > 0 ? total / compte : 0;
}

export function creerSalon(hote) {
  const code = nouveauCode();
  const salon = {
    code,
    hoteId: hote.id,
    mode: 'course', // 'course' | 'grand-prix' | 'contre-la-montre'
    circuit: COURSE.grandPrix[0],
    tours: COURSE.toursParDefaut,
    /** Durée d'une session de contre-la-montre, en secondes. */
    duree: COURSE.dureeContreLaMontre,
    phase: 'attente', // 'attente' | 'course'
    humains: new Map(), // socketId → participant
    bots: [],
    // Joueurs partis en cours de course mais ayant déjà franchi l'arrivée :
    // on garde leur résultat pour le classement final. Sans cela, quelqu'un qui
    // ferme son navigateur juste après avoir fini disparaîtrait du podium.
    partis: [],
    course: null,
    grandPrix: null,
    creeLe: Date.now(),
  };
  salons.set(code, salon);
  ajouteHumain(salon, hote);
  return salon;
}

export function ajouteHumain(salon, joueur) {
  salon.humains.set(joueur.id, {
    id: joueur.id,
    pseudo: joueur.pseudo,
    compteId: joueur.compteId ?? null,
    voiture: joueur.voiture ?? VOITURE_DEPART,
    peinture: joueur.peinture ?? PEINTURE_DEPART,
    niveaux: joueur.niveaux ?? niveauxVides(),
    pret: false,
    bot: false,
    // Rempli quand la course tourne.
    etat: null,
    resultat: null,
  });
  return salon.humains.get(joueur.id);
}

export const totalParticipants = (salon) => salon.humains.size + salon.bots.length;

export const estHote = (salon, socketId) => salon.hoteId === socketId;

/** Ajoute un bot. Rend un message d'erreur, ou null si tout va bien. */
export function ajouteBot(salon, niveau) {
  if (!IDS_NIVEAUX.includes(niveau)) return 'Niveau de bot inconnu';
  if (totalParticipants(salon) >= COURSE.participantsMax) {
    return `Un salon accueille ${COURSE.participantsMax} participants au maximum`;
  }

  const pseudo = pseudoLibre(salon);

  salon.bots.push({
    id: `bot:${++compteurBot}`,
    pseudo,
    niveau,
    bot: true,
    voiture: null,   // choisie au lancement, selon le circuit
    niveaux: null,   // alignée sur les humains au lancement
    pret: true,
    etat: null,
    resultat: null,
  });
  return null;
}

export function retireBot(salon, id) {
  const avant = salon.bots.length;
  salon.bots = salon.bots.filter((b) => b.id !== id);
  return salon.bots.length !== avant;
}

/**
 * Retire un joueur. Rend ce qu'il faut faire ensuite :
 *  - salonVide : plus personne, le salon doit disparaître ;
 *  - nouvelHote : l'hôte est parti, voici son remplaçant ;
 *  - remplaceParBot : la course tournait, un bot reprend sa voiture.
 */
export function retireHumain(salon, socketId) {
  const participant = salon.humains.get(socketId);
  if (!participant) return { inconnu: true };

  const resultat = { salonVide: false, nouvelHote: null, remplaceParBot: null };

  // Déjà arrivé : son temps compte, on le conserve jusqu'à la fin de la course.
  if (salon.phase === 'course' && participant.resultat) {
    salon.partis.push({ ...participant, deconnecte: true });
  }

  // En pleine course, on ne laisse pas un trou sur la piste : un bot de niveau
  // moyen reprend la voiture, avec les mêmes améliorations. Le joueur parti ne
  // touchera aucun crédit, c'est vérifié au moment des gains.
  if (salon.phase === 'course' && salon.course && !participant.resultat) {
    const remplacant = {
      id: `bot:deco:${socketId}`,
      pseudo: `${participant.pseudo} (bot)`,
      niveau: 'moyen',
      bot: true,
      remplacement: true,
      voiture: participant.voiture,
      niveaux: participant.niveaux,
      pret: true,
      etat: participant.etat,
      resultat: null,
    };
    salon.bots.push(remplacant);
    resultat.remplaceParBot = remplacant;
  }

  salon.humains.delete(socketId);

  if (salon.humains.size === 0) {
    resultat.salonVide = true;
    return resultat;
  }

  if (salon.hoteId === socketId) {
    // Le plus ancien encore présent reprend la main.
    const [suivant] = salon.humains.values();
    salon.hoteId = suivant.id;
    resultat.nouvelHote = suivant;
  }

  return resultat;
}

export function supprimeSalon(code) {
  salons.delete(code);
}

/** Tout le monde est prêt ? L'hôte compte aussi. */
export function tousPrets(salon) {
  if (salon.humains.size === 0) return false;
  for (const h of salon.humains.values()) if (!h.pret) return false;
  return true;
}

/**
 * Prépare les bots juste avant le départ : voiture selon le circuit, et
 * améliorations calées sur le niveau moyen des humains présents, pour que la
 * difficulté suive la progression des joueurs.
 */
export function prepareBots(salon, circuit) {
  salon.partis = [];
  const moyenne = moyenneAmeliorations(salon);

  for (const bot of salon.bots) {
    // Un bot qui remplace un déconnecté garde SA voiture et SES améliorations :
    // la course ne doit pas changer de nature en cours de route.
    if (!bot.voiture) bot.voiture = choisitVoiture(circuit, bot.niveau);
    if (!bot.niveaux) bot.niveaux = ameliorationsBot(moyenne, bot.niveau);
    bot.resultat = null;
    bot.etat = null;
  }
}

/** Vue envoyée aux clients : rien de plus que ce qu'ils doivent afficher. */
export function salonPublic(salon) {
  const participant = (p) => ({
    id: p.id,
    pseudo: p.pseudo,
    voiture: p.voiture,
    peinture: p.peinture ?? null,
    pret: p.pret,
    bot: !!p.bot,
    niveau: p.niveau ?? null,
    hote: p.id === salon.hoteId,
  });

  return {
    code: salon.code,
    mode: salon.mode,
    circuit: salon.circuit,
    tours: salon.tours,
    duree: salon.duree,
    phase: salon.phase,
    hoteId: salon.hoteId,
    max: COURSE.participantsMax,
    participants: [...salon.humains.values()].map(participant).concat(salon.bots.map(participant)),
    grandPrix: grandPrixPublic(salon.grandPrix),
  };
}

/** Salons vides ou oubliés : on nettoie, sinon la mémoire monte doucement. */
export function nettoieSalons(ageMaxMs = 6 * 60 * 60 * 1000) {
  const maintenant = Date.now();
  for (const [code, salon] of salons) {
    if (salon.humains.size === 0 || maintenant - salon.creeLe > ageMaxMs) {
      salons.delete(code);
    }
  }
}
