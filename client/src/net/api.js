// Dialogue avec l'API du serveur.
//
// Le jeton JWT est conservé en localStorage et rejoué à chaque requête. Le même
// jeton servira à authentifier la connexion Socket.io du multijoueur : un seul
// mécanisme pour l'API et le temps réel.

const CLE_JETON = 'nitrorift.jeton';

let jeton = null;
try {
  jeton = localStorage.getItem(CLE_JETON);
} catch {
  // Navigation privée ou stockage bloqué : on jouera sans reprise de session.
}

export const jetonActuel = () => jeton;

export function poseJeton(nouveau) {
  jeton = nouveau;
  try {
    if (nouveau) localStorage.setItem(CLE_JETON, nouveau);
    else localStorage.removeItem(CLE_JETON);
  } catch { /* stockage indisponible : le jeton reste en mémoire */ }
}

/**
 * Requête JSON. Lève une Error dont le message est celui du serveur, pour
 * pouvoir l'afficher tel quel au joueur.
 */
async function appel(chemin, { methode = 'GET', corps = null } = {}) {
  const entetes = {};
  if (corps) entetes['content-type'] = 'application/json';
  if (jeton) entetes.authorization = `Bearer ${jeton}`;

  const reponse = await fetch(chemin, {
    method: methode,
    headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
    cache: 'no-store',
  });

  let data = {};
  try { data = await reponse.json(); } catch { /* réponse vide */ }

  if (!reponse.ok) {
    // Un jeton périmé ne doit pas laisser le joueur dans un état bancal.
    if (reponse.status === 401) poseJeton(null);
    throw new Error(data.erreur ?? `Erreur ${reponse.status}`);
  }
  return data;
}

export const sante = () => appel('/health');

export async function inscription(pseudo, motDePasse) {
  const data = await appel('/api/inscription', { methode: 'POST', corps: { pseudo, motDePasse } });
  poseJeton(data.jeton);
  return data.profil;
}

export async function connexion(pseudo, motDePasse) {
  const data = await appel('/api/connexion', { methode: 'POST', corps: { pseudo, motDePasse } });
  poseJeton(data.jeton);
  return data.profil;
}

/** Reprise de session au chargement. Rend null si le jeton n'est plus valable. */
export async function reprendSession() {
  if (!jeton) return null;
  try {
    const data = await appel('/api/profil');
    return data.profil;
  } catch {
    return null;
  }
}

export function deconnexion() {
  poseJeton(null);
}
