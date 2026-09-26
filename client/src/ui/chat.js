// Chat textuel du salon et de la course.
//
// Un seul fil de discussion, affiché à deux endroits : la liste complète dans
// le salon, et les derniers messages en surimpression pendant la course, où ils
// s'effacent tout seuls pour ne pas masquer la piste.
//
// Le module n'envoie rien lui-même : il rend la saisie au réseau, qui décide.
// Les messages reçus viennent d'autres joueurs : ils sont échappés à
// l'affichage, jamais insérés tels quels.

import { echappe } from './hud.js';

/** Messages gardés en mémoire ; au-delà, les plus vieux tombent. */
const MAX_MESSAGES = 60;
/** Durée d'affichage d'un message en surimpression pendant la course (s). */
const DUREE_COURSE = 9;
/** Nombre de messages visibles pendant la course. */
const LIGNES_COURSE = 4;

const $ = (id) => document.getElementById(id);

export class Chat {
  /**
   * @param {Reseau} reseau
   * @param {() => string|null} monIdentifiant  socket id du joueur local
   */
  constructor(reseau, monIdentifiant) {
    this.reseau = reseau;
    this.monIdentifiant = monIdentifiant;
    this.messages = [];
    this.ouvert = false;

    this.champSalon = $('chat-saisie');
    this.champCourse = $('chat-course-saisie');

    if (this.champSalon) {
      this.champSalon.addEventListener('keydown', (e) => {
        e.stopPropagation();                       // le clavier de jeu n'écoute pas
        if (e.key === 'Enter') this.envoie(this.champSalon);
      });
      $('chat-envoyer').onclick = () => this.envoie(this.champSalon);
    }

    if (this.champCourse) {
      this.champCourse.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { this.envoie(this.champCourse); this.ferme(); }
        if (e.key === 'Escape') this.ferme();
      });
    }
  }

  /** Efface le fil : on change de salon, les messages d'avant ne valent plus. */
  vide() {
    this.messages = [];
    this.afficheSalon();
    this.afficheCourse(0);
  }

  /** Message reçu du serveur, ou note locale si `systeme` est vrai. */
  ajoute(message, systeme = false) {
    this.messages.push({ ...message, systeme, recuA: performance.now() / 1000 });
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    this.afficheSalon();
  }

  envoie(champ) {
    const texte = champ.value.trim();
    champ.value = '';
    if (!texte) return;
    this.reseau?.chat(texte);
  }

  // -------------------------------------------------------------------------
  // Affichage
  // -------------------------------------------------------------------------

  afficheSalon() {
    const liste = $('chat-messages');
    if (!liste) return;

    liste.innerHTML = this.messages.map((m) => this.ligne(m)).join('');
    // On reste collé en bas : un chat qui ne défile pas ne sert à rien.
    liste.scrollTop = liste.scrollHeight;
  }

  ligne(m) {
    if (m.systeme) return `<li class="systeme">${echappe(m.texte)}</li>`;
    const moi = m.id === this.monIdentifiant();
    return `<li class="${moi ? 'moi' : ''}">` +
      `<b>${echappe(m.pseudo)}${m.invite ? ' <span class="etiquette">invité</span>' : ''}</b> ` +
      `${echappe(m.texte)}</li>`;
  }

  /**
   * Surimpression pendant la course : seuls les messages récents restent.
   * @param {number} horloge  horloge de jeu, en secondes
   */
  afficheCourse(horloge) {
    const bloc = $('chat-course-messages');
    if (!bloc) return;

    const maintenant = performance.now() / 1000;
    const recents = this.messages
      .filter((m) => maintenant - m.recuA < DUREE_COURSE)
      .slice(-LIGNES_COURSE);

    bloc.innerHTML = recents.map((m) => this.ligne(m)).join('');
    bloc.hidden = recents.length === 0 && !this.ouvert;
  }

  // -------------------------------------------------------------------------
  // Saisie en course
  // -------------------------------------------------------------------------

  /** Ouvre la saisie en course et rend le clavier au texte. */
  ouvre(clavier) {
    if (!this.champCourse || this.ouvert) return;
    this.ouvert = true;
    this.clavier = clavier;
    if (clavier) clavier.actif = false;
    $('chat-course').hidden = false;
    this.champCourse.value = '';
    this.champCourse.focus();
  }

  ferme() {
    if (!this.ouvert) return;
    this.ouvert = false;
    this.champCourse.blur();
    $('chat-course').hidden = true;
    if (this.clavier) {
      // Les touches maintenues pendant la saisie n'ont pas été vues relâchées.
      this.clavier.enfoncees.clear();
      this.clavier.videImpulsions();
      this.clavier.actif = true;
    }
  }
}
