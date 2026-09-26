// Comptes : inscription, connexion, jetons.
//
// Choix assumés :
//  - bcryptjs (JavaScript pur) plutôt que bcrypt natif : `npm install` marche
//    partout, sans compilateur, ce qui compte sur l'offre gratuite de Render ;
//  - jeton JWT valable 7 jours, stocké côté client, et réutilisé tel quel pour
//    authentifier la connexion Socket.io — un seul mécanisme pour les deux ;
//  - limitation des tentatives par pseudo ET par adresse IP, en mémoire : sans
//    cela, un mot de passe court tombe en quelques minutes.

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { joueurs, profilNeuf, profilPublic } from './db.js';

const DUREE_JETON = '7d';
const COUT_BCRYPT = 10; // ~60 ms : assez lent pour l'attaque, invisible au joueur

const PSEUDO_MIN = 3;
const PSEUDO_MAX = 16;
const MDP_MIN = 6;

/** Lettres, chiffres, tiret et souligné. Pas d'espace : on évite les confusions. */
const PSEUDO_VALIDE = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
//  Limitation des tentatives
// ---------------------------------------------------------------------------

const FENETRE = 10 * 60 * 1000; // 10 minutes
const MAX_ESSAIS = 8;
const tentatives = new Map(); // clé → { compte, depuis }

function trop(cle) {
  const entree = tentatives.get(cle);
  if (!entree) return false;
  if (Date.now() - entree.depuis > FENETRE) {
    tentatives.delete(cle);
    return false;
  }
  return entree.compte >= MAX_ESSAIS;
}

function echec(cle) {
  const entree = tentatives.get(cle);
  if (!entree || Date.now() - entree.depuis > FENETRE) {
    tentatives.set(cle, { compte: 1, depuis: Date.now() });
    return;
  }
  entree.compte++;
}

const succes = (cle) => tentatives.delete(cle);

// Purge périodique : sans elle, la table grossit indéfiniment.
setInterval(() => {
  const maintenant = Date.now();
  for (const [cle, entree] of tentatives) {
    if (maintenant - entree.depuis > FENETRE) tentatives.delete(cle);
  }
}, FENETRE).unref?.();

// ---------------------------------------------------------------------------
//  Jetons
// ---------------------------------------------------------------------------

const secret = () => process.env.JWT_SECRET || 'nitro-rift-secret-de-developpement';

export function signeJeton(doc) {
  return jwt.sign({ id: String(doc._id), pseudo: doc.pseudo }, secret(), { expiresIn: DUREE_JETON });
}

export function verifieJeton(jeton) {
  try {
    return jwt.verify(jeton, secret());
  } catch {
    return null;
  }
}

/** Retrouve le document du joueur depuis un jeton. */
export async function joueurDepuisJeton(jeton) {
  const charge = verifieJeton(jeton);
  if (!charge) return null;
  const doc = await joueurs().findOne({ _id: charge.id });
  return doc ?? null;
}

/** Middleware Express : exige un jeton valide et pose `req.joueur`. */
export async function exigeAuth(req, res, next) {
  const entete = req.headers.authorization ?? '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  if (!jeton) return res.status(401).json({ erreur: 'Jeton manquant' });

  const doc = await joueurDepuisJeton(jeton);
  if (!doc) return res.status(401).json({ erreur: 'Session expirée, reconnecte-toi' });

  req.joueur = doc;
  next();
}

// ---------------------------------------------------------------------------
//  Validation
// ---------------------------------------------------------------------------

function verifieIdentifiants(pseudo, motDePasse) {
  if (typeof pseudo !== 'string' || typeof motDePasse !== 'string') return 'Champs manquants';
  const p = pseudo.trim();
  if (p.length < PSEUDO_MIN || p.length > PSEUDO_MAX) {
    return `Le pseudo doit faire entre ${PSEUDO_MIN} et ${PSEUDO_MAX} caractères`;
  }
  if (!PSEUDO_VALIDE.test(p)) return 'Le pseudo ne peut contenir que lettres, chiffres, - et _';
  if (motDePasse.length < MDP_MIN) return `Le mot de passe doit faire au moins ${MDP_MIN} caractères`;
  return null;
}

// ---------------------------------------------------------------------------
//  Routes
// ---------------------------------------------------------------------------

export function brancheAuth(app) {
  app.post('/api/inscription', async (req, res) => {
    const { pseudo = '', motDePasse = '' } = req.body ?? {};
    const probleme = verifieIdentifiants(pseudo, motDePasse);
    if (probleme) return res.status(400).json({ erreur: probleme });

    const propre = pseudo.trim();
    const minuscule = propre.toLowerCase();

    const existant = await joueurs().findOne({ pseudoMinuscule: minuscule });
    if (existant) return res.status(409).json({ erreur: 'Ce pseudo est déjà pris' });

    const hash = await bcrypt.hash(motDePasse, COUT_BCRYPT);
    const doc = await joueurs().create({
      ...profilNeuf(propre),
      pseudo: propre,
      pseudoMinuscule: minuscule,
      motDePasseHash: hash,
    });

    res.json({ jeton: signeJeton(doc), profil: profilPublic(doc) });
  });

  app.post('/api/connexion', async (req, res) => {
    const { pseudo = '', motDePasse = '' } = req.body ?? {};
    if (typeof pseudo !== 'string' || typeof motDePasse !== 'string') {
      return res.status(400).json({ erreur: 'Champs manquants' });
    }

    const minuscule = pseudo.trim().toLowerCase();
    const ip = req.ip ?? 'inconnue';
    const cles = [`p:${minuscule}`, `ip:${ip}`];

    if (cles.some(trop)) {
      return res.status(429).json({ erreur: 'Trop de tentatives. Réessaie dans 10 minutes.' });
    }

    const doc = await joueurs().findOne({ pseudoMinuscule: minuscule });
    // Même message pour un pseudo inconnu et un mot de passe faux : on ne dit
    // pas à un attaquant quels comptes existent.
    const messageGenerique = { erreur: 'Pseudo ou mot de passe incorrect' };
    if (!doc) {
      cles.forEach(echec);
      return res.status(401).json(messageGenerique);
    }

    const bon = await bcrypt.compare(motDePasse, doc.motDePasseHash);
    if (!bon) {
      cles.forEach(echec);
      return res.status(401).json(messageGenerique);
    }

    cles.forEach(succes);
    doc.vuLe = new Date();
    await doc.save();

    res.json({ jeton: signeJeton(doc), profil: profilPublic(doc) });
  });

  // Reprise de session au chargement de la page.
  app.get('/api/profil', exigeAuth, (req, res) => {
    res.json({ profil: profilPublic(req.joueur) });
  });
}
