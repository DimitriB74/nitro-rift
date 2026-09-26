// Chat dans deux vrais navigateurs, et saisie au clavier dans les formulaires.
//
// Deux pages rejoignent le même salon et se parlent. On vérifie aussi que le
// clavier de conduite ne mange plus les lettres quand le joueur écrit : les
// touches W, A, S, D, T et l'espace servent à piloter, mais pas dans un champ.

import { demarreServeur } from './aide.mjs';
import { chromium } from 'playwright';

const PORT = 3342;
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

async function ouvrePage() {
  const contexte = await navigateur.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await contexte.newPage();
  page.on('pageerror', (e) => console.log('  ERREUR PAGE :', e.message));
  await page.goto(ADRESSE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#ecran-connexion.actif', { timeout: 25000 });
  return page;
}

const clic = (page, a) => page.evaluate((x) =>
  [...document.querySelectorAll('[data-action]')].find((b) => b.dataset.action === x && b.offsetParent)?.click(), a);

// ---------------------------------------------------------------------------
console.log('=== Saisie au clavier dans les formulaires ===');
const hote = await ouvrePage();
await hote.click('[data-onglet="inscription"]');
await hote.click('#auth-pseudo');
// Tapé touche par touche : c'est ce que fait un vrai joueur.
await hote.keyboard.type('Wasda Test');
const pseudoTape = await hote.inputValue('#auth-pseudo');
check('les lettres de conduite s’écrivent dans un champ de texte',
  pseudoTape === 'Wasda Test', JSON.stringify(pseudoTape));

await hote.fill('#auth-pseudo', 'Bavard');
await hote.fill('#auth-mdp', 'motdepasse');
await hote.click('#auth-valider');
await hote.waitForSelector('#ecran-menu.actif', { timeout: 15000 });

// ---------------------------------------------------------------------------
console.log('\n=== Salon à deux ===');
await clic(hote, 'course-rapide');
await hote.waitForSelector('#ecran-mode.actif', { timeout: 6000 });
await clic(hote, 'mode-multi');
await hote.waitForSelector('#ecran-multi.actif', { timeout: 15000 });
await hote.click('#multi-creer');
await hote.waitForSelector('#ecran-salon.actif', { timeout: 10000 });
const code = (await hote.textContent('#salon-code')).trim();

const invite = await ouvrePage();
await invite.click('#auth-invite');
await invite.waitForSelector('#ecran-menu.actif', { timeout: 15000 });
await clic(invite, 'course-rapide');
await invite.waitForSelector('#ecran-mode.actif', { timeout: 6000 });
await clic(invite, 'mode-multi');
await invite.waitForSelector('#ecran-multi.actif', { timeout: 15000 });
await invite.fill('#multi-code', code);
await invite.click('#multi-rejoindre');
await invite.waitForSelector('#ecran-salon.actif', { timeout: 10000 });
check('les deux joueurs sont dans le même salon',
  (await invite.textContent('#salon-code')).trim() === code, `code ${code}`);

// ---------------------------------------------------------------------------
console.log('\n=== Échange de messages ===');
await hote.click('#chat-saisie');
await hote.keyboard.type('salut, on lance quand tu veux');
await hote.keyboard.press('Enter');
const attendMessages = (page, n) => page.waitForFunction(
  (attendu) => document.querySelectorAll('#chat-messages li').length >= attendu, n, { timeout: 8000 });
await Promise.all([attendMessages(invite, 1), attendMessages(hote, 1)]);

const cote = async (page) => page.evaluate(() => [...document.querySelectorAll('#chat-messages li')]
  .map((l) => ({ texte: l.textContent, moi: l.classList.contains('moi'), html: l.innerHTML })));

let chezInvite = await cote(invite);
let chezHote = await cote(hote);
check('le message arrive chez l’autre joueur',
  chezInvite[0].texte.includes('salut, on lance quand tu veux') && chezInvite[0].texte.includes('Bavard'),
  chezInvite[0].texte);
check('l’expéditeur voit son message marqué comme sien',
  chezHote[0].moi === true && chezInvite[0].moi === false);
check('le champ se vide après envoi', (await hote.inputValue('#chat-saisie')) === '');

// Réponse de l'invité, en cliquant le bouton plutôt qu'en appuyant sur Entrée.
await invite.fill('#chat-saisie', 'ok, je suis prêt');
await invite.click('#chat-envoyer');
await Promise.all([attendMessages(hote, 2), attendMessages(invite, 2)]);
chezHote = await cote(hote);
check('le bouton Envoyer marche aussi', chezHote[1].texte.includes('ok, je suis prêt'), chezHote[1].texte);
check('un invité est signalé comme tel', /invité/i.test(chezHote[1].html), chezHote[1].html.slice(0, 80));

// Un message hostile doit s'afficher en texte, pas s'exécuter.
await invite.fill('#chat-saisie', '<img src=x onerror="window.pirate=1">');
await invite.click('#chat-envoyer');
await attendMessages(hote, 3);
const securite = await hote.evaluate(() => ({
  images: document.querySelectorAll('#chat-messages img').length,
  pirate: window.pirate ?? null,
  texte: document.querySelectorAll('#chat-messages li')[2].textContent,
}));
check('le HTML d’un autre joueur est échappé, pas exécuté',
  securite.images === 0 && securite.pirate === null && securite.texte.includes('<img src=x'),
  securite.texte.trim());
await hote.screenshot({ path: `${SHOTS}/nr-16-chat-salon.png` });

// ---------------------------------------------------------------------------
console.log('\n=== Chat en course ===');
await hote.evaluate(() => document.getElementById('salon-pret').click());
await invite.evaluate(() => document.getElementById('salon-pret').click());
await wait(600);
await hote.evaluate(() => document.getElementById('salon-lancer').click());
await hote.waitForSelector('#ecran-course.actif', { timeout: 40000 });
await invite.waitForSelector('#ecran-course.actif', { timeout: 40000 });

// La touche T ouvre la saisie et rend le clavier au texte.
await hote.keyboard.press('KeyT');
await hote.waitForFunction(() => window.__jeu?.chat?.ouvert === true, { timeout: 8000 });
const pendant = await hote.evaluate(() => ({
  ouvert: window.__jeu.chat.ouvert,
  clavier: window.__jeu.clavier.actif,
  visible: !document.getElementById('chat-course').hidden,
}));
check('la touche T ouvre la saisie et désarme les commandes',
  pendant.ouvert && pendant.clavier === false && pendant.visible);

await hote.keyboard.type('attention au virage');
await hote.keyboard.press('Enter');
// Des messages du salon sont peut-être encore affichés : on attend celui-ci
// précisément, pas « au moins une ligne ».
await invite.waitForFunction(
  () => [...document.querySelectorAll('#chat-course-messages li')]
    .some((l) => l.textContent.includes('attention au virage')), { timeout: 15000 });
const enCourse = await invite.evaluate(() => ({
  lignes: [...document.querySelectorAll('#chat-course-messages li')].map((l) => l.textContent),
  visible: !document.getElementById('chat-course-messages').hidden,
}));
// Les messages du salon sont encore récents : ils restent visibles un moment.
// Le nouveau doit être le dernier de la liste, la plus récente en bas.
check('le message s’affiche en surimpression pendant la course',
  enCourse.visible && enCourse.lignes.at(-1).includes('attention au virage'),
  enCourse.lignes.map((l) => l.trim().slice(0, 40)).join(' | '));

const apres = await hote.evaluate(() => ({
  ouvert: window.__jeu.chat.ouvert,
  clavier: window.__jeu.clavier.actif,
}));
check('Entrée referme la saisie et rend les commandes',
  apres.ouvert === false && apres.clavier === true);

// Échap doit aussi refermer, sans envoyer.
await hote.keyboard.press('KeyT');
await hote.waitForFunction(() => window.__jeu?.chat?.ouvert === true, { timeout: 6000 });
await hote.keyboard.type('annulé');
await hote.keyboard.press('Escape');
await wait(500);
const annule = await hote.evaluate(() => ({
  ouvert: window.__jeu.chat.ouvert,
  clavier: window.__jeu.clavier.actif,
  messages: document.querySelectorAll('#chat-messages li').length,
}));
check('Échap annule la saisie sans rien envoyer',
  annule.ouvert === false && annule.clavier === true && annule.messages === 4,
  `${annule.messages} messages au total`);
await invite.screenshot({ path: `${SHOTS}/nr-17-chat-course.png` });

console.log(`\n${ok}/${ok + ko} vérifications passées`);
await navigateur.close();
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
