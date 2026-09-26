// Garage et classements.
//
// Aucune règle ici non plus : chaque achat part au serveur, qui décide et
// renvoie le profil à jour. L'écran se contente de le réafficher. Un client
// modifié ne peut donc pas s'offrir une voiture.

import { VOITURES, IDS_VOITURES, PEINTURES, STATS, LIBELLES_STATS, NIVEAU_MAX, statEffective } from '@shared/cars.js';
import { coutAmelioration } from '@shared/economy.js';
import { echappe, formateChrono, nomVoiture } from './hud.js';

const $ = (id) => document.getElementById(id);

async function poste(chemin, corps, jeton) {
  const reponse = await fetch(chemin, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    body: JSON.stringify(corps),
  });
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(data.erreur ?? `Erreur ${reponse.status}`);
  return data;
}

export class Garage {
  /**
   * @param {() => string|null} jeton      accès au jeton courant
   * @param {(profil) => void}  surProfil  appelé à chaque changement
   * @param {object} [showroom]  { montre, demarre, arrete } — la vue 3D, si elle
   *                             a pu être créée (WebGL peut manquer)
   * @param {object} [modeles]   modèles glTF déjà chargés, par voiture
   */
  constructor(jeton, surProfil, showroom = null, modeles = {}) {
    this.jeton = jeton;
    this.surProfil = surProfil;
    this.showroom = showroom;
    this.modeles = modeles;
    this.profil = null;
    this.selection = null;
    this.exposee = null;          // ce que le showroom montre actuellement

    $('garage-action').onclick = () => this.action();
  }

  ouvre(profil) {
    this.profil = profil;
    this.selection = profil?.voitureActive ?? IDS_VOITURES[0];
    this.affiche();
    this.showroom?.demarre();
  }

  ferme() {
    this.showroom?.arrete();
  }

  /**
   * Met la voiture sélectionnée sur le plateau, avec la peinture active.
   * On ne reconstruit le modèle que si quelque chose a changé : le showroom
   * tourne en continu, il ne faut pas recréer la voiture à chaque affichage.
   */
  majShowroom() {
    if (!this.showroom) return;
    const peinture = this.profil?.peintureActive ?? 'rouge';
    if (this.exposee?.voiture === this.selection && this.exposee?.peinture === peinture) return;

    this.exposee = { voiture: this.selection, peinture };
    this.showroom.montre(this.selection, peinture, this.modeles?.[this.selection] ?? null);
  }

  erreur(message) {
    $('garage-erreur').textContent = message ?? '';
  }

  possede(id) {
    return this.profil?.voitures.includes(id) ?? false;
  }

  niveaux(id) {
    const vides = Object.fromEntries(STATS.map((s) => [s, 0]));
    return { ...vides, ...(this.profil?.ameliorations?.[id] ?? {}) };
  }

  affiche() {
    if (!this.profil) return;
    $('garage-credits').textContent = this.profil.credits.toLocaleString('fr-FR');

    // --- liste des voitures -------------------------------------------------
    $('garage-liste').innerHTML = IDS_VOITURES.map((id) => {
      const v = VOITURES[id];
      const etat = this.possede(id)
        ? (this.profil.voitureActive === id ? 'active' : 'possédée')
        : `${v.prix} ¤`;
      return `<button data-voiture="${id}" class="${id === this.selection ? 'actif' : ''}">
        ${echappe(v.nom)}<br><small style="opacity:.6">${etat}</small></button>`;
    }).join('');

    for (const bouton of $('garage-liste').querySelectorAll('[data-voiture]')) {
      bouton.onclick = () => { this.selection = bouton.dataset.voiture; this.erreur(''); this.affiche(); };
    }

    // --- peintures ----------------------------------------------------------
    $('garage-peintures').innerHTML = Object.entries(PEINTURES).map(([id, p]) => {
      const debloquee = this.profil.peintures.includes(id);
      const classes = [
        this.profil.peintureActive === id ? 'actif' : '',
        debloquee ? '' : 'verrouille',
      ].filter(Boolean).join(' ');
      return `<button data-peinture="${id}" class="${classes}"
        style="background:${p.couleur ?? '#888'}" title="${echappe(p.nom)}${debloquee ? '' : ' — à débloquer'}"></button>`;
    }).join('');

    for (const bouton of $('garage-peintures').querySelectorAll('[data-peinture]')) {
      bouton.onclick = async () => {
        if (bouton.classList.contains('verrouille')) {
          this.erreur('Cette peinture se débloque en réussissant un défi.');
          return;
        }
        await this.envoie('/api/garage/peinture', { peinture: bouton.dataset.peinture });
      };
    }

    this.majShowroom();
    this.afficheDetail();
  }

