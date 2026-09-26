// Contre-la-montre multijoueur vu du navigateur : décompte commun, classement
// des meilleurs tours dans le HUD, écran de résultats.
//
// La session est réglée sur la durée minimale (une minute) pour que le test
// tienne en un peu plus d'une minute et demie.

import { chromium } from 'playwright';
import { demarreServeur } from './aide.mjs';
import { COURSE } from '../shared/config.js';

const PORT = 3343;
const ADRESSE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS ?? '/tmp';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const check = (l, c, d = '') => { c ? ok++ : ko++; console.log(`  ${c ? 'OK   ' : 'ÉCHEC'} ${l}${d ? '  — ' + d : ''}`); };

const serveur = await demarreServeur(PORT);

const navigateur = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function ouvrePage(nom) {
  const contexte = await navigateur.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await contexte.newPage();
  page.on('pageerror', (e) => console.log(`  ERREUR PAGE (${nom}) :`, e.message));
  await page.goto(ADRESSE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#ecran-connexion.actif', { timeout: 25000 });
  await page.click('#auth-invite');
  await page.waitForSelector('#ecran-menu.actif', { timeout: 15000 });
  return page;
}
const clic = (page, a) => page.evaluate((x) =>
  [...document.querySelectorAll('[data-action]')].find((b) => b.dataset.action === x && b.offsetParent)?.click(), a);

console.log('=== Salon ===');
const hote = await ouvrePage('hôte');
await clic(hote, 'course-rapide');
await hote.waitForSelector('#ecran-mode.actif', { timeout: 6000 });
await clic(hote, 'mode-multi');
await hote.waitForSelector('#ecran-multi.actif', { timeout: 15000 });
await hote.click('#multi-creer');
await hote.waitForSelector('#ecran-salon.actif', { timeout: 10000 });
const code = (await hote.textContent('#salon-code')).trim();

const invite = await ouvrePage('invité');
await clic(invite, 'course-rapide');
await invite.waitForSelector('#ecran-mode.actif', { timeout: 6000 });
await clic(invite, 'mode-multi');
await invite.waitForSelector('#ecran-multi.actif', { timeout: 15000 });
await invite.fill('#multi-code', code);
await invite.click('#multi-rejoindre');
await invite.waitForSelector('#ecran-salon.actif', { timeout: 10000 });

// L'hôte bascule en contre-la-montre depuis l'interface.
await hote.evaluate(() => document.querySelector('#salon-modes [data-mode="contre-la-montre"]')?.click());
await hote.waitForFunction(() => window.__jeu?.salonUi?.salon?.mode === 'contre-la-montre', { timeout: 8000 });
const boutons = await hote.evaluate(() =>
  [...document.querySelectorAll('#salon-reglages [data-duree]')].map((b) => b.textContent.trim()));
check('les durées de session sont proposées à l’hôte',
  boutons.length === COURSE.dureesContreLaMontre.length, boutons.join(' · '));

// On raccourcit la session par le réseau : l'interface ne propose pas 1 minute,
// mais le serveur l'accepte, et le test n'a pas cinq minutes devant lui.
await hote.evaluate((d) => window.__jeu.reseau.reglages({ duree: d }), COURSE.dureeSessionMin);
await invite.waitForFunction((d) => window.__jeu?.salonUi?.salon?.duree === d,
  COURSE.dureeSessionMin, { timeout: 8000 });
const vueInvite = await invite.textContent('#salon-reglages');
check('l’invité voit le mode et la durée', /Contre-la-montre/.test(vueInvite) && /1 minute/.test(vueInvite),
  vueInvite.replace(/\s+/g, ' ').trim().slice(0, 90));

console.log('\n=== Session ===');
await hote.evaluate(() => document.getElementById('salon-pret').click());
await invite.evaluate(() => document.getElementById('salon-pret').click());
await wait(700);
await hote.evaluate(() => document.getElementById('salon-lancer').click());
await hote.waitForSelector('#ecran-course.actif', { timeout: 40000 });
await invite.waitForSelector('#ecran-course.actif', { timeout: 40000 });
await hote.waitForFunction(() => window.__jeu?.course?.phase === 'course', { timeout: 20000 });

const debut = await hote.evaluate(() => ({
  session: window.__jeu.course.session,
  tours: window.__jeu.course.tours,
  restant: window.__jeu.course.tempsRestant,
  chrono: document.getElementById('hud-chrono').textContent,
  toursHud: document.getElementById('hud-tours').textContent,
}));
check('le client sait qu’il est en session', debut.session === true && debut.tours > 100,
  `${debut.tours} tours annoncés`);
check('le chronomètre décompte le temps de session',
  debut.restant > 30 && debut.restant <= COURSE.dureeSessionMin && /^[01]:\d\d$/.test(debut.chrono),
  `${debut.chrono} affiché, ${debut.restant.toFixed(1)} s restantes`);
check('le nombre de tours n’est pas borné à l’écran', debut.toursHud === '∞', debut.toursHud);

// Les deux joueurs annoncent un tour : le classement doit suivre chez les deux.
await hote.evaluate(() => window.__jeu.reseau.annoncerTour(51.2));
await invite.evaluate(() => window.__jeu.reseau.annoncerTour(47.9));
await hote.waitForFunction(
  () => (window.__jeu.hud.meilleurs ?? []).filter((l) => l.meilleurTour != null).length === 2,
  { timeout: 10000 });
await hote.waitForFunction(
  () => document.querySelector('#hud-classement li .ecart')?.textContent?.includes(':'), { timeout: 10000 });

const tableau = await hote.evaluate(() => ({
  lignes: [...document.querySelectorAll('#hud-classement li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()),
  place: document.getElementById('hud-position').textContent,
}));
check('le HUD classe les joueurs au meilleur tour',
  tableau.lignes[0].includes('0:47.900') && tableau.lignes[1].includes('0:51.200'),
  tableau.lignes.join(' | '));
check('notre place suit le classement des tours, pas la position en piste',
  tableau.place === '2', `place ${tableau.place} pour l’hôte (51,2 s contre 47,9 s)`);
await hote.screenshot({ path: `${SHOTS}/nr-18-session.png` });

console.log('\n=== Fin de session ===');
const restant = await hote.evaluate(() => window.__jeu.course.tempsRestant);
console.log(`  attente de la fin : ${Math.round(restant)} s`);
await hote.waitForSelector('#ecran-resultats.actif', { timeout: (restant + 30) * 1000 });

const resultats = await hote.evaluate(() => ({
  titre: document.getElementById('resultats-titre').textContent,
  entetes: [...document.querySelectorAll('#resultats-entetes th')].map((t) => t.textContent),
  lignes: [...document.querySelectorAll('#resultats-corps tr')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()),
}));
check('l’écran de résultats annonce un contre-la-montre',
  /contre.la.montre/i.test(resultats.titre) && resultats.entetes.at(-1) === 'Meilleur tour',
  `${resultats.titre} — ${resultats.entetes.join('/')}`);
check('le classement final reprend les meilleurs tours',
  resultats.lignes[0].includes('0:47.900') && resultats.lignes[1].includes('0:51.200'),
  resultats.lignes.join(' | '));
await hote.screenshot({ path: `${SHOTS}/nr-19-resultats-session.png` });

console.log(`\n${ok}/${ok + ko} vérifications passées`);
await navigateur.close();
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
