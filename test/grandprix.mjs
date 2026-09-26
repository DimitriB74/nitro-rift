// Vérifications du Grand Prix : d'abord le module partagé (barème, égalités,
// arrivée en cours de championnat), puis un championnat multijoueur complet
// joué par deux vrais clients Socket.io contre le serveur.
//
// Les quatre manches sont écourtées : chaque joueur annonce une arrivée
// plausible dès le départ, ce qui termine la course immédiatement puisque
// personne d'autre n'est en piste. On teste le comptage des points, pas la
// conduite — la physique est vérifiée ailleurs.

import { spawn } from 'node:child_process';
import { io as connecte } from 'socket.io-client';
import { fileURLToPath } from 'node:url';

import {
  ajouteParticipants, circuitCourant, classementGeneral, creerGrandPrix,
  enregistreCourse, grandPrixPublic, grandPrixTermine, pointsPourPosition,
  retireParticipant,
} from '../shared/grandprix.js';
import { COURSE } from '../shared/config.js';

let ok = 0, ko = 0;
const check = (l, c, d = '') => { c ? ok++ : ko++; console.log(`  ${c ? 'OK   ' : 'ÉCHEC'} ${l}${d ? '  — ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
console.log('=== Module partagé ===');

check('barème 10-8-6-5-4-3-2-1',
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map(pointsPourPosition).join(',') === '10,8,6,5,4,3,2,1,0');

const trio = [{ id: 'a', nom: 'A', humain: true }, { id: 'b', nom: 'B' }, { id: 'c', nom: 'C' }];
const gp = creerGrandPrix(['canyon', 'ville', 'stade', 'montagne'], trio);
check('quatre manches annoncées', gp.circuits.length === 4 && circuitCourant(gp) === 'canyon');

enregistreCourse(gp, [{ id: 'a', position: 1, meilleurTour: 50 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }]);
check('points de la première manche',
  classementGeneral(gp).map((l) => `${l.nom}:${l.points}`).join(' ') === 'A:10 B:8 C:6',
  classementGeneral(gp).map((l) => `${l.nom}:${l.points}`).join(' '));
check('la manche suivante est annoncée', circuitCourant(gp) === 'ville' && !grandPrixTermine(gp));

// B gagne la deuxième : égalité à 18 points, c'est la dernière course qui tranche.
enregistreCourse(gp, [{ id: 'b', position: 1 }, { id: 'a', position: 2 }, { id: 'c', position: 3 }]);
const apresDeux = classementGeneral(gp);
check('égalité départagée par la dernière course',
  apresDeux[0].nom === 'B' && apresDeux[0].points === 18 && apresDeux[1].nom === 'A',
  apresDeux.map((l) => `${l.place}.${l.nom} ${l.points}`).join(' '));

// Un absent d'une manche garde ses points mais n'en gagne pas.
enregistreCourse(gp, [{ id: 'a', position: 1 }, { id: 'b', position: 2 }]);
const sansC = classementGeneral(gp).find((l) => l.nom === 'C');
check('un absent ne marque rien et reste classé',
  sansC.points === 12 && sansC.positions[2] === null, `C : ${sansC.points} pts`);

check('inscription tardive à zéro point',
  ajouteParticipants(gp, [{ id: 'd', nom: 'D' }, { id: 'a', nom: 'A' }]) === 1 &&
  classementGeneral(gp).find((l) => l.nom === 'D').points === 0);

check('retrait d’un participant', retireParticipant(gp, 'd') && !gp.lignes.some((l) => l.id === 'd'));

enregistreCourse(gp, [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }]);
check('championnat terminé après la dernière manche',
  grandPrixTermine(gp) && circuitCourant(gp) === null);

const vue = grandPrixPublic(gp);
check('vue publique complète',
  vue.manche === 4 && vue.manches === 4 && vue.termine === true &&
  vue.classement.length === 3 && vue.classement[0].positions.length === 4,
  `${vue.classement.map((l) => `${l.place}.${l.nom} ${l.points}`).join(' ')}`);

check('l’ordre des circuits vient de la configuration',
  COURSE.grandPrix.length === 4 && COURSE.points.length === 8);

// ---------------------------------------------------------------------------
console.log('\n=== Championnat multijoueur ===');

const PORT = 3312;
const ADRESSE = `http://127.0.0.1:${PORT}`;
const serveur = spawn('node', ['server/index.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(PORT), JWT_SECRET: 't' },
});
serveur.stderr.on('data', (d) => process.stderr.write(`  [serveur] ${d}`));

const attend = (s, ev, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
  s.once(ev, (d) => { clearTimeout(t); res(d); });
});

await wait(9000); // le serveur calcule les références de temps au démarrage

const A = connecte(ADRESSE, { auth: { pseudo: 'Dimitri' } });
const B = connecte(ADRESSE, { auth: { pseudo: 'Ami' } });
await Promise.all([attend(A, 'bienvenue'), attend(B, 'bienvenue')]);

const cree = await new Promise((r) => A.emit('salon:creer', {}, r));
const code = cree.salon.code;
await new Promise((r) => B.emit('salon:rejoindre', { code }, r));

// On laisse retomber les diffusions déclenchées par l'arrivée de B, sinon on
// lirait un état antérieur au réglage qu'on vient d'envoyer.
await wait(400);
let maj = await new Promise((r) => { B.once('salon:maj', r); A.emit('salon:reglages', { mode: 'grand-prix', tours: 1 }); });
check('le mode Grand Prix impose le premier circuit',
  maj.mode === 'grand-prix' && maj.circuit === COURSE.grandPrix[0], `${maj.mode}, ${maj.circuit}`);

// En Grand Prix, même l'hôte ne choisit pas le circuit.
await wait(300);
maj = await new Promise((r) => { B.once('salon:maj', r); A.emit('salon:reglages', { circuit: 'stade' }); });
check('le circuit n’est pas modifiable en Grand Prix', maj.circuit === COURSE.grandPrix[0], maj.circuit);

/** Joue une manche : les deux clients annoncent une arrivée plausible. */
async function joueManche(gagnant) {
  A.emit('salon:pret', { pret: true });
  B.emit('salon:pret', { pret: true });
  await wait(250);

  const depart = attend(A, 'course:demarrer', 8000);
  const resultats = attend(A, 'course:resultats', 45000);
  A.emit('salon:lancer');
  const d = await depart;

  // On attend le feu vert : une arrivée annoncée avant le départ serait absurde.
  await wait(Math.max(0, d.heureDepart - Date.now()) + 200);

  const tA = gagnant === 'A' ? 90 : 95;
  const tB = gagnant === 'A' ? 95 : 90;
  const rA = await new Promise((r) => A.emit('course:arrivee', { tempsTotal: tA, tempsTours: [tA] }, r));
  const rB = await new Promise((r) => B.emit('course:arrivee', { tempsTotal: tB, tempsTours: [tB] }, r));
  if (!rA.accepte || !rB.accepte) throw new Error(`arrivée refusée : ${rA.raison ?? ''} ${rB.raison ?? ''}`);

  return { depart: d, resultats: await resultats };
}

const m1 = await joueManche('A');
check('manche 1 courue sur le premier circuit', m1.depart.circuit === COURSE.grandPrix[0], m1.depart.circuit);
check('le championnat est joint aux résultats',
  !!m1.resultats.grandPrix && m1.resultats.grandPrix.mancheCourue === 1 &&
  m1.resultats.grandPrix.manche === 2,
  `manche courue ${m1.resultats.grandPrix?.mancheCourue}, prochaine ${m1.resultats.grandPrix?.manche}`);
check('le vainqueur de la manche prend 10 points',
  m1.resultats.grandPrix.classement[0].nom === 'Dimitri' &&
  m1.resultats.grandPrix.classement[0].points === 10,
  m1.resultats.grandPrix.classement.map((l) => `${l.nom} ${l.points}`).join(' · '));
check('le salon passe au circuit de la manche 2',
  m1.resultats.salon.circuit === COURSE.grandPrix[1] && m1.resultats.grandPrix.prochain === COURSE.grandPrix[1],
  m1.resultats.salon.circuit);

const m2 = await joueManche('B');
check('manche 2 courue sur le deuxième circuit', m2.depart.circuit === COURSE.grandPrix[1], m2.depart.circuit);
check('égalité en tête départagée par la dernière manche',
  m2.resultats.grandPrix.classement[0].nom === 'Ami' &&
  m2.resultats.grandPrix.classement[0].points === 18,
  m2.resultats.grandPrix.classement.map((l) => `${l.place}.${l.nom} ${l.points}`).join(' · '));

const m3 = await joueManche('A');
const m4 = await joueManche('A');
check('quatre manches sur les quatre circuits',
  [m1, m2, m3, m4].map((m) => m.depart.circuit).join(',') === COURSE.grandPrix.join(','),
  [m1, m2, m3, m4].map((m) => m.depart.circuit).join(' → '));
check('championnat terminé et classement final juste',
  m4.resultats.grandPrix.termine === true &&
  m4.resultats.grandPrix.classement[0].nom === 'Dimitri' &&
  m4.resultats.grandPrix.classement[0].points === 10 + 8 + 10 + 10 &&
  m4.resultats.grandPrix.classement[1].points === 8 + 10 + 8 + 8,
  m4.resultats.grandPrix.classement.map((l) => `${l.place}.${l.nom} ${l.points}`).join(' · '));

// Relancer après la dernière manche doit ouvrir un championnat neuf.
const m5 = await joueManche('B');
check('un nouveau championnat repart à zéro',
  m5.depart.circuit === COURSE.grandPrix[0] &&
  m5.resultats.grandPrix.mancheCourue === 1 &&
  m5.resultats.grandPrix.classement[0].points === 10,
  `${m5.depart.circuit}, ${m5.resultats.grandPrix.classement.map((l) => `${l.nom} ${l.points}`).join(' ')}`);

// Changer de mode remet le championnat à zéro : on ne mélange pas les points.
const retourCourse = await new Promise((r) => { B.once('salon:maj', r); A.emit('salon:reglages', { mode: 'course' }); });
check('changer de mode efface le championnat',
  retourCourse.mode === 'course' && retourCourse.grandPrix === null);

A.close(); B.close();
console.log(`\n${ok}/${ok + ko} vérifications passées`);
await wait(300);
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
