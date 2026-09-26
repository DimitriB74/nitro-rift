// Contre-la-montre dans un vrai navigateur : chargement du fantôme, relecture,
// enregistrement du tour et écran de résultats.
//
// Le conteneur n'a pas de GPU (rendu logiciel, quelques images par seconde) :
// on ne juge donc pas la conduite, on vérifie le câblage. La physique est
// avancée à la main par petits pas, ce qui ne dépend pas de la cadence d'écran.

import { demarreServeur } from './aide.mjs';
import { chromium } from 'playwright';

import { Enregistreur, decodeFantome } from '../shared/fantome.js';
import { creerVoiture, pasPhysique } from '../shared/physics.js';
import { creerBot, entreesBot } from '../shared/bots.js';
import { parametresVoiture } from '../shared/cars.js';
import { placeGrille } from '../shared/track.js';
import { COURSE } from '../shared/config.js';
import { circuit as chargeCircuit, ligneCourse } from '../server/circuits.js';

const PORT = 3341;
const ADRESSE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS ?? '/tmp';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const check = (l, c, d = '') => { c ? ok++ : ko++; console.log(`  ${c ? 'OK   ' : 'ÉCHEC'} ${l}${d ? '  — ' + d : ''}`); };

// --- Un vrai fantôme, produit par un bot sur le canyon ----------------------
const canyon = chargeCircuit('canyon');
function tourDeBot() {
  const params = parametresVoiture(canyon.voitureFavorite, {});
  const etat = creerVoiture(canyon, params, placeGrille(canyon, 0, COURSE.grille), { tours: 2 });
  const bot = creerBot(canyon, ligneCourse('canyon'), 'difficile', 3);
  const enr = new Enregistreur();
  const dt = 1 / 60;
  let tours = 0;
  let fantome = null;
  let temps = null;

  while (etat.temps < 300 && tours < 2) {
    pasPhysique(etat, entreesBot(bot, etat, canyon, dt), dt, canyon);
    const debut = etat.progression.tempsTours.reduce((a, b) => a + b, 0);
    if (etat.progression.tempsTours.length > tours) {
      tours = etat.progression.tempsTours.length;
      if (tours === 1) { fantome = enr.encode(); temps = etat.progression.tempsTours[0]; }
      enr.reinitialise();
    }
    enr.echantillonne(etat.temps - debut, etat);
  }
  return { fantome, temps };
}
const record = tourDeBot();
const dureeRecord = decodeFantome(record.fantome).duree;
console.log(`  fantôme de référence : ${record.temps.toFixed(3)} s, ${record.fantome.length} caractères`);

const serveur = await demarreServeur(PORT);

const navigateur = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await navigateur.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('  ERREUR PAGE :', e.message));

await page.goto(ADRESSE, { waitUntil: 'networkidle' });
await page.waitForSelector('#ecran-connexion.actif', { timeout: 20000 });
await page.click('[data-onglet="inscription"]');
await page.fill('#auth-pseudo', 'Chrono');
await page.fill('#auth-mdp', 'motdepasse');
await page.click('#auth-valider');
await page.waitForSelector('#ecran-menu.actif', { timeout: 15000 });

const clic = (a) => page.evaluate((x) =>
  [...document.querySelectorAll('[data-action]')].find((b) => b.dataset.action === x && b.offsetParent)?.click(), a);

// --- On dépose un record avec fantôme, comme si le joueur l'avait fait ------
console.log('\n=== Enregistrement du record de référence ===');
const depot = await page.evaluate(async ({ fantome, temps }) => {
  const jeton = localStorage.getItem('nitrorift.jeton');
  const r = await fetch('/api/contre-la-montre', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
    body: JSON.stringify({
      circuit: 'canyon', temps, voiture: 'comete', niveau: 0, fantome,
      splits: [13.2, 27.4, 40.1],
    }),
  });
  return { statut: r.status, data: await r.json() };
}, record);
check('le record est accepté par le serveur',
  depot.statut === 200 && depot.data.record === true,
  `${depot.data.medaille ?? 'aucune médaille'}, ${depot.data.gains} crédits`);

