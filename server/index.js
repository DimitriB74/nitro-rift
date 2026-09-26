// Serveur NITRO RIFT.
//
// Il sert le client construit (/dist), les données des circuits, et plus tard
// l'API des comptes et le multijoueur. Il écoute sur process.env.PORT, comme
// l'exige Render.

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { catalogue, DOSSIER_CIRCUITS, circuit } from './circuits.js';
import { GAME_NAME, VERSION } from '../shared/config.js';
import { baseConnectee, connecterBase } from './db.js';
import { brancheAuth } from './auth.js';
import { brancheAdmin } from './admin.js';
import { brancheGarage } from './garage.js';
import { brancheMultijoueur } from './multijoueur.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ICI, '..');
const DIST = path.join(RACINE, 'dist');

const app = express();
app.disable('x-powered-by');
// Render place le service derrière un proxy : sans cela, req.ip vaudrait
// toujours l'adresse du proxy et la limitation des tentatives de connexion
// s'appliquerait à tout le monde d'un coup.
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

// ---------------------------------------------------------------------------
// Santé
// ---------------------------------------------------------------------------
// Render endort le service gratuit après une quinzaine de minutes d'inactivité,
// et le réveil prend jusqu'à une minute. Le client interroge cette route pour
// afficher son écran « Réveil du serveur… ».
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    jeu: GAME_NAME,
    version: VERSION,
    demarreDepuis: Math.round(process.uptime()),
    base: baseConnectee() ? 'mongodb' : 'memoire'
  });
});

// ---------------------------------------------------------------------------
// Comptes et administration
// ---------------------------------------------------------------------------
brancheAuth(app);
brancheAdmin(app);
brancheGarage(app);

// ---------------------------------------------------------------------------
// Circuits
// ---------------------------------------------------------------------------
app.get('/api/circuits', (req, res) => {
  try {
    res.json(catalogue());
  } catch (e) {
    console.error('Catalogue des circuits :', e);
    res.status(500).json({ erreur: 'Impossible de lire les circuits.' });
  }
});

// Les fichiers bruts, lus tels quels par le client comme par le serveur.
app.use('/circuits', express.static(DOSSIER_CIRCUITS, {
  maxAge: '5m',
  setHeaders: (res) => res.setHeader('Content-Type', 'application/json; charset=utf-8')
}));

// ---------------------------------------------------------------------------
// Client construit
// ---------------------------------------------------------------------------
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: '1h' }));
  app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/circuits/')
          || req.path.startsWith('/admin')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('html').send(
      `<h1>${GAME_NAME}</h1>` +
      '<p>Le client n’est pas construit. En développement, ouvrez ' +
      '<a href="http://localhost:5173">http://localhost:5173</a> (Vite). ' +
      'En production, lancez <code>npm run build</code>.</p>'
    );
  });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

// On tente la base AVANT d'écouter : ainsi /health dit la vérité dès la
// première requête, et le client n'affiche pas un état faux au réveil.
await connecterBase(process.env.MONGODB_URI);

const serveur = app.listen(PORT, () => {
  console.log(`  ${GAME_NAME} ${VERSION}`);
  console.log(`  Serveur à l'écoute sur le port ${PORT}`);
  try {
    const noms = catalogue().map((c) => c.id).join(', ');
    console.log(`  Circuits chargés : ${noms}`);
  } catch (e) {
    console.warn('  Aucun circuit lisible. Lancez « npm run tracks ».');
  }
  if (!fs.existsSync(DIST)) {
    console.log('  Client non construit : utilisez « npm run dev » pour développer.');
  }
});

// Socket.io se greffe sur le même serveur HTTP : un seul port, ce qu'exige
// l'offre gratuite de Render.
const io = brancheMultijoueur(serveur);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    serveur.close(() => process.exit(0));
  });
}

export { app, serveur, io };
