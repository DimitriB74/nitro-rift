// Écran de connexion et d'inscription.
//
// Un seul formulaire pour les deux, basculé par des onglets : c'est moins de
// clics et moins de code qu'un écran par cas.
//
// Le mode invité existe pour qu'on puisse essayer le jeu tout de suite, sans
// compte. Rien n'est alors sauvegardé, et le menu le dit clairement.

import { connexion, inscription } from '../net/api.js';

const $ = (id) => document.getElementById(id);

/**
 * Affiche l'écran et rend le profil obtenu, ou null si le joueur choisit de
 * jouer sans compte.
 */
export function demandeConnexion(montre) {
  return new Promise((resolve) => {
    const pseudo = $('auth-pseudo');
    const motDePasse = $('auth-mdp');
    const erreur = $('auth-erreur');
    const aide = $('auth-aide');
    const valider = $('auth-valider');
    const invite = $('auth-invite');
    const onglets = [...$('auth-onglets').querySelectorAll('.segment')];

    let mode = 'connexion';
    let occupe = false;

    const majMode = () => {
      for (const onglet of onglets) onglet.classList.toggle('actif', onglet.dataset.onglet === mode);
      valider.textContent = mode === 'connexion' ? 'Se connecter' : 'Créer le compte';
      motDePasse.autocomplete = mode === 'connexion' ? 'current-password' : 'new-password';
      aide.textContent = mode === 'connexion'
        ? 'Mot de passe oublié ? Demande une réinitialisation à l’administrateur du serveur.'
        : '3 à 16 caractères pour le pseudo (lettres, chiffres, - et _), 6 minimum pour le mot de passe.';
      erreur.textContent = '';
    };

    for (const onglet of onglets) {
      onglet.onclick = () => { mode = onglet.dataset.onglet; majMode(); };
    }

    const soumettre = async () => {
      if (occupe) return;
      erreur.textContent = '';

      const p = pseudo.value.trim();
      const m = motDePasse.value;
      if (!p || !m) { erreur.textContent = 'Renseigne un pseudo et un mot de passe.'; return; }

      occupe = true;
      valider.disabled = true;
      const libelle = valider.textContent;
      valider.textContent = 'Un instant…';

      try {
        const profil = mode === 'connexion' ? await connexion(p, m) : await inscription(p, m);
        nettoie();
        resolve(profil);
      } catch (e) {
        erreur.textContent = e.message;
        occupe = false;
        valider.disabled = false;
        valider.textContent = libelle;
        motDePasse.select();
      }
    };

    const surTouche = (event) => {
      if (event.key === 'Enter') { event.preventDefault(); soumettre(); }
    };

    function nettoie() {
      valider.onclick = null;
      invite.onclick = null;
      pseudo.removeEventListener('keydown', surTouche);
      motDePasse.removeEventListener('keydown', surTouche);
      motDePasse.value = '';
    }

    valider.onclick = soumettre;
    invite.onclick = () => { nettoie(); resolve(null); };
    pseudo.addEventListener('keydown', surTouche);
    motDePasse.addEventListener('keydown', surTouche);

    majMode();
    montre('ecran-connexion');
    pseudo.focus();
  });
}

/** Met à jour le bandeau : crédits visibles seulement si on a un compte. */
export function majBandeau(profil) {
  const bloc = $('credits-joueur');
  const valeur = $('credits-valeur');
  const deconnexion = $('bouton-deconnexion');
  const note = $('note-menu');

  if (profil) {
    bloc.hidden = false;
    valeur.textContent = profil.credits.toLocaleString('fr-FR');
    deconnexion.hidden = false;
    note.textContent = `Connecté en tant que ${profil.pseudo}.`;
  } else {
    bloc.hidden = true;
    deconnexion.hidden = true;
    note.textContent = 'Mode invité : ta progression n’est pas sauvegardée.';
  }
}