  afficheDetail() {
    const id = this.selection;
    const v = VOITURES[id];
    const niveaux = this.niveaux(id);
    const possedee = this.possede(id);

    $('garage-nom').textContent = v.nom;
    $('garage-profil').textContent = v.description ?? v.profil ?? '';

    $('garage-stats').innerHTML = STATS.map((stat) => {
      const base = v.stats[stat];
      const total = statEffective(id, stat, niveaux[stat]);
      const bonus = Math.max(0, total - base);
      const niveau = niveaux[stat];
      const cout = coutAmelioration(niveau);

      // Deux couleurs : la valeur de base et ce que les améliorations ajoutent.
      // On voit ainsi d'un coup d'œil ce qui vient de la voiture et ce qui vient
      // de l'argent dépensé.
      return `<div class="stat-ligne">
        <div class="stat-entete">
          <span>${LIBELLES_STATS[stat] ?? stat}</span>
          <span class="niveau">${total.toFixed(1)}/10 · niv. ${niveau}/${NIVEAU_MAX}</span>
        </div>
        <div class="stat-barre">
          <i class="base" style="width:${(base / 10) * 100}%"></i>
          <i class="bonus" style="width:${(bonus / 10) * 100}%"></i>
        </div>
        ${possedee && cout !== null
          ? `<button data-stat="${stat}" ${this.profil.credits < cout ? 'disabled' : ''}>Améliorer — ${cout} ¤</button>`
          : possedee ? '<button disabled>Niveau maximum</button>' : ''}
      </div>`;
    }).join('');

    for (const bouton of $('garage-stats').querySelectorAll('[data-stat]')) {
      bouton.onclick = () => this.envoie('/api/garage/ameliorer', { voiture: id, stat: bouton.dataset.stat });
    }

    const action = $('garage-action');
    if (!possedee) {
      action.textContent = `Acheter — ${v.prix} ¤`;
      action.disabled = this.profil.credits < v.prix;
    } else if (this.profil.voitureActive === id) {
      action.textContent = 'Voiture active';
      action.disabled = true;
    } else {
      action.textContent = 'Choisir cette voiture';
      action.disabled = false;
    }
  }

  action() {
    const id = this.selection;
    if (!this.possede(id)) return this.envoie('/api/garage/acheter', { voiture: id });
    return this.envoie('/api/garage/selectionner', { voiture: id });
  }

  async envoie(chemin, corps) {
    this.erreur('');
    try {
      const data = await poste(chemin, corps, this.jeton());
      this.profil = data.profil;
      this.surProfil(data.profil);
      this.affiche();
    } catch (e) {
      this.erreur(e.message);
    }
  }
}

// ---------------------------------------------------------------------------
//  Classements
// ---------------------------------------------------------------------------

export class Classements {
  constructor(circuits, pseudo) {
    this.circuits = circuits;
    this.pseudo = pseudo;
    this.circuit = circuits[0]?.id ?? 'canyon';
  }

  async ouvre() {
    $('classements-circuits').innerHTML = this.circuits.map((c) =>
      `<button data-circuit="${c.id}" class="${c.id === this.circuit ? 'actif' : ''}">${echappe(c.nom)}</button>`).join('');

    for (const bouton of $('classements-circuits').querySelectorAll('[data-circuit]')) {
      bouton.onclick = () => { this.circuit = bouton.dataset.circuit; this.ouvre(); };
    }

    $('classements-titre').textContent = this.circuits.find((c) => c.id === this.circuit)?.nom ?? this.circuit;
    $('classements-corps').innerHTML = '<p class="aide">Chargement…</p>';

    let data;
    try {
      const reponse = await fetch(`/api/classements/${this.circuit}`);
      data = await reponse.json();
    } catch {
      $('classements-corps').innerHTML = '<p class="erreur">Classement indisponible.</p>';
      return;
    }

    $('classements-cibles').textContent = data.cibles
      ? `Objectifs : platine ${formateChrono(data.cibles.platine)} · or ${formateChrono(data.cibles.or)} · ` +
        `argent ${formateChrono(data.cibles.argent)} · bronze ${formateChrono(data.cibles.bronze)}`
      : 'Temps cibles non calibrés (npm run calibrate).';

    if (!data.lignes?.length) {
      $('classements-corps').innerHTML = '<p class="aide">Aucun temps enregistré. Sois le premier.</p>';
      return;
    }

    $('classements-corps').innerHTML = `<table class="table-classement">
      <tr><th>#</th><th>Pilote</th><th>Voiture</th><th></th><th style="text-align:right">Temps</th></tr>
      ${data.lignes.map((l, i) => `<tr class="${l.pseudo === this.pseudo ? 'moi' : ''}">
        <td>${i + 1}</td>
        <td>${echappe(l.pseudo)}</td>
        <td>${echappe(nomVoiture(l.voiture))} <small style="opacity:.55">niv. ${l.niveau}</small></td>
        <td>${l.medaille ? `<span class="medaille ${l.medaille}">${l.medaille}</span>` : ''}</td>
        <td class="temps">${formateChrono(l.temps)}</td>
      </tr>`).join('')}
    </table>`;
  }
}