// --- Configuration du contre-la-montre -------------------------------------
console.log('\n=== Écran de configuration ===');
await clic('contre-la-montre');
await page.waitForSelector('#ecran-mode.actif', { timeout: 6000 });
await clic('mode-solo');
await page.waitForSelector('#ecran-config.actif', { timeout: 6000 });

const config = await page.evaluate(() => ({
  titre: document.getElementById('config-titre').textContent,
  adversaires: document.getElementById('panneau-adversaires').hidden,
  circuits: document.getElementById('panneau-circuit').hidden,
  note: document.getElementById('config-note').textContent,
  bouton: document.querySelector('[data-action="lancer"]').textContent,
}));
check('le contre-la-montre masque les adversaires et garde le choix du circuit',
  config.adversaires === true && config.circuits === false, config.titre);
check('le nombre de tours est annoncé au joueur',
  config.note.includes(String(COURSE.toursContreLaMontre)) && /fantôme/i.test(config.note),
  config.note.slice(0, 80) + '…');

// --- Lancement -------------------------------------------------------------
console.log('\n=== Session ===');
await page.evaluate(() => document.querySelector('#liste-circuits [data-circuit="canyon"]')?.click());
await clic('lancer');
await page.waitForSelector('#ecran-course.actif', { timeout: 40000 });
await page.waitForFunction(() => window.__jeu?.fantome != null, { timeout: 20000 });

const session = await page.evaluate(() => ({
  tours: window.__jeu.course.tours,
  mode: window.__jeu.course.mode,
  participants: window.__jeu.course.participants.length,
  dureeFantome: window.__jeu.fantome.duree,
  recordTemps: window.__jeu.record?.temps ?? null,
  objet: !!window.__jeu.objetFantome && window.__jeu.objetFantome.parent === window.__jeu.scene,
  splitsReference: window.__jeu.meilleursSplits.get('canyon') ?? null,
}));
check(`la session dure ${COURSE.toursContreLaMontre} tours, seul en piste`,
  session.tours === COURSE.toursContreLaMontre && session.participants === 1 &&
  session.mode === 'contre-la-montre', `${session.tours} tours, ${session.participants} voiture`);
check('le fantôme du record est chargé et ajouté à la scène',
  session.objet === true && Math.abs(session.dureeFantome - dureeRecord) < 0.01,
  `${session.dureeFantome.toFixed(3)} s relus, record ${session.recordTemps?.toFixed(3)} s`);
check('les intermédiaires du record servent de référence au HUD',
  Array.isArray(session.splitsReference) && session.splitsReference[1] === 27.4,
  JSON.stringify(session.splitsReference));

// Le fantôme doit se déplacer avec le temps de tour, pas avec l'horloge d'écran.
const deplacement = await page.evaluate(() => {
  const jeu = window.__jeu;
  const lis = () => {
    const p = jeu.objetFantome.position;
    return [p.x, p.y, p.z];
  };
  jeu.course.phase = 'course';
  jeu.course.moi.etat.temps = 0;
  jeu.majContreLaMontre();
  const debut = lis();
  jeu.course.moi.etat.temps = 20;
  jeu.majContreLaMontre();
  const vingt = lis();
  jeu.course.moi.etat.temps = 20;
  jeu.majContreLaMontre();
  const encore = lis();
  const attendu = jeu.fantome.poseA(20).pos;
  return { debut, vingt, encore, attendu: [attendu.x, attendu.y, attendu.z] };
});
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
check('le fantôme avance avec le chronomètre du tour',
  distance(deplacement.debut, deplacement.vingt) > 50,
  `${distance(deplacement.debut, deplacement.vingt).toFixed(1)} m parcourus en 20 s`);
check('le fantôme est posé exactement sur sa trajectoire',
  distance(deplacement.vingt, deplacement.attendu) < 1.2,
  `${(distance(deplacement.vingt, deplacement.attendu) * 100).toFixed(0)} cm d’écart (hauteur de caisse comprise)`);
check('à temps égal, le fantôme ne bouge pas',
  distance(deplacement.vingt, deplacement.encore) < 0.001);

