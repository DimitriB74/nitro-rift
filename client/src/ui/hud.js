// Affichage tête haute pendant la course.

import { kmh } from '@shared/physics.js';
import { PHYS } from '@shared/config.js';
import { VOITURES } from '@shared/cars.js';
import { Minimap } from './minimap.js';

export function formateChrono(t, decimales = 2) {
  if (!Number.isFinite(t)) return '—';
  const signe = t < 0 ? '-' : '';
  const a = Math.abs(t);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  return `${signe}${m}:${s.toFixed(decimales).padStart(decimales + 3, '0')}`;
}

export function formateEcart(t) {
  const signe = t >= 0 ? '+' : '−';
  return `${signe}${Math.abs(t).toFixed(2)}`;
}

export class Hud {
  constructor() {
    this.e = {
      position: document.getElementById('hud-position'),
      positionTotal: document.getElementById('hud-position-total'),
      tour: document.getElementById('hud-tour'),
      tours: document.getElementById('hud-tours'),
      chrono: document.getElementById('hud-chrono'),
      intermediaire: document.getElementById('hud-intermediaire'),
      classement: document.getElementById('hud-classement'),
      vitesse: document.getElementById('hud-vitesse'),
      nitro: document.getElementById('hud-nitro'),
      derapage: document.getElementById('hud-derapage'),
      compte: document.getElementById('hud-compte'),
      messages: document.getElementById('hud-messages'),
      fps: document.getElementById('hud-fps')
    };
    this.jaugeNitro = this.e.nitro.parentElement;
    this.jaugeDerapage = this.e.derapage.parentElement;
    this.minimap = new Minimap(document.getElementById('minimap'));

    this.messages = [];
    this.intermediaireJusqua = 0;
    this.derniereMaj = 0;
  }

  prepare(course, recordsIntermediaires = null) {
    this.course = course;
    this.records = recordsIntermediaires;
    this.messages = [];
    this.e.tours.textContent = course.tours;
    this.e.positionTotal.textContent = `/${course.participants.length}`;
    this.minimap.prepare(course.circuit);
    this.e.intermediaire.textContent = '';
    this.e.compte.textContent = '';
    this.e.messages.innerHTML = '';
  }

  /** @param {number} horloge temps courant en secondes (pour les messages) */
  maj(course, horloge, dt) {
    const moi = course.moi;
    const etat = moi.etat;

    // --- Compte à rebours ---------------------------------------------------
    if (course.phase === 'compte') {
      const restant = course.tempsAvantDepart;
      const n = Math.ceil(restant - 1.2);
      this.e.compte.textContent = n > 0 ? String(n) : (restant > 0 ? 'PARTEZ !' : '');
    } else if (this.e.compte.textContent) {
      // On laisse « PARTEZ ! » une demi-seconde après le départ.
      if (course.temps > (course.tempsAvantDepartInitial ?? 0) + 0.6) this.e.compte.textContent = '';
      else if (course.phase === 'course' && etat.temps > 0.6) this.e.compte.textContent = '';
    }

    // --- Position et tour ---------------------------------------------------
    this.e.position.textContent = moi.position;
    const tour = Math.min(Math.max(etat.progression.tour, 1), course.tours);
    this.e.tour.textContent = moi.arrive ? course.tours : tour;

    // --- Chrono -------------------------------------------------------------
    this.e.chrono.textContent = formateChrono(course.phase === 'compte' ? 0 : etat.temps);

    // --- Vitesse, nitro, dérapage ------------------------------------------
    this.e.vitesse.textContent = kmh(etat);

    const ratioNitro = etat.nitro.jauge / etat.params.nitroCapacite;
    this.e.nitro.style.width = `${Math.max(0, Math.min(1, ratioNitro)) * 100}%`;
    this.jaugeNitro.classList.toggle('active', etat.nitro.actif);

    const d = etat.derapage;
    const seuils = PHYS.paliersDerapage;
    const ratioDerapage = d.actif ? Math.min(1, d.duree / seuils[2]) : 0;
    this.e.derapage.style.width = `${ratioDerapage * 100}%`;
    this.jaugeDerapage.classList.toggle('palier-2', d.palier === 2);
    this.jaugeDerapage.classList.toggle('palier-3', d.palier === 3);

    // --- Classement en direct ----------------------------------------------
    this.majClassement(course);

    // --- Temps intermédiaire ------------------------------------------------
    if (horloge > this.intermediaireJusqua) this.e.intermediaire.textContent = '';

    // --- Messages -----------------------------------------------------------
    this.messages = this.messages.filter((m) => m.jusqua > horloge);
    this.e.messages.innerHTML = this.messages
      .map((m) => `<div class="message-ligne ${m.classe}">${m.texte}</div>`)
      .join('');

    this.minimap.dessine(course);
  }

  majClassement(course) {
    const html = [];
    for (const p of course.classement) {
      const ecart = course.ecartAvec(p);
      let texteEcart = '';
      if (ecart) {
        texteEcart = ecart.type === 'temps'
          ? formateEcart(ecart.valeur)
          : `${Math.round(ecart.valeur)} m`;
      }
      html.push(
        `<li class="${p === course.moi ? 'moi' : ''}">` +
        `<span class="rang">${p.position}</span>` +
        `<span class="nom">${echappe(p.nom)}</span>` +
        `<span class="ecart">${texteEcart}</span>` +
        '</li>'
      );
    }
    this.e.classement.innerHTML = html.join('');
  }

  /** Message central temporaire. */
  message(texte, classe = '', duree = 1.8, horloge = 0) {
    this.messages.push({ texte, classe, jusqua: horloge + duree });
  }

  /** Temps intermédiaire à un checkpoint, comparé au record personnel. */
  intermediaire(temps, reference, horloge) {
    if (!Number.isFinite(reference)) {
      this.e.intermediaire.textContent = formateChrono(temps);
      this.e.intermediaire.className = 'intermediaire';
    } else {
      const ecart = temps - reference;
      this.e.intermediaire.textContent = formateEcart(ecart);
      this.e.intermediaire.className = `intermediaire ${ecart <= 0 ? 'avance' : 'retard'}`;
    }
    this.intermediaireJusqua = horloge + 2.5;
  }

  majFps(valeur, visible) {
    this.e.fps.hidden = !visible;
    if (visible) this.e.fps.textContent = `${Math.round(valeur)} FPS`;
  }
}

export const echappe = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const nomVoiture = (id) => VOITURES[id]?.nom ?? id;
