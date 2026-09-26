// Deux navigateurs dans le même salon : création, code, prêt, départ commun.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = 3320;
const ADRESSE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS ?? '/tmp';
const serveur = spawn('node', ['server/index.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(PORT), JWT_SECRET: 't' },
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const check = (l, c, d = '') => { c ? ok++ : ko++; console.log(`  ${c ? 'OK   ' : 'ÉCHEC'} ${l}${d ? '  — ' + d : ''}`); };

await wait(9000);
const navigateur = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function ouvre(nom) {
  const page = await (await navigateur.newContext({ viewport: { width: 1100, height: 680 } })).newPage();
  page.on('pageerror', (e) => console.log(`  [${nom}] ERREUR PAGE :`, e.message));
  await page.goto(ADRESSE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#ecran-connexion.actif', { timeout: 20000 });
  await page.click('[data-onglet="inscription"]');
  await page.fill('#auth-pseudo', nom);
  await page.fill('#auth-mdp', 'motdepasse');
  await page.click('#auth-valider');
  await page.waitForSelector('#ecran-menu.actif', { timeout: 10000 });
  return page;
}

const clic = (page, action) => page.evaluate((a) =>
  [...document.querySelectorAll('[data-action]')].find((b) => b.dataset.action === a && b.offsetParent)?.click(), action);

console.log('=== Deux joueurs rejoignent le même salon ===');
const hote = await ouvre('Hote');
const ami = await ouvre('Ami');
check('deux comptes créés et connectés au menu', true);

await clic(hote, 'grand-prix');
await hote.waitForSelector('#ecran-mode.actif');
await clic(hote, 'mode-multi');
await hote.waitForSelector('#ecran-multi.actif', { timeout: 15000 });
await hote.click('#multi-creer');
await hote.waitForSelector('#ecran-salon.actif', { timeout: 10000 });
const code = (await hote.textContent('#salon-code')).trim();
check('salon créé avec un code lisible', /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code), code);

await clic(ami, 'grand-prix');
await ami.waitForSelector('#ecran-mode.actif');
await clic(ami, 'mode-multi');
await ami.waitForSelector('#ecran-multi.actif', { timeout: 15000 });
await ami.fill('#multi-code', code.toLowerCase());
await ami.click('#multi-rejoindre');
await ami.waitForSelector('#ecran-salon.actif', { timeout: 10000 });
await wait(700);

const liste = await hote.evaluate(() => [...document.querySelectorAll('#salon-participants li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
check('les deux joueurs apparaissent chez l’hôte', liste.length === 2, liste.join(' | '));
check('l’hôte est identifié comme tel', liste[0].includes('hôte'));

// L'hôte ajoute deux bots et change de circuit.
await hote.evaluate(() => document.querySelector('[data-bot="difficile"]')?.click());
await hote.evaluate(() => document.querySelector('[data-bot="facile"]')?.click());
await hote.evaluate(() => document.querySelector('[data-circuit="stade"]')?.click());
await wait(700);
const vuAmi = await ami.evaluate(() => ({
  participants: document.querySelectorAll('#salon-participants li').length,
  reglages: document.getElementById('salon-reglages').textContent.replace(/\s+/g, ' ').trim(),
  peutRegler: !!document.querySelector('[data-circuit]'),
}));
check('les bots et le circuit sont diffusés à l’invité', vuAmi.participants === 4, `${vuAmi.participants} participants`);
check('l’invité ne voit pas les réglages d’hôte', !vuAmi.peutRegler, vuAmi.reglages.slice(0, 60));
await hote.screenshot({ path: `${SHOTS}/nr-09-salon.png` });

// Bouton « Lancer » bloqué tant que tout le monde n'est pas prêt.
const avant = await hote.evaluate(() => document.getElementById('salon-lancer').disabled);
check('le lancement est bloqué avant que tous soient prêts', avant === true);

await hote.click('#salon-pret');
await ami.click('#salon-pret');
await wait(700);
const apres = await hote.evaluate(() => document.getElementById('salon-lancer').disabled);
check('le lancement se débloque quand tous sont prêts', apres === false);

// Départ.
await hote.click('#salon-lancer');
await Promise.all([
  hote.waitForSelector('#ecran-course.actif', { timeout: 25000 }),
  ami.waitForSelector('#ecran-course.actif', { timeout: 25000 }),
]);
check('les deux clients basculent en course', true);

await wait(6000);
const etat = await Promise.all([hote, ami].map((p) => p.evaluate(() => ({
  participants: window.__jeu?.course?.participants.length ?? 0,
  distants: window.__jeu?.course?.participants.filter((x) => x.distant).length ?? 0,
  recus: window.__jeu?.tampon?.parId.size ?? 0,
}))));
check('la course contient les 4 voitures des deux côtés',
  etat[0].participants === 4 && etat[1].participants === 4,
  `hôte ${etat[0].participants}, ami ${etat[1].participants}`);
check('chaque client ne simule que sa voiture',
  etat[0].distants === 3 && etat[1].distants === 3,
  `${etat[0].distants} voitures distantes`);
check('les instantanés du serveur arrivent',
  etat[0].recus >= 3 && etat[1].recus >= 3,
  `hôte suit ${etat[0].recus} voitures, ami ${etat[1].recus}`);
await hote.screenshot({ path: `${SHOTS}/nr-10-course-reseau.png` });

console.log(`\n${ok}/${ok + ko} vérifications passées`);
await navigateur.close();
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
