// Génère les fichiers JSON des circuits dans /shared/tracks.
//
//   npm run tracks
//
// Les circuits sont décrits ici comme une suite de commandes de tracé ; le JSON
// produit est le format que le jeu lit réellement. On peut retoucher le JSON à la
// main, mais relancer ce script l'écrase.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Piste } from './piste-outils.js';
import { construireCircuit } from '../shared/track.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER = path.join(ICI, '..', 'shared', 'tracks');

// ===========================================================================
// Circuit d'essai — sert au développement et aux tests de physique
// ===========================================================================
function circuitTest() {
  const p = new Piste({
    id: 'test',
    nom: 'Circuit d’essai',
    decor: 'test',
    description: 'Ovale court avec un virage relevé, une bosse, une plaque de boost et une plaque de glace.',
    voitureFavorite: 'comete',
    largeurDefaut: 18,
    tours: 3,
    espacement: 18
  });

  p.droite(120, { surface: 'route' });
  p.droite(40, { surface: 'boost' });
  p.droite(60, { surface: 'route' });
  p.virage(180, 75, { devers: -26 });
  p.droite(70);
  p.pente(80, 8);            // bosse : décolle un peu à pleine vitesse
  p.droite(40, { surface: 'glace' });
  p.droite(70, { surface: 'route' });
  p.virage(180, 75, { devers: -26 });
  p.aPlat(60);
  p.raccorde(70);

  return p.ferme();
}

// ===========================================================================
// 1. Canyon désertique — rapide, avantage Tempête
// ===========================================================================
function circuitCanyon() {
  const p = new Piste({
    id: 'canyon',
    nom: 'Canyon désertique',
    decor: 'canyon',
    description: 'Longues lignes droites au fond des gorges, grands virages relevés contre la roche et un saut au-dessus du ravin.',
    voitureFavorite: 'tempete',
    largeurDefaut: 20,
    tours: 3,
    espacement: 22
  });

  // Ligne droite de départ, au fond de la gorge.
  p.droite(420, { bord: 'mur' });
  p.repere('cp1');

  // Grand virage relevé qui épouse la paroi.
  p.virage(-80, 150, { devers: 24, largeur: 19 });
  p.droite(260);

  // Le grand saut au-dessus du ravin : rampe, trou, réception.
  p.tremplin(50, 13);
  p.repere('saut');
  p.tremplin(80, -26, { surface: 'vide', bord: 'ouvert' });
  p.tremplin(50, 13, { surface: 'route', bord: 'mur' });
  p.droite(150);
  p.repere('cp2');

  p.virage(-95, 115, { devers: 26 });
  p.droite(300, { bord: ['mur', 'ouvert'] });   // sable d'un côté
  p.virage(-70, 165, { devers: 20 });
  p.droite(240);
  p.repere('cp3');

  p.virage(-65, 130, { devers: 22 });
  p.droite(210, { bord: ['ouvert', 'mur'] });
  p.aPlat(60);
  p.raccorde(155, { bord: 'mur' });

  return p.ferme();
}

// ===========================================================================
// 2. Ville néon de nuit — technique, avantage Vipère
// ===========================================================================
function circuitVille() {
  const p = new Piste({
    id: 'ville',
    nom: 'Ville néon',
    decor: 'ville',
    description: 'Épingles entre les immeubles, chicanes serrées et une rampe de parking en spirale qui monte sur les toits.',
    voitureFavorite: 'vipere',
    largeurDefaut: 15,
    tours: 3,
    espacement: 16
  });

  p.droite(220);
  p.repere('cp1');

  // Chicane rapide.
  p.virage(35, 55, { devers: -10 });
  p.virage(-60, 48, { devers: 12 });
  p.virage(35, 55, { devers: -10 });
  p.droite(140);

  // Épingle entre deux immeubles.
  p.virage(-165, 26, { devers: 14, largeur: 17 });
  p.droite(180, { largeur: 15 });
  p.repere('cp2');

  // Rampe de parking en spirale : on monte sur les toits.
  p.tremplin(30, 10);
  p.virage(-540, 30, { devers: 22, largeur: 13 });
  p.aPlat(30);
  p.repere('toits');

  // Passage sur les toits, sans garde-corps.
  p.droite(150, { bord: 'ouvert', largeur: 14 });
  p.virage(-90, 45, { devers: 16, bord: 'ouvert' });
  p.droite(120, { surface: 'boost' });
  p.droite(60, { surface: 'route' });
  p.repere('cp3');

  // Descente vers la rue.
  p.tremplin(40, -14);
  p.virage(-120, 52, { devers: 18, bord: 'mur', largeur: 15 });
  p.aPlat(40);

  p.droite(160);
  p.virage(-100, 60, { devers: 16 });
  p.droite(130);
  p.aPlat(60);
  p.raccorde(72);

  return p.ferme();
}

