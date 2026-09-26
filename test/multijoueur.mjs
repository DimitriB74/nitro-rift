import { spawn } from 'node:child_process';
import { io as connecte } from 'socket.io-client';
import { fileURLToPath } from 'node:url';

const PORT = 3311;
const ADRESSE = `http://127.0.0.1:${PORT}`;
const serveur = spawn('node', ['server/index.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(PORT), JWT_SECRET: 't' },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, ko = 0;
const check = (l, c, d = '') => { c ? ok++ : ko++; console.log(`  ${c ? 'OK   ' : 'ÉCHEC'} ${l}${d ? '  — ' + d : ''}`); };
const attend = (s, ev, ms = 6000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
  s.once(ev, (d) => { clearTimeout(t); res(d); });
});
await wait(9000); // le serveur calcule les références de temps au démarrage

const A = connecte(ADRESSE, { auth: { pseudo: 'Dimitri' } });
const B = connecte(ADRESSE, { auth: { pseudo: 'Ami' } });
await Promise.all([attend(A, 'bienvenue'), attend(B, 'bienvenue')]);
check('deux clients connectés', true);

console.log('\n=== Synchronisation d’horloge ===');
const t0 = Date.now();
const sync = await new Promise(r => A.emit('sync', t0, r));
const rtt = Date.now() - t0;
const decalage = sync.serveur - (t0 + rtt / 2);
check('aller-retour mesuré', rtt >= 0 && rtt < 2000, `${rtt} ms, décalage estimé ${decalage} ms`);

console.log('\n=== Salon ===');
const cree = await new Promise(r => A.emit('salon:creer', {}, r));
const code = cree.salon.code;
check('création du salon', cree.ok && code.length === 4 && !/[IO01]/.test(code), `code ${code}`);

const mauvais = await new Promise(r => B.emit('salon:rejoindre', { code: 'ZZZZ' }, r));
check('code inconnu refusé', !mauvais.ok, mauvais.message);

const rejoint = await new Promise(r => B.emit('salon:rejoindre', { code: code.toLowerCase() }, r));
check('code accepté en minuscules', rejoint.ok, `${rejoint.salon?.participants.length} participants`);

A.emit('salon:reglages', { mode: 'course', circuit: 'stade', tours: 1 });
A.emit('salon:bot-ajouter', { niveau: 'difficile' });
A.emit('salon:bot-ajouter', { niveau: 'facile' });
let maj = await attend(B, 'salon:maj');
await wait(300);
const etatSalon = await new Promise(r => { B.once('salon:maj', r); A.emit('salon:bot-ajouter', { niveau: 'moyen' }); });
check('réglages et bots diffusés à tout le monde',
  etatSalon.circuit === 'stade' && etatSalon.tours === 1 && etatSalon.participants.filter(p => p.bot).length === 3,
  `${etatSalon.circuit}, ${etatSalon.tours} tour, ${etatSalon.participants.length} participants`);

// Un non-hôte ne doit rien pouvoir changer.
B.emit('salon:reglages', { circuit: 'canyon' });
await wait(400);
const apres = await new Promise(r => { B.once('salon:maj', r); A.emit('salon:bot-ajouter', { niveau: 'moyen' }); });
check('un non-hôte ne change pas les réglages', apres.circuit === 'stade', `circuit resté ${apres.circuit}`);

console.log('\n=== Départ synchronisé ===');
const attenduRefus = new Promise(r => { A.once('salon:erreur', r); setTimeout(() => r(null), 1200); });
A.emit('salon:lancer');
const refus = await attenduRefus;
check('lancement refusé si tout le monde n’est pas prêt', !!refus, refus?.message);

const C = connecte(ADRESSE, { auth: { pseudo: 'Tiers' } });
await attend(C, 'bienvenue');
await new Promise(r => C.emit('salon:rejoindre', { code }, r));

A.emit('salon:pret', { pret: true });
B.emit('salon:pret', { pret: true });
C.emit('salon:pret', { pret: true });
await wait(400);
const departA = attend(A, 'course:demarrer', 8000);
const departB = attend(B, 'course:demarrer', 8000);
const departC = attend(C, 'course:demarrer', 8000);
A.emit('salon:lancer');
const [dA, dB, dC] = await Promise.all([departA, departB, departC]);
check('tous les clients reçoivent la même heure de départ',
  dA.heureDepart === dB.heureDepart && dB.heureDepart === dC.heureDepart,
  `dans ${(dA.heureDepart - Date.now() / 1)  > 0 ? Math.round((dA.heureDepart - Date.now())) : 0} ms`);
const attendus = 3 + 4; // trois humains, quatre bots ajoutés
check('grille de départ complète', dA.grille.length === attendus,
  `${dA.grille.length} voitures (${attendus} attendues), circuit ${dA.circuit}`);

console.log('\n=== Instantanés ===');
const envoieEtat = (s, x) => s.emit('course:etat', { p: [x, 0, 0], a: [0, 0, 1], u: [0, 1, 0], v: 40, d: 0, n: 0, s: 0.1, t: 1 });
const timer = setInterval(() => { envoieEtat(A, 5); envoieEtat(B, 9); envoieEtat(C, 13); }, 50);
await wait(4500);
const snap = await attend(A, 'course:instantane', 4000);
clearInterval(timer);
const ids = snap.j.map(j => j.i);
check('l’instantané contient les humains et les bots', snap.j.length === attendus, `${snap.j.length} voitures`);
check('les bots avancent côté serveur', snap.j.some(j => String(j.i).startsWith('bot:') && j.v > 5),
  'vitesse max bot ' + Math.round(Math.max(...snap.j.filter(j => String(j.i).startsWith('bot:')).map(j => j.v)) * 3.6) + ' km/h');

console.log('\n=== Contrôle de plausibilité ===');
const triche = await new Promise(r => A.emit('course:arrivee', { tempsTotal: 0.5, tempsTours: [0.5] }, r));
check('temps impossible rejeté', triche.accepte === false, triche.raison);
const honnete = await new Promise(r => B.emit('course:arrivee', { tempsTotal: 48.5, tempsTours: [48.5] }, r));
check('temps plausible accepté', honnete.accepte === true);

console.log('\n=== Déconnexion en course ===');
// B a déjà franchi l'arrivée : le remplacer n'aurait aucun sens.
const rienPourB = new Promise(r => { A.once('salon:remplacement', r); setTimeout(() => r(null), 1500); });
B.close();
check('un joueur déjà arrivé n’est pas remplacé', (await rienPourB) === null);

// C, lui, est encore en piste.
const remplacement = attend(A, 'salon:remplacement', 5000);
C.close();
const remp = await remplacement;
check('un bot reprend la voiture du déconnecté en piste', remp.pseudo.includes('(bot)'), remp.pseudo);

console.log('\n=== Résultats ===');
const resultats = await attend(A, 'course:resultats', 40000);
check('la course se termine et produit un classement',
  resultats.classement.length === attendus, `${resultats.classement.length} classés sur ${attendus}`);
const parti = resultats.classement.find(c => c.pseudo === 'Ami');
check('un joueur arrivé puis déconnecté garde sa place',
  !!parti && parti.tempsTotal !== null, parti ? `${parti.place}e en ${parti.tempsTotal} s` : 'absent du classement');
const places = resultats.classement.map(c => c.place);
check('places numérotées sans trou', places.join(',') === places.map((_, i) => i + 1).join(','), places.join(', '));
const moi = resultats.classement.find(c => c.pseudo === 'Dimitri');
check('le tricheur est classé sans temps', moi && moi.tempsTotal === null, JSON.stringify(moi?.rejete ?? moi?.abandon));
console.log('  classement :', resultats.classement.map(c =>
  `${c.place}. ${c.pseudo}${c.bot && !c.pseudo.endsWith('(bot)') ? ' (bot)' : ''}` +
  (c.tempsTotal ? ` ${c.tempsTotal.toFixed(2)}s` : c.rejete ? ' rejeté' : ' abandon')).join(' · '));

console.log('\n=== Transfert d’hôte ===');
const D = connecte(ADRESSE, { auth: { pseudo: 'Quatrieme' } });
await attend(D, 'bienvenue');
const arrivee = await new Promise(r => D.emit('salon:rejoindre', { code }, r));
check('on peut rejoindre une fois la course finie', arrivee.ok, arrivee.message ?? '');
const nouvelHote = attend(D, 'salon:nouvel-hote', 5000);
A.close();
const nh = await nouvelHote;
check('un autre joueur devient hôte automatiquement', nh.pseudo === 'Quatrieme', nh.pseudo);
D.close();

console.log(`\n${ok}/${ok + ko} vérifications passées`);
await wait(300);
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
