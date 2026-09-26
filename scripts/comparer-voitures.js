// Compare les quatre voitures sur les quatre circuits.
//
// Sert à vérifier que les voitures sont vraiment différentes : si elles font
// toutes le même temps partout, c'est que les circuits ne récompensent aucun
// profil en particulier, et le garage ne sert à rien.
//
// Le pilote est toujours le même bot difficile, avec la même graine : seul le
// choix de la voiture change d'une ligne à l'autre.

import { meilleurTour } from './simulation.js';
import { circuit as chargeCircuit, ligneCourse, ORDRE } from '../server/circuits.js';
import { IDS_VOITURES, VOITURES, NIVEAU_MAX, niveauxVides } from '../shared/cars.js';

const GRAINES = [3, 11, 29, 53];

const chrono = (t) => (Number.isFinite(t)
  ? `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`
  : '   —    ');

/** Meilleur tour lancé, en gardant la meilleure des graines. */
function meilleurSurCircuit(circuit, ligne, voiture, niveaux) {
  let meilleur = Infinity;
  for (const graine of GRAINES) {
    const r = meilleurTour(circuit, ligne, { voiture, niveaux, niveau: 'difficile', graine, tempsMax: 400 });
    if (Number.isFinite(r.meilleur)) meilleur = Math.min(meilleur, r.meilleur);
  }
  return Number.isFinite(meilleur) ? meilleur : null;
}

const niveauxMax = Object.fromEntries(Object.keys(niveauxVides()).map((s) => [s, NIVEAU_MAX]));
const ameliorees = process.argv.includes('--ameliorees');
const niveaux = ameliorees ? niveauxMax : {};

console.log(`\nMeilleur tour lancé par voiture — bot difficile, ${ameliorees ? 'voitures au maximum' : 'voitures de série'}`);
console.log(`Meilleure de ${GRAINES.length} graines par case.\n`);

const entete = ['Circuit'.padEnd(22), ...IDS_VOITURES.map((id) => VOITURES[id].nom.padEnd(10))].join(' ');
console.log(entete);
console.log('-'.repeat(entete.length));

const tout = [];

for (const id of ORDRE) {
  const circuit = chargeCircuit(id);
  const ligne = ligneCourse(id);
  const temps = IDS_VOITURES.map((v) => meilleurSurCircuit(circuit, ligne, v, niveaux));

  const valides = temps.filter(Number.isFinite);
  const min = Math.min(...valides);
  const max = Math.max(...valides);
  tout.push({ id, nom: circuit.nom, temps, ecart: max - min, favorite: circuit.voitureFavorite });

  const cases = temps.map((t) => {
    const texte = chrono(t);
    return (t === min ? `*${texte}` : ` ${texte}`).padEnd(11);
  });
  console.log(`${circuit.nom.padEnd(22)} ${cases.join('')}`);
}

console.log('\n(* la plus rapide du circuit)\n');
console.log('Écart entre la meilleure et la pire voiture :');
for (const t of tout) {
  const rapide = IDS_VOITURES[t.temps.indexOf(Math.min(...t.temps.filter(Number.isFinite)))];
  const accord = rapide === t.favorite ? 'conforme' : `attendue : ${VOITURES[t.favorite].nom}`;
  console.log(`  ${t.nom.padEnd(22)} ${t.ecart.toFixed(2).padStart(6)} s  ` +
    `— la plus rapide est la ${VOITURES[rapide].nom} (${accord})`);
}

const faibles = tout.filter((t) => t.ecart < 1.0);
if (faibles.length > 0) {
  console.log('\nCircuits où les voitures se valent (moins d’une seconde d’écart) :');
  for (const t of faibles) console.log(`  ${t.nom} — ${t.ecart.toFixed(2)} s`);
  console.log('Sur ces circuits, le choix de la voiture ne change presque rien.');
} else {
  console.log('\nChaque circuit sépare nettement les voitures.');
}
