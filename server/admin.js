// Page d'administration.
//
// Il n'y a pas d'envoi d'e-mail dans ce jeu, donc pas de « mot de passe
// oublié » automatique. Cette page, protégée par ADMIN_KEY, permet de
// réinitialiser le mot de passe d'un joueur à la main.
//
// Elle est volontairement minimale et sans dépendance : une page HTML servie
// telle quelle, et deux routes.

import bcrypt from 'bcryptjs';
import { baseConnectee, joueurs } from './db.js';

function cleValide(req) {
  const attendue = process.env.ADMIN_KEY;
  if (!attendue) return false; // sans clé configurée, la page reste fermée
  const fournie = req.get('x-admin-key') ?? req.query.cle ?? (req.body ?? {}).cle;
  return fournie === attendue;
}

const PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>NITRO RIFT — administration</title>
<style>
  body { font: 15px system-ui, sans-serif; background: #12141a; color: #e8ecf2;
         display: grid; place-items: center; min-height: 100vh; margin: 0; }
  form { background: #1b1f28; padding: 26px 28px; border-radius: 12px; width: 340px;
         border: 1px solid #2c3240; }
  h1 { font-size: 17px; letter-spacing: .1em; margin: 0 0 18px; }
  label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .1em;
          color: #8791a0; margin: 12px 0 5px; }
  input { width: 100%; padding: 9px 11px; border-radius: 7px; border: 1px solid #2c3240;
          background: #11141b; color: #e8ecf2; font: 14px system-ui; }
  button { width: 100%; margin-top: 18px; padding: 11px; border: 0; border-radius: 7px;
           background: #f0a13c; color: #1a1207; font-weight: 700; cursor: pointer; }
  #res { margin-top: 14px; font: 12px ui-monospace, monospace; min-height: 18px; }
</style></head><body>
<form id="f">
  <h1>NITRO RIFT — administration</h1>
  <label>Clé d'administration</label><input id="cle" type="password" autocomplete="off">
  <label>Pseudo du joueur</label><input id="pseudo" autocomplete="off">
  <label>Nouveau mot de passe</label><input id="mdp" type="text" autocomplete="off">
  <button type="submit">Réinitialiser</button>
  <div id="res"></div>
</form>
<script>
document.getElementById('f').onsubmit = async (e) => {
  e.preventDefault();
  const res = document.getElementById('res');
  res.textContent = '…';
  const r = await fetch('/admin/reinitialiser', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      cle: document.getElementById('cle').value,
      pseudo: document.getElementById('pseudo').value,
      motDePasse: document.getElementById('mdp').value,
    }),
  });
  const data = await r.json();
  res.style.color = r.ok ? '#7ddb92' : '#ff8b4a';
  res.textContent = r.ok ? 'Mot de passe réinitialisé.' : (data.erreur ?? 'Erreur');
};
</script></body></html>`;

export function brancheAdmin(app) {
  app.get('/admin', (req, res) => {
    res.type('html').send(PAGE);
  });

  app.post('/admin/reinitialiser', async (req, res) => {
    if (!cleValide(req)) {
      return res.status(403).json({ erreur: "Clé d'administration invalide ou ADMIN_KEY non configurée" });
    }

    const { pseudo = '', motDePasse = '' } = req.body ?? {};
    if (motDePasse.length < 6) {
      return res.status(400).json({ erreur: 'Mot de passe trop court (6 caractères minimum)' });
    }

    const doc = await joueurs().findOne({ pseudoMinuscule: String(pseudo).trim().toLowerCase() });
    if (!doc) return res.status(404).json({ erreur: 'Joueur introuvable' });

    doc.motDePasseHash = await bcrypt.hash(motDePasse, 10);
    await doc.save();

    console.log(`  [admin] mot de passe réinitialisé pour ${doc.pseudo}`);
    res.json({ ok: true, persistant: baseConnectee() });
  });
}
