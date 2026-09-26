// Outils communs aux tests : démarrage du serveur et comptage des résultats.
//
// Le serveur met quelques secondes à calculer ses temps de référence. On attend
// donc qu'il réponde vraiment plutôt qu'un délai fixe, et on le tue quoi qu'il
// arrive — un serveur oublié garde son port et fait échouer le test suivant
// pour une raison totalement trompeuse.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/**
 * Démarre le serveur et attend qu'il réponde.
 *
 * @param {number} port
 * @param {object} [env]  variables supplémentaires
 * @returns {Promise<import('node:child_process').ChildProcess>}
 */
export async function demarreServeur(port, env = {}) {
  const serveur = spawn('node', ['server/index.js'], {
    cwd: RACINE,
    env: { ...process.env, PORT: String(port), JWT_SECRET: 't', ...env },
  });

  let sorti = null;
  serveur.on('exit', (code) => { sorti = code; });
  serveur.stderr.on('data', (d) => process.stderr.write(`  [serveur] ${d}`));

  // On tue le serveur même si le test explose : sinon le port reste pris.
  const tue = () => { try { serveur.kill(); } catch { /* déjà mort */ } };
  process.on('exit', tue);
  process.on('uncaughtException', (e) => { console.error(e); tue(); process.exit(1); });
  process.on('unhandledRejection', (e) => { console.error(e); tue(); process.exit(1); });

  const limite = Date.now() + 40000;
  while (Date.now() < limite) {
    if (sorti !== null) throw new Error(`le serveur s'est arrêté au démarrage (code ${sorti}) — port ${port} déjà pris ?`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return serveur;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  tue();
  throw new Error(`le serveur n'a pas répondu sur le port ${port}`);
}

/** Compteur de vérifications, au format commun à tous les tests. */
export function compteur() {
  let ok = 0, ko = 0;
  return {
    check(libelle, condition, detail = '') {
      condition ? ok++ : ko++;
      console.log(`  ${condition ? 'OK   ' : 'ÉCHEC'} ${libelle}${detail ? '  — ' + detail : ''}`);
    },
    bilan() {
      console.log(`\n${ok}/${ok + ko} vérifications passées`);
      return ko;
    },
  };
}

export const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
