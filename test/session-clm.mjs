// Contre-la-montre multijoueur : session chronométrée, classement au meilleur
// tour et diffusion en direct.
//
// La session est réglée sur une minute — la durée minimale acceptée — pour que
// le test reste court. Les joueurs annoncent leurs tours comme le ferait le
// navigateur ; les bots tournent vraiment, avec la physique partagée.

import { io as connecte } from 'socket.io-client';
import { demarreServeur } from './aide.mjs';
import { COURSE } from '../shared/config.js';

const PORT = 3314;
const ADRESSE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const check = (l, c, d = '') => { c ? ok++ : ko++; console.log(`  ${c ? 'OK   ' : 'ÉCHEC'} ${l}${d ? '  — ' + d : ''}`); };
const attend = (s, ev, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
  s.once(ev, (d) => { clearTimeout(t); res(d); });
});

const serveur = await demarreServeur(PORT);

const A = connecte(ADRESSE, { auth: { pseudo: 'Dimitri' } });
const B = connecte(ADRESSE, { auth: { pseudo: 'Ami' } });
await Promise.all([attend(A, 'bienvenue'), attend(B, 'bienvenue')]);

const cree = await new Promise((r) => A.emit('salon:creer', {}, r));
const code = cree.salon.code;
await new Promise((r) => B.emit('salon:rejoindre', { code }, r));
await wait(400);

console.log('=== Réglages ===');
let maj = await new Promise((r) => {
  B.once('salon:maj', r);
  A.emit('salon:reglages', { mode: 'contre-la-montre', circuit: 'stade', duree: COURSE.dureeSessionMin });
});
check('le mode et la durée de session sont diffusés',
  maj.mode === 'contre-la-montre' && maj.duree === COURSE.dureeSessionMin && maj.circuit === 'stade',
  `${maj.mode}, ${maj.duree} s, ${maj.circuit}`);

await wait(300);
maj = await new Promise((r) => { B.once('salon:maj', r); A.emit('salon:reglages', { duree: 5 }); });
check('une durée hors bornes est refusée', maj.duree === COURSE.dureeSessionMin, `${maj.duree} s`);

console.log('\n=== Départ ===');
A.emit('salon:bot-ajouter', { niveau: 'difficile' });
await wait(300);
A.emit('salon:pret', { pret: true });
B.emit('salon:pret', { pret: true });
await wait(400);

const departA = attend(A, 'course:demarrer', 8000);
const departB = attend(B, 'course:demarrer', 8000);
A.emit('salon:lancer');
const [dA, dB] = await Promise.all([departA, departB]);

check('la session est annoncée avec sa durée et son heure de fin',
  dA.mode === 'contre-la-montre' && dA.duree === COURSE.dureeSessionMin &&
  dA.heureFin === dA.heureDepart + COURSE.dureeSessionMin * 1000,
  `${dA.duree} s, fin dans ${Math.round((dA.heureFin - Date.now()) / 1000)} s`);
check('les deux clients reçoivent la même heure de fin', dA.heureFin === dB.heureFin);
check('la grille contient les deux joueurs et le bot', dA.grille.length === 3, `${dA.grille.length} voitures`);

// On attend le feu vert avant d'annoncer quoi que ce soit.
await wait(Math.max(0, dA.heureDepart - Date.now()) + 300);

console.log('\n=== Tours annoncés ===');
const impossible = await new Promise((r) => A.emit('course:tour', { temps: 3 }, r));
check('un tour impossible est refusé', impossible.accepte === false, impossible.raison);

const premier = await new Promise((r) => A.emit('course:tour', { temps: 52.4 }, r));
check('un tour plausible est accepté', premier.accepte === true && premier.meilleur === 52.4);

const pire = await new Promise((r) => A.emit('course:tour', { temps: 58.0 }, r));
check('un tour plus lent ne remplace pas le meilleur',
  pire.accepte === true && pire.ameliore === false && pire.meilleur === 52.4);

const meilleurs = attend(B, 'course:meilleurs', 6000);
B.emit('course:tour', { temps: 49.8 });
const tableau = await meilleurs;
check('le classement en direct place le meilleur tour en tête',
  tableau.lignes[0].pseudo === 'Ami' && tableau.lignes[0].meilleurTour === 49.8 &&
  tableau.lignes[1].pseudo === 'Dimitri',
  tableau.lignes.map((l) => `${l.place}.${l.pseudo} ${l.meilleurTour ?? '—'}`).join(' · '));
check('le bot figure au classement, sans temps tant qu’il n’a pas bouclé',
  tableau.lignes.length === 3, `${tableau.lignes.length} lignes`);

console.log('\n=== Fin de session ===');
const reste = Math.max(0, dA.heureFin - Date.now());
console.log(`  attente de la fin : ${Math.round(reste / 1000)} s`);
const resultats = await attend(A, 'course:resultats', reste + 20000);

check('la session se termine d’elle-même au chronomètre',
  resultats.mode === 'contre-la-montre' && resultats.classement.length === 3);
// Le bot roule vraiment : sur le stade, un bot difficile tourne sous les 46 s
// et bat donc les temps annoncés ici. Ce qui compte est l'ordre.
const temps = resultats.classement.map((c) => c.meilleurTour ?? Infinity);
check('le classement final est trié au meilleur tour',
  temps.every((t, i) => i === 0 || temps[i - 1] <= t),
  resultats.classement.map((c) => `${c.place}. ${c.pseudo} ${c.meilleurTour?.toFixed(3) ?? '—'}`).join(' · '));
const ami = resultats.classement.find((c) => c.pseudo === 'Ami');
const dimitri = resultats.classement.find((c) => c.pseudo === 'Dimitri');
check('les tours annoncés par les joueurs sont bien ceux retenus',
  ami.meilleurTour === 49.8 && dimitri.meilleurTour === 52.4 && ami.place < dimitri.place,
  `Ami ${ami.place}e en ${ami.meilleurTour} s, Dimitri ${dimitri.place}e en ${dimitri.meilleurTour} s`);

const bot = resultats.classement.find((c) => c.bot);
check('le bot a tourné et a un vrai meilleur tour',
  bot && Number.isFinite(bot.meilleurTour) && bot.meilleurTour > 30,
  bot ? `${bot.meilleurTour.toFixed(3)} s` : 'absent');
check('aucun temps total en session', resultats.classement.every((c) => c.tempsTotal === null));
check('le salon revient en attente', resultats.salon.phase === 'attente');

A.close(); B.close();
console.log(`\n${ok}/${ok + ko} vérifications passées`);
await wait(200);
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
