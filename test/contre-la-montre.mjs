// Contre-la-montre : format des fantômes, atteignabilité des médailles sur
// quatre tours, et bout en bout côté serveur (enregistrement du record, relecture
// du fantôme, intermédiaires).
//
// Le pilote est un bot difficile qui tourne avec la physique partagée : c'est le
// même code que dans le navigateur, donc un tour réalisable ici est réalisable
// en jeu.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Enregistreur, decodeFantome, encodeFantome, HZ_FANTOME, TAILLE_MAX } from '../shared/fantome.js';
import { creerVoiture, pasPhysique } from '../shared/physics.js';
import { creerBot, entreesBot } from '../shared/bots.js';
import { parametresVoiture } from '../shared/cars.js';
import { placeGrille } from '../shared/track.js';
import { COURSE } from '../shared/config.js';
import { medaillePourTemps, ORDRE_MEDAILLES } from '../shared/economy.js';
import { circuit as chargeCircuit, ligneCourse, ORDRE } from '../server/circuits.js';

let ok = 0, ko = 0;
const check = (l, c, d = '') => { c ? ok++ : ko++; console.log(`  ${c ? 'OK   ' : 'ÉCHEC'} ${l}${d ? '  — ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const chrono = (t) => (t == null ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`);

// ---------------------------------------------------------------------------
console.log('=== Format des fantômes ===');

const enr = new Enregistreur();
for (let i = 0; i <= 60 * 60; i++) {
  const t = i / 60;
  const a = t * 0.12;
  enr.echantillonne(t, {
    pos: { x: Math.cos(a) * 250, y: 8 + Math.sin(a * 3) * 4, z: Math.sin(a) * 250 },
    avant: { x: -Math.sin(a), y: 0, z: Math.cos(a) },
    haut: { x: 0, y: 1, z: 0 },
  });
}
const texte = enr.encode();
check('un tour d’une minute tient dans la limite de stockage',
  texte && texte.length < TAILLE_MAX, `${texte.length} caractères pour ${enr.nombreEchantillons} échantillons`);
check('cadence d’échantillonnage respectée',
  Math.abs(enr.nombreEchantillons - (60 * HZ_FANTOME + 1)) <= 1, `${enr.nombreEchantillons} échantillons`);

const relu = decodeFantome(texte);
check('durée conservée à la relecture', Math.abs(relu.duree - 60) < 0.1, `${relu.duree.toFixed(2)} s`);

let ecartMax = 0;
for (let t = 0; t <= 60; t += 0.017) {
  const a = t * 0.12;
  const p = relu.poseA(t);
  ecartMax = Math.max(ecartMax,
    Math.hypot(p.pos.x - Math.cos(a) * 250, p.pos.z - Math.sin(a) * 250));
}
check('trajectoire fidèle au décimètre près', ecartMax < 0.25, `écart maximal ${(ecartMax * 100).toFixed(1)} cm`);

// `poseA` réutilise son objet : on copie avant le second appel.
const debutX = relu.poseA(-10).pos.x;
const finY = relu.poseA(1000).pos.y;
const finYBis = relu.poseA(relu.duree).pos.y;
check('hors bornes, on reste sur le premier et le dernier échantillon',
  Math.abs(debutX - 250) < 0.2 && Math.abs(finY - finYBis) < 0.01,
  `début x = ${debutX.toFixed(2)} (250 attendu), fin y = ${finY.toFixed(2)}`);

check('orientation relue normalisable',
  Math.abs(Math.hypot(relu.poseA(30).avant.x, relu.poseA(30).avant.y, relu.poseA(30).avant.z) - 1) < 0.01);

check('entrées invalides rejetées sans exception',
  decodeFantome(null) === null && decodeFantome('') === null &&
  decodeFantome('f1:20:%%%') === null && decodeFantome('f2:20:AAAA') === null);

const court = new Enregistreur();
court.echantillonne(0, { pos: { x: 0, y: 0, z: 0 }, avant: { x: 0, y: 0, z: 1 }, haut: { x: 0, y: 1, z: 0 } });
check('un tour d’un seul échantillon n’est pas encodé', court.encode() === null);

// ---------------------------------------------------------------------------
console.log('\n=== Quatre tours : les médailles sont atteignables ===');

/**
 * Fait tourner un bot difficile et enregistre chaque tour séparément.
 * @returns {{tours:number[], fantomes:(string|null)[], splits:number[][]}}
 */
function sessionBot(circuit, ligne, tours, options = {}) {
  const voiture = options.voiture ?? circuit.voitureFavorite;
  const params = parametresVoiture(voiture, options.niveaux ?? {});
  const etat = creerVoiture(circuit, params, placeGrille(circuit, 0, COURSE.grille), { tours });
  const bot = creerBot(circuit, ligne, options.niveau ?? 'difficile', options.graine ?? 3);

  const dt = 1 / 60;
  const enregistreur = new Enregistreur();
  const fantomes = [];
  let toursVus = 0;

  while (etat.temps < 600 && !etat.progression.termine) {
    pasPhysique(etat, entreesBot(bot, etat, circuit, dt), dt, circuit);

    const debut = etat.progression.tempsTours.reduce((a, b) => a + b, 0);
    if (etat.progression.tempsTours.length > toursVus) {
      // Tour bouclé : on met de côté son fantôme et on repart de zéro.
      toursVus = etat.progression.tempsTours.length;
      fantomes.push(enregistreur.encode());
      enregistreur.reinitialise();
    }
    enregistreur.echantillonne(etat.temps - debut, etat);
  }

  return { tours: etat.progression.tempsTours.slice(), fantomes, etat };
}

const resume = [];
for (const id of ORDRE) {
  const circuit = chargeCircuit(id);
  const session = sessionBot(circuit, ligneCourse(id), COURSE.toursContreLaMontre);
  const lances = session.tours.slice(1);
  const meilleur = lances.length ? Math.min(...lances) : null;
  const medaille = medaillePourTemps(meilleur, circuit.medailles);
  const medailleTour1 = medaillePourTemps(session.tours[0], circuit.medailles);

  resume.push({ id, nom: circuit.nom, tour1: session.tours[0], meilleur, medaille, medailleTour1 });

  check(`${circuit.nom} : un tour lancé décroche une médaille`,
    !!medaille, `tour 1 ${chrono(session.tours[0])} (${medailleTour1 ?? 'aucune médaille'}), ` +
    `meilleur lancé ${chrono(meilleur)} → ${medaille}`);
  check(`${circuit.nom} : le fantôme du meilleur tour est encodable`,
    session.fantomes.filter(Boolean).length >= COURSE.toursContreLaMontre - 1,
    `${session.fantomes.filter(Boolean).length} fantômes sur ${session.fantomes.length} tours`);
}

// C'est ce qui justifie les quatre tours : le platine est calibré sur un tour
// lancé, donc inatteignable depuis l'arrêt.
check('le platine est hors de portée d’un départ arrêté sur les quatre circuits',
  resume.every((r) => r.tour1 > chargeCircuit(r.id).medailles.platine),
  resume.map((r) => `${r.nom} : ${chrono(r.tour1)} > ${chrono(chargeCircuit(r.id).medailles.platine)}`).join(' · '));
check('un tour lancé est plus rapide qu’un départ arrêté partout',
  resume.every((r) => r.meilleur < r.tour1),
  resume.map((r) => `−${(r.tour1 - r.meilleur).toFixed(2)} s`).join(' · '));

// ---------------------------------------------------------------------------
console.log('\n=== Bout en bout côté serveur ===');

const PORT = 3331;
const BASE = `http://127.0.0.1:${PORT}`;
const serveur = spawn('node', ['server/index.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(PORT), JWT_SECRET: 't' },
});
await wait(9000);

let jeton = null;
async function api(chemin, corps, methode = 'POST') {
  const r = await fetch(BASE + chemin, {
    method: corps ? methode : 'GET',
    headers: { 'content-type': 'application/json', ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { statut: r.status, data: await r.json().catch(() => ({})) };
}

const inscription = await api('/api/inscription', { pseudo: 'Chronometre', motDePasse: 'motdepasse' });
jeton = inscription.data.jeton;

// On rejoue la session du canyon pour disposer d'un vrai fantôme.
const canyon = chargeCircuit('canyon');
const session = sessionBot(canyon, ligneCourse('canyon'), COURSE.toursContreLaMontre);
const lances = session.tours.slice(1);
const meilleurIndex = session.tours.indexOf(Math.min(...lances));
const meilleurTemps = session.tours[meilleurIndex];
const fantomeMeilleur = session.fantomes[meilleurIndex];
const splits = [12.5, 26.75, 39.125];

let r = await api('/api/fantome/canyon', null);
check('aucun record : le fantôme est introuvable', r.statut === 404, r.data.erreur);

r = await api('/api/contre-la-montre', {
  circuit: 'canyon', temps: meilleurTemps, voiture: canyon.voitureFavorite,
  niveau: 0, fantome: fantomeMeilleur, splits,
});
check('le tour est enregistré et rapporte des médailles',
  r.statut === 200 && r.data.record === true && !!r.data.medaille,
  `${chrono(meilleurTemps)} → ${r.data.medaille}, ${r.data.gains} crédits`);

r = await api('/api/fantome/canyon', null);
check('le fantôme revient avec le record et les intermédiaires',
  r.statut === 200 && r.data.temps === meilleurTemps &&
  r.data.splits?.length === 3 && r.data.splits[1] === 26.75,
  `${r.data.fantome?.length ?? 0} caractères, splits ${JSON.stringify(r.data.splits)}`);

const relecture = decodeFantome(r.data.fantome);
check('le fantôme stocké se relit à l’identique',
  relecture && Math.abs(relecture.duree - decodeFantome(fantomeMeilleur).duree) < 0.001,
  `${relecture?.duree.toFixed(3)} s relus`);

// Le fantôme doit suivre la piste : on vérifie qu'il reste dans le décor.
let horsPiste = 0;
for (let t = 0; t <= relecture.duree; t += 0.2) {
  const p = relecture.poseA(t);
  if (!Number.isFinite(p.pos.x) || Math.abs(p.pos.y) > 400) horsPiste++;
}
check('la trajectoire relue reste plausible', horsPiste === 0, `${horsPiste} points aberrants`);

// Un fantôme trop lourd ne doit pas passer : la limite est côté serveur aussi.
const enorme = 'f1:20:' + 'A'.repeat(TAILLE_MAX * 2);
r = await api('/api/contre-la-montre', {
  circuit: 'canyon', temps: meilleurTemps - 1, voiture: canyon.voitureFavorite,
  niveau: 0, fantome: enorme, splits,
});
check('un fantôme surdimensionné est tronqué, pas refusé', r.statut === 200 && r.data.record === true);
r = await api('/api/fantome/canyon', null);
check('le fantôme stocké ne dépasse jamais la limite',
  (r.data.fantome?.length ?? 0) <= TAILLE_MAX, `${r.data.fantome?.length} caractères`);

// Les temps cibles ne doivent plus venir du client.
const triche = await api('/api/course/resultat', {
  circuit: 'ville', mode: 'contre-la-montre', position: 1, arrive: true, participants: 1,
  voiture: 'comete', meilleurTour: 300, cibles: { platine: 999, or: 999, argent: 999, bronze: 999 },
  adversaires: [], stats: {},
});
check('des temps cibles envoyés par le client ne donnent aucun défi',
  !triche.data.defis?.some((d) => d.id === 'ville-platine'),
  triche.data.defis?.map((d) => d.nom).join(', ') || 'aucun défi');

console.log('\n  Tours de référence (bot difficile, voiture favorite, sans amélioration) :');
for (const t of resume) {
  console.log(`    ${t.nom.padEnd(22)} départ arrêté ${chrono(t.tour1)}  ` +
    `lancé ${chrono(t.meilleur)}  ${t.medaille}`);
}

console.log(`\n${ok}/${ok + ko} vérifications passées`);
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
