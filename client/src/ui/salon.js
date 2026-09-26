// Écran de salon multijoueur.
//
// Il ne décide de rien : il affiche l'état que le serveur diffuse et renvoie
// les intentions du joueur. Toute règle (qui est hôte, qui peut lancer, combien
// de participants) est appliquée côté serveur, ce module ne fait que refléter.

import { VOITURES, IDS_VOITURES } from '@shared/cars.js';
import { NIVEAUX, IDS_NIVEAUX } from '@shared/bots.js';
import { COURSE } from '@shared/config.js';

const DUREE_CLM = COURSE.dureeContreLaMontre;

/** « 1 minute », « 5 minutes ». */
const minutes = (secondes) => {
  const n = Math.round((secondes ?? DUREE_CLM) / 60);
  return `${n} minute${n > 1 ? 's' : ''}`;
};
import { echappe } from './hud.js';

const $ = (id) => document.getElementById(id);

export class EcranSalon {
  /**
   * @param {Reseau} reseau
   * @param {Array}  circuits  catalogue des circuits
   */
  constructor(reseau, circuits) {
    this.reseau = reseau;
    this.circuits = circuits;
    this.salon = null;

    $('salon-pret').onclick = () => {
      const moi = this.moi();
      this.reseau.pret(!moi?.pret);
    };
    $('salon-lancer').onclick = () => this.reseau.lancer();
  }

  get monId() {
    return this.reseau.socket?.id;
  }

  moi() {
    return this.salon?.participants.find((p) => p.id === this.monId) ?? null;
  }

  estHote() {
    return this.salon?.hoteId === this.monId;
  }

  erreur(message) {
    $('salon-erreur').textContent = message ?? '';
  }

  affiche(salon) {
    this.salon = salon;
    if (!salon) return;

    $('salon-code').textContent = salon.code;
    $('salon-ping').textContent = `${this.reseau.ping} ms`;
    $('salon-compte').textContent = `${salon.participants.length} / ${salon.max}`;

    this.afficheParticipants();
    this.afficheReglages();
    this.afficheVoitures();

    const moi = this.moi();
    const bouton = $('salon-pret');
    bouton.textContent = moi?.pret ? 'Je ne suis plus prêt' : 'Je suis prêt';
    bouton.classList.toggle('principal', !moi?.pret);

    const humains = salon.participants.filter((p) => !p.bot);
    const tousPrets = humains.every((p) => p.pret);
    const lancer = $('salon-lancer');
    lancer.hidden = !this.estHote();
    lancer.disabled = !tousPrets;
    const gpEnCours = salon.mode === 'grand-prix';
    const manche = gpEnCours ? (salon.grandPrix?.termine ? 1 : salon.grandPrix?.manche ?? 1) : 0;
    lancer.textContent = !tousPrets ? 'En attente des joueurs…'
      : gpEnCours ? `Lancer la manche ${manche}`
        : salon.mode === 'contre-la-montre' ? 'Lancer la session' : 'Lancer la course';
  }

  afficheParticipants() {
    const liste = $('salon-participants');
    liste.innerHTML = this.salon.participants.map((p) => {
      const voiture = p.voiture ? VOITURES[p.voiture]?.nom ?? p.voiture : '—';
      const etiquettes = [];
      if (p.hote) etiquettes.push('<span class="etiquette">hôte</span>');
      if (p.bot) etiquettes.push(`<span class="etiquette">bot ${NIVEAUX[p.niveau]?.nom ?? p.niveau}</span>`);

      const etat = p.bot ? '' : p.pret
        ? '<span class="pret">✔ prêt</span>'
        : '<span class="attente">en attente</span>';

      // L'hôte peut retirer un bot ou exclure un joueur, mais pas lui-même.
      const retrait = this.estHote() && p.id !== this.monId
        ? `<button class="retirer" data-retirer="${p.id}" data-bot="${p.bot ? 1 : 0}" title="Retirer">✕</button>`
        : '';

      return `<li class="${p.id === this.monId ? 'moi' : ''}">
        <span class="nom">${echappe(p.pseudo)}</span>
        <span class="etiquette">${echappe(voiture)}</span>
        ${etiquettes.join('')}${etat}${retrait}
      </li>`;
    }).join('');

    for (const bouton of liste.querySelectorAll('[data-retirer]')) {
      bouton.onclick = () => {
        const id = bouton.dataset.retirer;
        if (bouton.dataset.bot === '1') this.reseau.retirerBot(id);
        else this.reseau.exclure(id);
      };
    }
  }

