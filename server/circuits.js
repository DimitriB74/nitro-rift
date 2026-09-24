// Chargement des circuits côté Node (serveur et scripts).
//
// Le client, lui, récupère les mêmes fichiers par HTTP sur /circuits/<id>.json :
// il n'y a qu'une seule source de vérité, les JSON de /shared/tracks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construireCircuit, construireLigneCourse } from '../shared/track.js';
import { parametresVoiture } from '../shared/cars.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const DOSSIER_CIRCUITS = path.join(ICI, '..', 'shared', 'tracks');

/** Ordre d'affichage dans les menus. Le circuit d'essai reste à part. */
export const ORDRE = ['canyon', 'ville', 'stade', 'montagne'];

const cache = new Map();
const lignes = new Map();

export function listeFichiers() {
  return fs.readdirSync(DOSSIER_CIRCUITS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

export function donneesCircuit(id) {
  const chemin = path.join(DOSSIER_CIRCUITS, `${id}.json`);
  if (!fs.existsSync(chemin)) throw new Error(`Circuit inconnu : ${id}`);
  return JSON.parse(fs.readFileSync(chemin, 'utf8'));
}

/** Circuit construit, mis en cache : la construction coûte cher. */
export function circuit(id) {
  if (!cache.has(id)) cache.set(id, construireCircuit(donneesCircuit(id)));
  return cache.get(id);
}

/**
 * Ligne de course du circuit, calculée avec la voiture favorite au niveau 0.
 * Elle est partagée par tous les bots, chaque difficulté n'en exploitant qu'une
 * fraction.
 */
export function ligneCourse(id) {
  if (!lignes.has(id)) {
    const c = circuit(id);
    lignes.set(id, construireLigneCourse(c, parametresVoiture(c.voitureFavorite)));
  }
  return lignes.get(id);
}

/** Métadonnées légères, pour les menus et les classements. */
export function catalogue() {
  return ORDRE.filter((id) => fs.existsSync(path.join(DOSSIER_CIRCUITS, `${id}.json`)))
    .map((id) => {
      const c = circuit(id);
      return {
        id: c.id,
        nom: c.nom,
        decor: c.decor,
        description: c.description,
        tours: c.tours,
        voitureFavorite: c.voitureFavorite,
        longueur: Math.round(c.longueur),
        medailles: c.medailles
      };
    });
}

export function videCache() {
  cache.clear();
  lignes.clear();
}
