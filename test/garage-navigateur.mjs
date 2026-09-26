// Garage et classements dans un vrai navigateur.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = 3340;
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
const page = await navigateur.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('  ERREUR PAGE :', e.message));

await page.goto(ADRESSE, { waitUntil: 'networkidle' });
await page.waitForSelector('#ecran-connexion.actif', { timeout: 20000 });
await page.click('[data-onglet="inscription"]');
await page.fill('#auth-pseudo', 'Mecano');
await page.fill('#auth-mdp', 'motdepasse');
await page.click('#auth-valider');
await page.waitForSelector('#ecran-menu.actif', { timeout: 10000 });

const clic = (a) => page.evaluate((x) =>
  [...document.querySelectorAll('[data-action]')].find((b) => b.dataset.action === x && b.offsetParent)?.click(), a);

console.log('=== Garage ===');
await clic('garage');
await page.waitForSelector('#ecran-garage.actif', { timeout: 6000 });
const depart = await page.evaluate(() => ({
  credits: document.getElementById('garage-credits').textContent,
  voitures: document.querySelectorAll('#garage-liste [data-voiture]').length,
  stats: document.querySelectorAll('#garage-stats .stat-ligne').length,
  action: document.getElementById('garage-action').textContent.trim(),
  peintures: document.querySelectorAll('#garage-peintures [data-peinture]').length,
}));
check('le garage affiche les 4 voitures et 5 statistiques',
  depart.voitures === 4 && depart.stats === 5, `${depart.voitures} voitures, ${depart.stats} stats`);
check('les peintures sont listées', depart.peintures >= 4, `${depart.peintures} peintures`);
check('la Comète est la voiture active', depart.action === 'Voiture active', depart.action);
await page.screenshot({ path: `${SHOTS}/nr-11-garage.png` });

// Améliorer la vitesse : 500 − 300 = 200 crédits.
await page.evaluate(() => document.querySelector('#garage-stats [data-stat="vitesse"]')?.click());
await wait(900);
const apres = await page.evaluate(() => ({
  credits: document.getElementById('garage-credits').textContent,
  entete: document.querySelector('#garage-stats .stat-entete .niveau')?.textContent,
  bandeau: document.getElementById('credits-valeur').textContent,
}));
check('l’amélioration débite et monte le niveau',
  apres.credits === '200' && apres.entete.includes('niv. 1'), `${apres.credits} ¤, ${apres.entete}`);
check('le bandeau du menu suit', apres.bandeau === '200', apres.bandeau);

// Voiture trop chère.
await page.evaluate(() => document.querySelector('#garage-liste [data-voiture="tempete"]')?.click());
await wait(300);
const chere = await page.evaluate(() => ({
  texte: document.getElementById('garage-action').textContent.trim(),
  desactive: document.getElementById('garage-action').disabled,
}));
check('une voiture trop chère est proposée mais désactivée',
  chere.texte.startsWith('Acheter') && chere.desactive === true, chere.texte);

// Peinture verrouillée.
await page.evaluate(() => {
  const verrou = document.querySelector('#garage-peintures .verrouille');
  verrou?.click();
});
await wait(400);
const verrou = await page.textContent('#garage-erreur');
check('une peinture verrouillée explique pourquoi', verrou.includes('défi'), verrou);

console.log('\n=== Showroom 3D ===');
// Le conteneur rend en logiciel : on vérifie que la scène existe et tourne,
// pas la beauté de l'image.
const showroom = await page.evaluate(() => {
  const jeu = window.__jeu;
  if (!jeu.showroom) return { absent: true };
  const avant = jeu.showroom.angle;
  jeu.showroom.maj(0.5);
  return {
    absent: false,
    actif: jeu.showroom.actif,
    voiture: jeu.showroom.voiture?.name ?? null,
    aTourne: jeu.showroom.angle !== avant,
    largeur: document.getElementById('garage-showroom').clientWidth,
  };
});
check('le showroom expose la voiture sélectionnée',
  showroom.absent === false && showroom.voiture === 'voiture-tempete',
  showroom.absent ? 'WebGL indisponible' : `${showroom.voiture}, canvas ${showroom.largeur} px`);
check('le plateau tourne tant que le garage est ouvert',
  showroom.actif === true && showroom.aTourne === true);

// Changer de voiture doit changer le modèle exposé.
await page.evaluate(() => document.querySelector('#garage-liste [data-voiture="vipere"]')?.click());
await wait(500);
const change = await page.evaluate(() => window.__jeu.showroom?.voiture?.name ?? null);
check('changer de voiture change le modèle exposé', change === 'voiture-vipere', change);
await page.screenshot({ path: `${SHOTS}/nr-13-showroom.png` });

console.log('\n=== Classements ===');
await clic('retour-menu');
const arret = await page.evaluate(() => window.__jeu.showroom?.actif ?? null);
check('le showroom s’arrête en quittant le garage', arret === false);

await clic('classements');
await page.waitForSelector('#ecran-classements.actif', { timeout: 6000 });
await wait(1200);
const cl = await page.evaluate(() => ({
  circuits: document.querySelectorAll('#classements-circuits [data-circuit]').length,
  cibles: document.getElementById('classements-cibles').textContent,
  corps: document.getElementById('classements-corps').textContent.trim().slice(0, 60),
}));
check('les 4 circuits sont proposés', cl.circuits === 4, `${cl.circuits}`);
check('les temps cibles calibrés sont affichés', cl.cibles.includes('platine'), cl.cibles.slice(0, 80));
check('le classement vide est expliqué', cl.corps.includes('Aucun temps'), cl.corps);
await page.screenshot({ path: `${SHOTS}/nr-12-classements.png` });

console.log(`\n${ok}/${ok + ko} vérifications passées`);
await navigateur.close();
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
