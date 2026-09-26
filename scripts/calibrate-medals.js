// Calibration des temps de médaille.
//
//   npm run calibrate
//
// Le temps platine est celui qu'un bot difficile réalise avec la voiture
// favorite du circuit **sans aucune amélioration** : un objectif exigeant mais
// atteignable avec une voiture de base. Or, argent et bronze en découlent
// (+5 %, +12 %, +20 %).
//
// Les temps sont écrits dans le champ « medailles » de chaque circuit, que le
// serveur relit ensuite. Le client ne les fournit jamais : il pourrait mentir.

import fs from 'node:fs';
import path from 'node:path';

import { meilleurTour, formateTemps } from './simulation.js';
import { circuit, ligneCourse, donneesCircuit, DOSSIER_CIRCUITS, ORDRE, videCache } from '../server/circuits.js';
import { niveauxVides } from '../shared/cars.js';
import { ciblesDepuisPlatine, ORDRE_MEDAILLES } from '../shared/economy.js';

// Plusieurs graines : un bot peut rater un virage sur une tentative, et le
// temps platine de tout le monde en dépendrait. On garde le meilleur.
const GRAINES = [3, 11, 29, 53];

const ecrire = !process.argv.includes('--essai');

console.log('Calibration des médailles — bot difficile, voiture favorite, sans amélioration\n');
console.log('circuit    | voiture  | platine  | or       | argent   | bronze');

for (const id of ORDRE) {
  const c = circuit(id);
  const ligne = ligneCourse(id);

  let meilleur = Infinity;
  for (const graine of GRAINES) {
    const r = meilleurTour(c, ligne, {
      voiture: c.voitureFavorite,
      niveaux: niveauxVides(),
      niveau: 'difficile',
      graine,
      tempsMax: 400,
    });
    if (r.meilleur && r.meilleur < meilleur) meilleur = r.meilleur;
  }

  if (!Number.isFinite(meilleur)) {
    console.log(`${id.padEnd(10)} | ÉCHEC : aucun tour bouclé`);
    continue;
  }

  const cibles = ciblesDepuisPlatine(meilleur);
  // ORDRE_MEDAILLES va du bronze au platine ; on affiche dans l'autre sens,
  // du plus dur au plus facile, comme dans l'en-tête.
  const colonnes = [...ORDRE_MEDAILLES].reverse()
    .map((m) => formateTemps(cibles[m]).padEnd(8))
    .join(' | ');
  console.log(`${id.padEnd(10)} | ${String(c.voitureFavorite).padEnd(8)} | ${colonnes}`);

  if (!ecrire) continue;

  const fichier = path.join(DOSSIER_CIRCUITS, `${id}.json`);
  const donnees = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  donnees.medailles = cibles;
  // Indentation à deux espaces et saut de ligne final : les fichiers restent
  // lisibles et les diffs git propres.
  fs.writeFileSync(fichier, `${JSON.stringify(donnees, null, 2)}\n`, 'utf8');
}

videCache();
console.log(ecrire
  ? '\nTemps écrits dans shared/tracks/*.json'
  : '\nEssai à blanc : rien n’a été écrit (retire --essai pour enregistrer)');