// ===========================================================================
// 3. Stade futuriste — acrobatique, avantage Frelon
// ===========================================================================
function circuitStade() {
  const p = new Piste({
    id: 'stade',
    nom: 'Stade futuriste',
    decor: 'stade',
    description: 'Pistes suspendues dans le vide, loopings, tire-bouchons et murs verticaux, avec des plaques de boost avant chaque figure.',
    voitureFavorite: 'frelon',
    largeurDefaut: 17,
    bordDefaut: 'ouvert',
    tours: 3,
    espacement: 16
  });

  p.droite(180, { bord: 'ouvert' });
  p.repere('cp1');

  // Boost puis premier looping.
  p.droite(60, { surface: 'boost' });
  p.droite(40, { surface: 'route' });
  p.looping(26, { largeur: 15 });
  p.droite(120, { largeur: 17 });

  // Virage relevé suspendu.
  p.virage(-110, 70, { devers: 32 });
  p.droite(90);
  p.repere('cp2');

  // Tire-bouchon.
  p.droite(50, { surface: 'boost' });
  p.tireBouchon(150, 1, 16, { surface: 'route', largeur: 15 });
  p.droite(100, { largeur: 17 });

  // Mur vertical : un virage très serré et presque à 90°.
  p.murVertical(-130, 55);
  p.droite(110);
  p.repere('cp3');

  // Second looping, plus grand.
  p.droite(60, { surface: 'boost' });
  p.looping(30, { surface: 'route', largeur: 15 });
  p.droite(140, { largeur: 17 });

  p.virage(-80, 85, { devers: 26 });
  p.droite(100);
  p.aPlat(60);
  p.raccorde(95);

  return p.ferme();
}

// ===========================================================================
// 4. Montagne enneigée — mixte, avantage Comète
// ===========================================================================
function circuitMontagne() {
  const p = new Piste({
    id: 'montagne',
    nom: 'Montagne enneigée',
    decor: 'montagne',
    description: 'Lacets en montée, tunnel dans la roche, descente vertigineuse et tremplin de saut à ski, avec des plaques de glace.',
    voitureFavorite: 'comete',
    largeurDefaut: 17,
    tours: 3,
    espacement: 18
  });

  p.droite(190);
  p.repere('cp1');

  // Lacets en montée.
  p.tremplin(40, 11);
  p.virage(-150, 34, { devers: 20 });
  p.droite(105);
  p.virage(140, 36, { devers: -20 });
  p.droite(100);
  p.virage(-145, 34, { devers: 20 });
  p.droite(110);
  p.aPlat(40);
  p.repere('cp2');

  // Tunnel dans la roche, avec de la glace à l'abri du soleil.
  p.droite(90, { largeur: 15 });
  p.droite(70, { surface: 'glace', largeur: 15 });
  p.virage(-60, 90, { devers: 18, surface: 'route', largeur: 16 });
  p.droite(80, { largeur: 17 });

  // Tremplin façon saut à ski.
  p.droite(70, { surface: 'boost' });
  p.tremplin(50, 15, { surface: 'route' });
  p.tremplin(90, -30, { surface: 'vide', bord: 'ouvert' });
  p.tremplin(50, 15, { surface: 'neige', bord: 'mur' });
  p.droite(120, { surface: 'route' });
  p.repere('cp3');

  // Descente vertigineuse.
  p.tremplin(50, -16);
  p.virage(-120, 75, { devers: 22 });
  p.droite(140, { surface: 'glace' });
  p.droite(60, { surface: 'route' });
  p.aPlat(50);

  p.virage(-105, 88, { devers: 18 });
  p.droite(120);
  p.aPlat(60);
  p.raccorde(115);

  return p.ferme();
}

// ===========================================================================
// Écriture
// ===========================================================================
const CIRCUITS = [circuitTest, circuitCanyon, circuitVille, circuitStade, circuitMontagne];

fs.mkdirSync(DOSSIER, { recursive: true });

console.log('');
console.log('  Circuit          Points  Longueur   Écart   dY final   Désalignement');
console.log('  ---------------------------------------------------------------------');

for (const fabrique of CIRCUITS) {
  const piste = fabrique();
  const donnees = piste.json();

  // On conserve les médailles déjà calibrées, pour ne pas les perdre à chaque build.
  const chemin = path.join(DOSSIER, `${donnees.id}.json`);
  if (fs.existsSync(chemin)) {
    try {
      const ancien = JSON.parse(fs.readFileSync(chemin, 'utf8'));
      if (ancien.medailles) donnees.medailles = ancien.medailles;
    } catch { /* fichier illisible : on repart de zéro */ }
  }

  fs.writeFileSync(chemin, JSON.stringify(donnees, null, 1));

  // Vérification : le circuit doit être constructible.
  const circuit = construireCircuit(donnees);
  const ecart = piste.ecartFermeture;
  const drapeau = ecart > circuit.longueur * 0.03 ? '  <-- à retoucher' : '';

  console.log(
    `  ${donnees.id.padEnd(15)} ${String(donnees.points.length).padStart(5)}  ` +
    `${circuit.longueur.toFixed(0).padStart(6)} m  ` +
    `${ecart.toFixed(1).padStart(6)} m  ` +
    `${piste.dYFinal.toFixed(1).padStart(7)} m  ` +
    `${piste.desalignement.toFixed(1).padStart(11)}°${drapeau}`
  );
}

console.log('');
console.log(`  Fichiers écrits dans ${path.relative(process.cwd(), DOSSIER)}`);
console.log('');
