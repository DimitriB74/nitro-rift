// Chargement des circuits côté navigateur.
//
// Les fichiers JSON de /shared/tracks sont servis par Express sur /circuits :
// client et serveur lisent exactement les mêmes données.

import { construireCircuit, construireLigneCourse } from '@shared/track.js';
import { parametresVoiture } from '@shared/cars.js';
import { CHEMINS } from '@shared/config.js';

const circuits = new Map();
const lignes = new Map();
let catalogueCache = null;

/** Liste des circuits jouables, avec leurs métadonnées. */
export async function catalogue() {
  if (catalogueCache) return catalogueCache;
  const reponse = await fetch('/api/circuits');
  if (!reponse.ok) throw new Error('Impossible de récupérer la liste des circuits.');
  catalogueCache = await reponse.json();
  return catalogueCache;
}

/**
 * Charge et construit un circuit. La construction (échantillonnage du ruban,
 * courbures, ligne de course) prend quelques dizaines de millisecondes : on la
 * fait une fois et on garde le résultat.
 */
export async function chargeCircuit(id) {
  if (circuits.has(id)) return circuits.get(id);
  const reponse = await fetch(`${CHEMINS.circuits}${id}.json`);
  if (!reponse.ok) throw new Error(`Circuit « ${id} » introuvable.`);
  const donnees = await reponse.json();
  const circuit = construireCircuit(donnees);
  circuits.set(id, circuit);
  return circuit;
}

/**
 * Ligne de course d'un circuit, pour une voiture donnée.
 *
 * Les vitesses cibles dépendent de l'adhérence et de la maniabilité de la
 * voiture : une ligne calculée pour la voiture favorite envoie les autres au
 * décor dans les virages relevés rapides. On en garde donc une par voiture.
 */
export function ligneCourse(circuit, voiture = null) {
  const choisie = voiture ?? circuit.voitureFavorite;
  const cle = `${circuit.id}:${choisie}`;
  if (!lignes.has(cle)) {
    lignes.set(cle, construireLigneCourse(circuit, parametresVoiture(choisie)));
  }
  return lignes.get(cle);
}

/** Charge circuit et ligne de course en une fois. */
export async function prepare(id) {
  const circuit = await chargeCircuit(id);
  return {
    circuit,
    ligne: ligneCourse(circuit),
    /** Ligne adaptée à une voiture précise, pour les pilotes automatiques. */
    lignePour: (voiture) => ligneCourse(circuit, voiture),
  };
}
