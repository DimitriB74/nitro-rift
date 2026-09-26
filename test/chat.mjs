// Chat : diffusion dans le salon, nettoyage des messages et anti-inondation.
import { io as connecte } from 'socket.io-client';
import { demarreServeur } from './aide.mjs';

const PORT = 3313;
const ADRESSE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const check = (l, c, d = '') => { c ? ok++ : ko++; console.log(`  ${c ? 'OK   ' : 'ÉCHEC'} ${l}${d ? '  — ' + d : ''}`); };
const attend = (s, ev, ms = 4000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
  s.once(ev, (d) => { clearTimeout(t); res(d); });
});

const serveur = await demarreServeur(PORT);

const A = connecte(ADRESSE, { auth: { pseudo: 'Dimitri' } });
const B = connecte(ADRESSE, { auth: { pseudo: 'Ami' } });
const C = connecte(ADRESSE, { auth: { pseudo: 'Ailleurs' } });
await Promise.all([attend(A, 'bienvenue'), attend(B, 'bienvenue'), attend(C, 'bienvenue')]);

console.log('=== Diffusion ===');
// Un message envoyé hors salon ne doit atteindre personne.
const rienHorsSalon = new Promise((r) => { A.once('chat:message', r); setTimeout(() => r(null), 800); });
A.emit('chat', { texte: 'quelqu’un ?' });
check('un message hors salon n’est pas diffusé', (await rienHorsSalon) === null);

const cree = await new Promise((r) => A.emit('salon:creer', {}, r));
const code = cree.salon.code;
await new Promise((r) => B.emit('salon:rejoindre', { code }, r));
const autre = await new Promise((r) => C.emit('salon:creer', {}, r));

const recuA = attend(A, 'chat:message');
const recuB = attend(B, 'chat:message');
const rienC = new Promise((r) => { C.once('chat:message', r); setTimeout(() => r(null), 900); });
A.emit('chat', { texte: 'salut la compagnie' });
const [mA, mB] = await Promise.all([recuA, recuB]);

check('l’expéditeur reçoit son propre message',
  mA.texte === 'salut la compagnie' && mA.pseudo === 'Dimitri' && mA.id === A.id);
check('les autres joueurs du salon le reçoivent aussi',
  mB.texte === mA.texte && mB.heure === mA.heure);
check('un salon voisin ne voit rien', (await rienC) === null, `salon ${autre.salon.code}`);
check('l’étiquette « invité » accompagne les comptes sans inscription', mB.invite === true);

console.log('\n=== Nettoyage ===');
const sale = attend(B, 'chat:message');
A.emit('chat', { texte: '  bonjour \n\t  tout   le\u0007 monde  ' });
check('espaces et caractères de contrôle normalisés',
  (await sale).texte === 'bonjour tout le monde', JSON.stringify((await sale).texte));

const longue = attend(B, 'chat:message');
A.emit('chat', { texte: 'x'.repeat(500) });
check('un message trop long est coupé à 200 caractères', (await longue).texte.length === 200);

const rienVide = new Promise((r) => { B.once('chat:message', r); setTimeout(() => r(null), 700); });
A.emit('chat', { texte: '    ' });
A.emit('chat', {});
check('un message vide est ignoré', (await rienVide) === null);

// Le HTML n'est pas filtré ici : il est échappé à l'affichage. On vérifie
// seulement qu'il traverse tel quel, sans casser le message.
const balise = attend(B, 'chat:message');
A.emit('chat', { texte: '<img src=x onerror=alert(1)>' });
check('le HTML traverse intact, il sera échappé à l’affichage',
  (await balise).texte === '<img src=x onerror=alert(1)>');

console.log('\n=== Anti-inondation ===');
await wait(5200);   // on repart d'une fenêtre vide
let recus = 0;
B.on('chat:message', () => { recus++; });
const refus = new Promise((r) => { A.once('salon:erreur', r); setTimeout(() => r(null), 1500); });
for (let i = 0; i < 9; i++) A.emit('chat', { texte: `message ${i}` });
const avertissement = await refus;
await wait(500);
check('au plus cinq messages par fenêtre de cinq secondes', recus === 5, `${recus} messages passés sur 9`);
check('l’émetteur est prévenu qu’il va trop vite', !!avertissement, avertissement?.message);

await wait(5200);
const apres = attend(B, 'chat:message');
A.emit('chat', { texte: 'de nouveau calme' });
check('la parole revient une fois la fenêtre écoulée', (await apres).texte === 'de nouveau calme');

A.close(); B.close(); C.close();
console.log(`\n${ok}/${ok + ko} vérifications passées`);
await wait(200);
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
