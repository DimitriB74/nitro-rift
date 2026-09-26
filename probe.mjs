import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 3302;
const SHOTS = process.env.SHOTS;
const server = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT) } });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(1500);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await wait(2000);

const click = async (label) => {
  const ok = await page.evaluate((label) => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && x.textContent.trim().startsWith(label));
    if (b) { b.click(); return true; } return false;
  }, label);
  console.log(`clic « ${label} » :`, ok ? 'ok' : 'INTROUVABLE');
  await wait(900);
};

await click('Grand Prix');
await page.screenshot({ path: `${SHOTS}/nr-02-config.png` });
let btns = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.textContent.trim().slice(0, 28)));
console.log('boutons config :', JSON.stringify(btns));

// Lancer la course
for (const label of ['Lancer', 'Démarrer', 'Commencer', 'Départ', 'Jouer', 'Course']) {
  const done = await page.evaluate((label) => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && x.textContent.trim().toLowerCase().includes(label.toLowerCase()));
    if (b) { b.click(); return b.textContent.trim(); } return null;
  }, label);
  if (done) { console.log('lancement via :', done); break; }
}
await wait(4000);
await page.screenshot({ path: `${SHOTS}/nr-03-depart.png` });

// Conduire : accélérer 6 s
await page.keyboard.down('KeyW');
await wait(6000);
const mid = await page.evaluate(() => ({
  vitesse: document.getElementById('hud-vitesse')?.textContent,
  position: document.getElementById('hud-position')?.textContent,
  tour: document.getElementById('hud-tour')?.textContent,
  chrono: document.getElementById('hud-chrono')?.textContent,
  nitro: document.getElementById('hud-nitro')?.style?.width,
}));
await page.screenshot({ path: `${SHOTS}/nr-04-course.png` });
await page.keyboard.up('KeyW');
console.log('HUD en course :', JSON.stringify(mid));

// Dérapage
await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD'); await page.keyboard.down('Space');
await wait(2500);
const drift = await page.evaluate(() => ({ derapage: document.getElementById('hud-derapage')?.className, vitesse: document.getElementById('hud-vitesse')?.textContent }));
await page.screenshot({ path: `${SHOTS}/nr-05-derapage.png` });
await page.keyboard.up('Space'); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
console.log('dérapage :', JSON.stringify(drift));

const fps = await page.evaluate(() => document.getElementById('hud-fps')?.textContent);
console.log('fps :', fps);
console.log('erreurs :', errors.length ? errors.slice(0, 4) : 'aucune');
await browser.close(); server.kill();
