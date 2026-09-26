// Son et paramètres dans un vrai navigateur.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = 3350;
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
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await navigateur.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('  ERREUR PAGE :', e.message));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#ecran-connexion.actif', { timeout: 20000 });
await page.click('#auth-invite');
await page.waitForSelector('#ecran-menu.actif', { timeout: 10000 });

console.log('=== Démarrage du son ===');
// Le clic de connexion est déjà un geste : le contexte est donc créé dès
// l'entrée dans le menu, ce qui est exactement le comportement voulu.
await wait(600);
const apres = await page.evaluate(() => ({
  pret: window.__jeu.audio.pret,
  etat: window.__jeu.audio.ctx?.state,
  categories: Object.keys(window.__jeu.audio.gains ?? {}),
  musique: !!window.__jeu.audio.musique,
}));
check('le contexte démarre au premier geste', apres.pret === true, `état ${apres.etat}`);
check('une chaîne de gain par catégorie',
  apres.categories.length === 4 && apres.categories.includes('moteur'), apres.categories.join(', '));
check('la musique du menu tourne', apres.musique === true);

console.log('\n=== Curseurs de volume ===');
await page.evaluate(() => [...document.querySelectorAll('[data-action]')]
  .find((b) => b.dataset.action === 'parametres' && b.offsetParent)?.click());
await page.waitForSelector('#ecran-parametres.actif', { timeout: 6000 });
const curseurs = await page.evaluate(() => document.querySelectorAll('#reglages-volumes input[type="range"]').length);
check('cinq curseurs de volume', curseurs === 5, `${curseurs}`);

await page.evaluate(() => {
  const c = document.getElementById('vol-moteur');
  c.value = '20';
  c.dispatchEvent(new Event('input', { bubbles: true }));
});
await wait(300);
const applique = await page.evaluate(() => ({
  gain: window.__jeu.audio.gains.moteur.gain.value,
  affiche: document.getElementById('vol-moteur-valeur').textContent,
  enregistre: (() => {
    for (const cle of Object.keys(localStorage)) {
      const lu = JSON.parse(localStorage.getItem(cle) ?? '{}');
      if (lu?.volumes?.moteur !== undefined) return lu.volumes.moteur;
    }
    return undefined;
  })(),
}));
check('le curseur agit immédiatement sur le gain',
  Math.abs(applique.gain - 0.2) < 0.001, `gain ${applique.gain}`);
check('la valeur est affichée et enregistrée',
  applique.affiche === '20' && applique.enregistre === 20, `affiché ${applique.affiche}, stocké ${applique.enregistre}`);

console.log('\n=== Moteur en course ===');
await page.evaluate(() => [...document.querySelectorAll('[data-action]')]
  .find((b) => b.dataset.action === 'retour-menu' && b.offsetParent)?.click());
await page.evaluate(() => [...document.querySelectorAll('[data-action]')]
  .find((b) => b.dataset.action === 'grand-prix' && b.offsetParent)?.click());
await wait(400);
await page.evaluate(() => [...document.querySelectorAll('[data-action]')]
  .find((b) => b.dataset.action === 'mode-solo' && b.offsetParent)?.click());
await wait(500);
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find((b) => b.offsetParent && b.textContent.includes('Lancer'))?.click());
await page.waitForSelector('#ecran-course.actif', { timeout: 20000 });
// Le rendu logiciel de ce conteneur tourne à quelques images par seconde :
// le compte à rebours y prend bien plus longtemps qu'en conditions réelles.
await page.waitForFunction(() => window.__jeu?.course?.phase === 'course', { timeout: 90000 });
await wait(1500);

const enCourse = await page.evaluate(() => ({
  moteur: !!window.__jeu.audio.moteur,
  frequence: window.__jeu.audio.moteur?.grave.frequency.value ?? 0,
  vent: !!window.__jeu.audio.vent,
  musique: !!window.__jeu.audio.musique,
}));
check('le moteur tourne pendant la course', enCourse.moteur === true, `${enCourse.frequence.toFixed(0)} Hz`);
check('le vent est en place', enCourse.vent === true);
check('la musique du circuit a remplacé celle du menu', enCourse.musique === true);

console.log(`\n${ok}/${ok + ko} vérifications passées`);
await navigateur.close();
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