// --- Enregistrement de notre propre trajectoire ----------------------------
const enregistrement = await page.evaluate(() => {
  const jeu = window.__jeu;
  jeu.course.phase = 'course';
  jeu.course.moi.etat.temps = 0;
  jeu.enregistreur.reinitialise();

  // Deux secondes de plein gaz, pas par pas : indépendant de la cadence écran.
  const entrees = { accel: 1, frein: 0, direction: 0, derapage: false, nitro: false };
  for (let i = 0; i < 120; i++) {
    jeu.course.maj(1 / 60, entrees);
    jeu.majContreLaMontre();
  }
  return {
    echantillons: jeu.enregistreur.nombreEchantillons,
    vitesse: jeu.course.moi.etat.vitesseScalaire,
    encode: (jeu.enregistreur.encode() ?? '').slice(0, 3),
  };
});
check('notre tour est échantillonné pendant la conduite',
  enregistrement.echantillons >= 39 && enregistrement.echantillons <= 42,
  `${enregistrement.echantillons} échantillons pour 2 s à 20 Hz`);
check('la voiture a bien roulé pendant l’enregistrement',
  enregistrement.vitesse > 10, `${(enregistrement.vitesse * 3.6).toFixed(0)} km/h`);
check('l’enregistrement s’encode au format attendu', enregistrement.encode === 'f1:');
await page.screenshot({ path: `${SHOTS}/nr-14-contre-la-montre.png` });

// --- Écran de résultats ----------------------------------------------------
console.log('\n=== Résultats ===');
const meilleur = record.temps - 1.5;   // on bat le record de 1,5 s
await page.evaluate(({ temps, fantome }) => {
  const jeu = window.__jeu;
  jeu.course.moi.etat.progression.tempsTours = [temps + 2.4, temps, temps + 0.8, temps + 1.1];
  jeu.sessionMeilleur = { temps, splits: [12.9, 26.8, 39.4], fantome };
  jeu.termine();
}, { temps: meilleur, fantome: record.fantome });

await page.waitForSelector('#ecran-resultats.actif', { timeout: 8000 });
await page.waitForFunction(
  () => /Record personnel battu|non enregistré/.test(document.getElementById('resultats-credits')?.innerHTML ?? ''),
  { timeout: 15000 });

const resultats = await page.evaluate(() => ({
  titre: document.getElementById('resultats-titre').textContent,
  entetes: [...document.querySelectorAll('#resultats-entetes th')].map((t) => t.textContent),
  lignes: document.querySelectorAll('#resultats-corps tr').length,
  paliers: document.querySelectorAll('.paliers-medailles .palier').length,
  atteints: document.querySelectorAll('.paliers-medailles .palier.atteint').length,
  credits: document.getElementById('resultats-credits').textContent,
  gp: document.getElementById('resultats-gp').hidden,
  bandeau: document.getElementById('credits-valeur').textContent,
}));
check('l’écran de résultats liste les quatre tours',
  resultats.lignes === 4 && resultats.entetes[4] === 'Écart',
  `${resultats.lignes} lignes, en-têtes ${resultats.entetes.join('/')}`);
check('les quatre paliers de médailles sont affichés',
  resultats.paliers === 4 && resultats.atteints >= 1,
  `${resultats.atteints} atteints sur ${resultats.paliers}`);
check('le tableau du championnat reste masqué', resultats.gp === true);
check('le record battu est annoncé et le fantôme mis à jour',
  /Record personnel battu/.test(resultats.credits), resultats.credits.trim().slice(0, 90));
await page.screenshot({ path: `${SHOTS}/nr-15-resultats-tour.png` });

// Le serveur doit avoir gardé le nouveau temps.
const apres = await page.evaluate(async () => {
  const jeton = localStorage.getItem('nitrorift.jeton');
  const r = await fetch('/api/fantome/canyon', { headers: { authorization: `Bearer ${jeton}` } });
  const d = await r.json();
  return { temps: d.temps, splits: d.splits, taille: d.fantome?.length ?? 0 };
});
check('le serveur a enregistré le nouveau record et ses intermédiaires',
  Math.abs(apres.temps - meilleur) < 0.001 && apres.splits?.[0] === 12.9 && apres.taille > 1000,
  `${apres.temps.toFixed(3)} s, splits ${JSON.stringify(apres.splits)}, fantôme ${apres.taille} caractères`);

console.log(`\n${ok}/${ok + ko} vérifications passées`);
await navigateur.close();
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
