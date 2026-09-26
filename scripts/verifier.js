// Vérification du jeu sans affichage.
//
// Le rendu 3D n'est pas nécessaire pour savoir si le jeu fonctionne : la
// physique, les bots et les circuits vivent dans /shared et tournent aussi bien
// dans Node. Ce script fait courir tous les bots sur tous les circuits et
// contrôle que les résultats tiennent debout.
//
//   node scripts/verifier.js

import { simuleBot, formateTemps } from './simulation.js';
import { circuit, ligneCourse, donneesCircuit, ORDRE } from '../server/circuits.js';
import { niveauxVides, VOITURES, IDS_VOITURES } from '../shared/cars.js';
import { IDS_NIVEAUX } from '../shared/bots.js';

let ok = 0;
let ko = 0;
const verifie = (libelle, condition, detail = '') => {
  if (condition) ok++; else ko++;
  console.log(`  ${condition ? 'OK   ' : 'ÉCHEC'} ${libelle}${detail ? '  — ' + detail : ''}`);
};

console.log('\n=== Tours simulés, par circuit et par niveau ===');
console.log('circuit    | niveau    | voiture | tour 1   | tour 2   | tour 3   |  v.max');

const temps = {};

for (const id of ORDRE) {
  const c = circuit(id);
  const ligne = ligneCourse(id);
  const donnees = donneesCircuit(id);
  temps[id] = {};

  for (const niveau of IDS_NIVEAUX) {
    const r = simuleBot(c, ligne, {
      voiture: donnees.voitureFavorite,
      niveaux: niveauxVides(),
      niveau,
      tours: 3,
      tempsMax: 400,
    });

    const tours = r.tempsTours ?? [];
    temps[id][niveau] = tours.length ? Math.min(...tours) : Infinity;

    console.log(
      id.padEnd(10), '|', niveau.padEnd(9), '|', String(donnees.voitureFavorite).padEnd(7), '|',
      ...[0, 1, 2].map((i) => (tours[i] !== undefined ? formateTemps(tours[i]) : '—').padEnd(8) + ' |'),
      (Math.round((r.vitesseMax ?? 0) * 3.6) + ' km/h').padStart(8),
    );

    verifie(`${id}/${niveau} : la course se termine`, r.termine === true);
  }
}

console.log('\n=== Cohérence ===');
for (const id of ORDRE) {
  verifie(`${id} : difficile plus rapide que moyen, moyen plus rapide que facile`,
    temps[id].difficile < temps[id].moyen && temps[id].moyen < temps[id].facile,
    `${formateTemps(temps[id].difficile)} < ${formateTemps(temps[id].moyen)} < ${formateTemps(temps[id].facile)}`);

  const meilleur = temps[id].difficile;
  verifie(`${id} : durée de tour dans la fourchette visée (40 à 75 s)`,
    meilleur > 40 && meilleur < 75, formateTemps(meilleur));
}

console.log('\n=== Chaque voiture boucle chaque circuit ===');
// Aux deux extrêmes : un bot moyen, qui roule en dessous des limites, et un bot
// difficile, qui s'en approche. C'est le second qui trouve les virages relevés
// où une voiture moins accrocheuse que la favorite du circuit part au décor.
for (const niveau of ['moyen', 'difficile']) {
  for (const idVoiture of IDS_VOITURES) {
    let toutes = true;
    const details = [];
    for (const id of ORDRE) {
      const r = simuleBot(circuit(id), ligneCourse(id, idVoiture), {
        voiture: idVoiture, niveaux: niveauxVides(), niveau, tours: 1, tempsMax: 200,
      });
      if (!r.termine) toutes = false;
      details.push(`${id} ${r.termine ? formateTemps(r.tempsTours[0]) : 'BLOQUÉ'}`);
    }
    verifie(`${VOITURES[idVoiture].nom} passe partout (bot ${niveau})`, toutes, details.join(' · '));
  }
}

console.log(`\n${ok}/${ok + ko} vérifications passées`);
if (ko > 0) process.exit(1);
