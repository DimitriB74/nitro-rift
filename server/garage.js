// Garage et classements : achat de voitures, améliorations, peintures, records.
//
// Chaque route vérifie la possession et l'argent côté serveur. Le client
// n'envoie qu'une intention (« j'améliore l'adhérence de la Vipère ») ; c'est
// ici qu'on décide si c'est possible, et qu'on débite.

import {
  VOITURES, IDS_VOITURES, PEINTURES, PEINTURES_BASE, STATS, NIVEAU_MAX,
  estPeintureBase, niveauxVides,
} from '../shared/cars.js';
import { coutAmelioration } from '../shared/economy.js';
import { exigeAuth } from './auth.js';
import { joueurs, marqueModifie, profilPublic } from './db.js';
import { ORDRE, donneesCircuit } from './circuits.js';
import { appliqueCourse, appliqueGrandPrix, appliqueTour } from './rewards.js';

export function brancheGarage(app) {
  // -------------------------------------------------------------------------
  //  Garage
  // -------------------------------------------------------------------------

  app.post('/api/garage/acheter', exigeAuth, async (req, res) => {
    const { voiture } = req.body ?? {};
    const modele = VOITURES[voiture];
    if (!modele) return res.status(400).json({ erreur: 'Voiture inconnue' });

    const doc = req.joueur;
    if (doc.voitures.includes(voiture)) return res.status(409).json({ erreur: 'Tu la possèdes déjà' });
    if (doc.credits < modele.prix) return res.status(402).json({ erreur: 'Crédits insuffisants' });

    doc.credits -= modele.prix;
    doc.voitures.push(voiture);
    doc.ameliorations = { ...(doc.ameliorations ?? {}), [voiture]: niveauxVides() };
    marqueModifie(doc, 'ameliorations');
    await doc.save();

    res.json({ profil: profilPublic(doc) });
  });

  app.post('/api/garage/ameliorer', exigeAuth, async (req, res) => {
    const { voiture, stat } = req.body ?? {};
    if (!VOITURES[voiture]) return res.status(400).json({ erreur: 'Voiture inconnue' });
    if (!STATS.includes(stat)) return res.status(400).json({ erreur: 'Statistique inconnue' });

    const doc = req.joueur;
    if (!doc.voitures.includes(voiture)) return res.status(403).json({ erreur: 'Tu ne possèdes pas cette voiture' });

    const niveaux = { ...niveauxVides(), ...(doc.ameliorations?.[voiture] ?? {}) };
    const actuel = niveaux[stat] ?? 0;
    if (actuel >= NIVEAU_MAX) return res.status(409).json({ erreur: 'Déjà au niveau maximum' });

    const cout = coutAmelioration(actuel);
    if (doc.credits < cout) return res.status(402).json({ erreur: `Il te manque ${cout - doc.credits} crédits` });

    doc.credits -= cout;
    niveaux[stat] = actuel + 1;
    doc.ameliorations = { ...(doc.ameliorations ?? {}), [voiture]: niveaux };
    marqueModifie(doc, 'ameliorations');
    await doc.save();

    res.json({ profil: profilPublic(doc), cout });
  });

  app.post('/api/garage/peinture', exigeAuth, async (req, res) => {
    const { peinture } = req.body ?? {};
    if (!PEINTURES[peinture]) return res.status(400).json({ erreur: 'Peinture inconnue' });

    const doc = req.joueur;
    // Les peintures de base sont gratuites ; les spéciales se débloquent par
    // les défis, jamais avec des crédits.
    if (!doc.peintures.includes(peinture)) {
      if (!estPeintureBase(peinture)) {
        return res.status(403).json({ erreur: 'Peinture à débloquer par un défi' });
      }
      doc.peintures.push(peinture);
    }

    doc.peintureActive = peinture;
    await doc.save();
    res.json({ profil: profilPublic(doc) });
  });

  app.post('/api/garage/selectionner', exigeAuth, async (req, res) => {
    const { voiture, peinture } = req.body ?? {};
    const doc = req.joueur;

    if (voiture) {
      if (!doc.voitures.includes(voiture)) return res.status(403).json({ erreur: 'Voiture non possédée' });
      doc.voitureActive = voiture;
    }
    if (peinture) {
      if (!doc.peintures.includes(peinture)) return res.status(403).json({ erreur: 'Peinture non débloquée' });
      doc.peintureActive = peinture;
    }
    await doc.save();
    res.json({ profil: profilPublic(doc) });
  });

  // -------------------------------------------------------------------------
  //  Résultats et gains
  // -------------------------------------------------------------------------

  app.post('/api/course/resultat', exigeAuth, async (req, res) => {
    const doc = req.joueur;
    const resultat = appliqueCourse(doc, req.body ?? {});
    await doc.save();
    res.json(resultat);
  });

  app.post('/api/grand-prix/resultat', exigeAuth, async (req, res) => {
    const doc = req.joueur;
    const resultat = appliqueGrandPrix(doc, req.body ?? {});
    await doc.save();
    res.json(resultat);
  });

  app.post('/api/contre-la-montre', exigeAuth, async (req, res) => {
    const { circuit, temps, voiture, niveau, fantome } = req.body ?? {};
    if (!ORDRE.includes(circuit)) return res.status(400).json({ erreur: 'Circuit inconnu' });

    // Les temps cibles viennent du fichier du circuit, calculés par
    // « npm run calibrate ». Le client ne les fournit pas : il pourrait mentir.
    const cibles = donneesCircuit(circuit)?.medailles ?? null;

    const doc = req.joueur;
    const resultat = appliqueTour(doc, { circuit, temps: Number(temps), voiture, niveau, cibles, fantome });
    await doc.save();
    res.json({ ...resultat, cibles });
  });

  // -------------------------------------------------------------------------
  //  Classements
  // -------------------------------------------------------------------------

  app.get('/api/classements/:circuit', async (req, res) => {
    const { circuit } = req.params;
    if (!ORDRE.includes(circuit)) return res.status(404).json({ erreur: 'Circuit inconnu' });

    const tous = await joueurs().find({});
    const lignes = [];

    for (const doc of tous) {
      const record = doc.records?.[circuit];
      if (!record?.temps) continue;
      lignes.push({
        pseudo: doc.pseudo,
        temps: record.temps,
        voiture: record.voiture,
        niveau: record.niveau ?? 0,
        medaille: doc.medailles?.[circuit] ?? null,
      });
    }

    lignes.sort((a, b) => a.temps - b.temps);
    res.json({ circuit, cibles: donneesCircuit(circuit)?.medailles ?? null, lignes: lignes.slice(0, 10) });
  });

  /** Fantôme du record personnel, pour s'affronter soi-même. */
  app.get('/api/fantome/:circuit', exigeAuth, (req, res) => {
    const record = req.joueur.records?.[req.params.circuit];
    if (!record?.fantome) return res.status(404).json({ erreur: 'Aucun fantôme enregistré' });
    res.json({ temps: record.temps, voiture: record.voiture, fantome: record.fantome });
  });

  /** Catalogue du garage : ce que le client affiche, prix compris. */
  app.get('/api/garage', (req, res) => {
    res.json({
      voitures: IDS_VOITURES.map((id) => ({ id, ...VOITURES[id] })),
      peintures: Object.entries(PEINTURES).map(([id, p]) => ({ id, ...p, base: estPeintureBase(id) })),
      stats: STATS,
      niveauMax: NIVEAU_MAX,
      couts: Array.from({ length: NIVEAU_MAX }, (_, i) => coutAmelioration(i)),
    });
  });
}
