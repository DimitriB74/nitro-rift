// Garage, récompenses, médailles et classements — API seule, sans navigateur.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 3330;
const BASE = `http://127.0.0.1:${PORT}`;
const serveur = spawn('node', ['server/index.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(PORT), JWT_SECRET: 't' },
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const check = (l, c, d = '') => { c ? ok++ : ko++; console.log(`  ${c ? 'OK   ' : 'ÉCHEC'} ${l}${d ? '  — ' + d : ''}`); };
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

const inscription = await api('/api/inscription', { pseudo: 'Pilote', motDePasse: 'motdepasse' });
jeton = inscription.data.jeton;
check('compte créé avec 500 crédits et la Comète',
  inscription.data.profil.credits === 500 && inscription.data.profil.voitures.length === 1);

console.log('\n=== Garage ===');
let r = await api('/api/garage/acheter', { voiture: 'tempete' });
check('achat refusé sans les crédits', r.statut === 402, r.data.erreur);

r = await api('/api/garage/ameliorer', { voiture: 'frelon', stat: 'vitesse' });
check('amélioration refusée sur une voiture non possédée', r.statut === 403, r.data.erreur);

r = await api('/api/garage/ameliorer', { voiture: 'comete', stat: 'inconnue' });
check('statistique inconnue refusée', r.statut === 400, r.data.erreur);

r = await api('/api/garage/ameliorer', { voiture: 'comete', stat: 'vitesse' });
check('première amélioration achetée à 300',
  r.statut === 200 && r.data.cout === 300 && r.data.profil.credits === 200
  && r.data.profil.ameliorations.comete.vitesse === 1,
  `${r.data.profil?.credits} crédits restants`);

r = await api('/api/garage/peinture', { peinture: 'chrome' });
check('peinture spéciale refusée sans le défi', r.statut === 403, r.data.erreur);

console.log('\n=== Récompenses de course ===');
r = await api('/api/course/resultat', {
  circuit: 'canyon', mode: 'course', position: 1, arrive: true, participants: 6,
  voiture: 'comete',
  adversaires: [{ type: 'bot', niveau: 'difficile' }, { type: 'bot', niveau: 'facile' }],
  stats: { derapages: [4, 2, 1], sauts: 1, loopings: 0, reapparitions: 0 },
});
const gains = r.data;
check('victoire contre un bot difficile : place × 1,5',
  gains.multiplicateur === 'difficile' && gains.gains >= 750,
  `${gains.gains} crédits — ${gains.lignes.map((l) => l.libelle).join(', ')}`);
check('le défi « tour propre au Canyon » est validé',
  gains.defis.some((d) => d.id === 'canyon-propre'), gains.defis.map((d) => d.nom).join(', ') || 'aucun');

const plafonne = await api('/api/course/resultat', {
  circuit: 'ville', mode: 'course', position: 1, arrive: true, participants: 2,
  adversaires: [{ type: 'bot', niveau: 'facile' }],
  stats: { derapages: [999, 999, 999], sauts: 999, loopings: 999 },
});
const ligneStyle = plafonne.data.lignes.find((l) => /style/i.test(l.libelle));
check('le bonus de style reste plafonné malgré des chiffres absurdes',
  ligneStyle && ligneStyle.credits === 150, `${ligneStyle?.credits} crédits`);

console.log('\n=== Contre-la-montre et médailles ===');
r = await api('/api/contre-la-montre', { circuit: 'canyon', temps: 52.0, voiture: 'tempete', niveau: 0 });
check('un temps sous le platine donne les quatre médailles',
  r.data.medaille === 'platine' && r.data.lignes.length === 4,
  `${r.data.gains} crédits, ${r.data.lignes.map((l) => l.libelle).join(' + ')}`);

r = await api('/api/contre-la-montre', { circuit: 'canyon', temps: 51.0, voiture: 'tempete', niveau: 0 });
check('un nouveau record ne redonne pas les médailles',
  r.data.record === true && r.data.lignes.length === 1, `${r.data.gains} crédits`);

r = await api('/api/contre-la-montre', { circuit: 'canyon', temps: 90.0, voiture: 'tempete', niveau: 0 });
check('un temps plus lent ne rapporte rien', r.data.gains === 0 && r.data.record === false);

console.log('\n=== Classement ===');
const c = await api('/api/classements/canyon');
check('le classement contient le record', c.data.lignes?.[0]?.pseudo === 'Pilote' && c.data.lignes[0].temps === 51,
  `${c.data.lignes?.[0]?.temps} s avec la ${c.data.lignes?.[0]?.voiture}`);
check('les temps cibles accompagnent le classement', !!c.data.cibles?.platine, JSON.stringify(c.data.cibles));

const inconnu = await api('/api/classements/atlantide');
check('circuit inconnu refusé', inconnu.statut === 404);

console.log('\n=== Achat après avoir gagné ===');
const profil = (await api('/api/profil')).data.profil;
r = await api('/api/garage/acheter', { voiture: 'frelon' });
check('le Frelon devient achetable une fois les crédits gagnés',
  r.statut === 200 && r.data.profil.voitures.includes('frelon'),
  `${profil.credits} crédits avant, ${r.data.profil?.credits ?? '—'} après`);

r = await api('/api/garage/acheter', { voiture: 'frelon' });
check('on ne rachète pas une voiture déjà possédée', r.statut === 409, r.data.erreur);

r = await api('/api/garage/selectionner', { voiture: 'frelon' });
check('la voiture active change', r.data.profil?.voitureActive === 'frelon');

console.log(`\n${ok}/${ok + ko} vérifications passées`);
serveur.kill();
process.exit(ko > 0 ? 1 : 0);