  afficheReglages() {
    const bloc = $('salon-reglages');
    const gp = this.salon.grandPrix;
    const enGp = this.salon.mode === 'grand-prix';
    const enClm = this.salon.mode === 'contre-la-montre';
    const nomMode = enGp ? 'Grand Prix' : enClm ? 'Contre-la-montre' : 'Course';

    if (!this.estHote()) {
      const circuit = this.circuits.find((c) => c.id === this.salon.circuit);
      bloc.innerHTML = `<p class="aide">Mode : <b>${nomMode}</b><br>
        ${enGp && gp ? `Manche ${gp.manche} sur ${gp.manches}<br>` : ''}
        Circuit : <b>${echappe(circuit?.nom ?? this.salon.circuit)}</b><br>
        ${enClm ? `${minutes(this.salon.duree)} de session`
          : `${this.salon.tours} tour${this.salon.tours > 1 ? 's' : ''}`}<br>
        L'hôte choisit les réglages.</p>`;
      this.afficheChampionnat();
      return;
    }

    // En Grand Prix, le circuit de la manche est imposé : on l'annonce au lieu
    // de laisser le choix, sinon l'hôte pourrait fausser le championnat.
    const blocCircuits = enGp
      ? `<p class="aide">Manche ${gp?.manche ?? 1} sur ${gp?.manches ?? 4} :
          <b>${echappe(this.circuits.find((c) => c.id === this.salon.circuit)?.nom ?? '')}</b></p>`
      : `<div class="choix-voitures" id="salon-circuits">
          ${this.circuits.map((c) => `<button data-circuit="${c.id}"
            class="${c.id === this.salon.circuit ? 'actif' : ''}">${echappe(c.nom)}</button>`).join('')}
        </div>`;

    bloc.innerHTML = `
      <div class="segments" id="salon-modes">
        <button class="segment ${!enGp && !enClm ? 'actif' : ''}" data-mode="course">Course</button>
        <button class="segment ${enGp ? 'actif' : ''}" data-mode="grand-prix">Grand Prix</button>
        <button class="segment ${enClm ? 'actif' : ''}" data-mode="contre-la-montre">Contre‑la‑montre</button>
      </div>
      ${blocCircuits}
      ${enClm ? `
        <div class="segments" style="margin-top:8px">
          ${COURSE.dureesContreLaMontre.map((d) => `<button class="segment ${d === this.salon.duree ? 'actif' : ''}"
            data-duree="${d}">${d / 60} min</button>`).join('')}
        </div>
        <p class="aide">Chacun enchaîne les tours pendant la session ;
          le meilleur tour classe.</p>` : ''}
      <p class="aide" style="margin-top:10px">Ajouter un bot</p>
      <div class="ligne-bot">
        ${IDS_NIVEAUX.map((n) => `<button class="bouton" data-bot="${n}">${NIVEAUX[n].nom}</button>`).join('')}
      </div>`;

    for (const bouton of bloc.querySelectorAll('[data-mode]')) {
      bouton.onclick = () => this.reseau.reglages({ mode: bouton.dataset.mode });
    }
    for (const bouton of bloc.querySelectorAll('[data-duree]')) {
      bouton.onclick = () => this.reseau.reglages({ duree: Number(bouton.dataset.duree) });
    }
    for (const bouton of bloc.querySelectorAll('[data-circuit]')) {
      bouton.onclick = () => this.reseau.reglages({ circuit: bouton.dataset.circuit });
    }
    for (const bouton of bloc.querySelectorAll('[data-bot]')) {
      bouton.onclick = () => this.reseau.ajouterBot(bouton.dataset.bot);
    }
    this.afficheChampionnat();
  }

  /** Classement du championnat en cours, s'il y en a un. */
  afficheChampionnat() {
    const bloc = $('salon-championnat');
    if (!bloc) return;

    const gp = this.salon.grandPrix;
    // Rien à montrer avant la première manche : le tableau serait vide de sens.
    if (this.salon.mode !== 'grand-prix' || !gp || gp.manche <= 1) {
      bloc.hidden = true;
      return;
    }

    bloc.hidden = false;
    bloc.innerHTML = `<h3>Championnat</h3>
      <table class="tableau-resultats compact">
        <thead><tr><th>#</th><th>Pilote</th>
          ${gp.circuits.map((_, i) => `<th>M${i + 1}</th>`).join('')}<th>Pts</th></tr></thead>
        <tbody>${gp.classement.map((l) => `
          <tr class="${l.id === this.monId ? 'moi' : ''}">
            <td>${l.place}</td><td>${echappe(l.nom)}</td>
            ${gp.circuits.map((_, i) => `<td class="temps">${l.positions[i] ?? '—'}</td>`).join('')}
            <td class="temps"><b>${l.points}</b></td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  afficheVoitures() {
    const moi = this.moi();
    const bloc = $('salon-voitures');
    bloc.innerHTML = IDS_VOITURES.map((id) => `<button data-voiture="${id}"
      class="${moi?.voiture === id ? 'actif' : ''}">${echappe(VOITURES[id].nom)}</button>`).join('');

    for (const bouton of bloc.querySelectorAll('[data-voiture]')) {
      bouton.onclick = () => this.reseau.choisirVoiture(bouton.dataset.voiture, moi?.peinture);
    }
  }
}
