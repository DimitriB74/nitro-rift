// Connexion à la base et modèle de joueur.
//
// Deux modes, volontairement :
//
//  - avec MONGODB_URI : MongoDB Atlas, tout est persistant ;
//  - sans MONGODB_URI : un magasin en mémoire qui expose la même interface.
//    Le jeu démarre alors immédiatement, sans compte à créer sur Atlas, ce qui
//    rend le développement local et les tests bien plus rapides. Les comptes
//    disparaissent au redémarrage, et le serveur le dit clairement.
//
// Render efface le disque à chaque déploiement : rien n'est jamais écrit sur
// le système de fichiers, toute la persistance passe par la base.

import mongoose from 'mongoose';
import { CREDITS_DEPART } from '../shared/economy.js';
import { VOITURE_DEPART, PEINTURE_DEPART, niveauxVides } from '../shared/cars.js';

/** Profil neuf, utilisé par les deux modes. */
export function profilNeuf(pseudo) {
  return {
    pseudo,
    credits: CREDITS_DEPART,
    voitures: [VOITURE_DEPART],
    ameliorations: { [VOITURE_DEPART]: niveauxVides() },
    peintures: [PEINTURE_DEPART],
    voitureActive: VOITURE_DEPART,
    peintureActive: PEINTURE_DEPART,
    medailles: {},
    records: {},
    defis: [],
    stats: { courses: 0, victoires: 0, podiums: 0, meilleurePlace: null },
    creeLe: new Date(),
    vuLe: new Date(),
  };
}

const schemaJoueur = new mongoose.Schema(
  {
    pseudo: { type: String, required: true, unique: true, index: true },
    pseudoMinuscule: { type: String, required: true, unique: true, index: true },
    motDePasseHash: { type: String, required: true },

    credits: { type: Number, default: CREDITS_DEPART },
    voitures: { type: [String], default: [VOITURE_DEPART] },

    // Structures libres : les clés sont des identifiants de voiture ou de
    // circuit, qui évoluent avec le contenu du jeu.
    ameliorations: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    peintures: { type: [String], default: [PEINTURE_DEPART] },
    voitureActive: { type: String, default: VOITURE_DEPART },
    peintureActive: { type: String, default: PEINTURE_DEPART },

    medailles: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    records: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    defis: { type: [String], default: [] },
    stats: { type: mongoose.Schema.Types.Mixed, default: () => ({ courses: 0, victoires: 0, podiums: 0, meilleurePlace: null }) },

    vuLe: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'creeLe', updatedAt: 'majLe' } },
);

export const Joueur = mongoose.models.Joueur ?? mongoose.model('Joueur', schemaJoueur);

// ---------------------------------------------------------------------------
//  Magasin en mémoire — même interface que le modèle Mongoose
// ---------------------------------------------------------------------------

const memoire = new Map(); // pseudoMinuscule → document

const magasinMemoire = {
  async findOne(filtre) {
    if (filtre.pseudoMinuscule) return memoire.get(filtre.pseudoMinuscule) ?? null;
    if (filtre._id) {
      for (const doc of memoire.values()) if (doc._id === filtre._id) return doc;
    }
    return null;
  },
  async create(donnees) {
    const doc = {
      _id: `mem_${memoire.size + 1}_${Date.now().toString(36)}`,
      ...profilNeuf(donnees.pseudo),
      ...donnees,
      async save() { return this; },
    };
    memoire.set(doc.pseudoMinuscule, doc);
    return doc;
  },
  async find() {
    return [...memoire.values()];
  },
  async countDocuments() {
    return memoire.size;
  },
};

// ---------------------------------------------------------------------------

let connectee = false;

export const baseConnectee = () => connectee;

/** Accès au stockage : Mongoose si connecté, sinon la mémoire. */
export const joueurs = () => (connectee ? Joueur : magasinMemoire);

/**
 * Se connecte à MongoDB si une URI est fournie.
 *
 * Un échec n'arrête jamais le serveur : on bascule en mémoire et on le
 * signale. Mieux vaut un jeu jouable sans sauvegarde qu'un service mort.
 */
export async function connecterBase(uri) {
  if (!uri) {
    console.log('  Base : aucune MONGODB_URI — mode mémoire (comptes non sauvegardés)');
    return false;
  }
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    connectee = true;
    const total = await Joueur.countDocuments();
    console.log(`  Base : MongoDB connectée (${total} compte${total > 1 ? 's' : ''})`);
    return true;
  } catch (erreur) {
    console.error(`  Base : connexion impossible (${erreur.message}) — repli en mémoire`);
    return false;
  }
}

/** Ce que le client a le droit de voir de son propre profil. */
export function profilPublic(doc) {
  return {
    pseudo: doc.pseudo,
    credits: doc.credits,
    voitures: doc.voitures,
    ameliorations: doc.ameliorations ?? {},
    peintures: doc.peintures,
    voitureActive: doc.voitureActive,
    peintureActive: doc.peintureActive,
    medailles: doc.medailles ?? {},
    // Les fantômes pèsent lourd : on n'envoie que le résumé des records ici.
    records: Object.fromEntries(
      Object.entries(doc.records ?? {}).map(([circuit, r]) => [
        circuit,
        { temps: r.temps, voiture: r.voiture, niveau: r.niveau },
      ]),
    ),
    defis: doc.defis ?? [],
    stats: doc.stats ?? { courses: 0, victoires: 0, podiums: 0, meilleurePlace: null },
  };
}

/** Mongoose n'observe pas les objets Mixed : il faut le prévenir à la main. */
export function marqueModifie(doc, ...chemins) {
  if (typeof doc.markModified !== 'function') return;
  for (const chemin of chemins) doc.markModified(chemin);
}
