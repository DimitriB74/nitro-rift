// Calcul et attribution des gains.
//
// Règle absolue : **c'est le serveur qui décide des crédits**, jamais le client.
// Celui-ci envoie ce qu'il a fait (place, statistiques de style), le serveur
// applique le barème de /shared/economy.js et borne tout ce qui peut l'être.
//
// On ne peut pas rejouer une course solo pour la vérifier — ce serait absurde
// en coût. On borne donc : la place doit exister dans la grille annoncée, et
// les bonus de style passent par la fonction partagée, qui a son propre
// plafond. Un client modifié peut au pire s'attribuer une victoire contre des
// bots, ce qui ne lèse personne d'autre.

import {
  calculeBonusStyle, evalueDefis, medaillePourTemps, recompenseCourse,
  GAINS_MEDAILLES, ORDRE_MEDAILLES, GAIN_RECORD, MARGE_RECORD, BONUS_GRAND_PRIX,
  multiplicateurAdversite, DEFIS_PAR_ID,
} from '../shared/economy.js';
import { COURSE } from '../shared/config.js';
import { TAILLE_MAX } from '../shared/fantome.js';
import { marqueModifie, profilPublic } from './db.js';

const entier = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

/**
 * Applique le résultat d'une course à un profil.
 *
 * @param {object} doc      document du joueur
 * @param {object} r        résultat annoncé
 * @returns {{gains:number, lignes:Array, defis:Array, profil:object}}
 */
export function appliqueCourse(doc, r) {
  const participants = entier(r.participants ?? 1, 1, COURSE.participantsMax);
  const position = entier(r.position ?? participants, 1, participants);
  const arrive = !!r.arrive;

  // Les statistiques de style sont bornées avant d'être chiffrées : elles
  // viennent du client, et la fonction partagée a son propre plafond.
  const stats = {
    derapages: [
      entier(r.stats?.derapages?.[0] ?? 0, 0, 60),
      entier(r.stats?.derapages?.[1] ?? 0, 0, 40),
      entier(r.stats?.derapages?.[2] ?? 0, 0, 30),
    ],
    sauts: entier(r.stats?.sauts ?? 0, 0, 30),
    loopings: entier(r.stats?.loopings ?? 0, 0, 30),
  };
  const bonusStyle = calculeBonusStyle(stats);

  const adversaires = Array.isArray(r.adversaires) ? r.adversaires.slice(0, 8) : [];
  const { cle: niveauAdversaires } = multiplicateurAdversite(adversaires);

  // Médaille éventuelle, en contre-la-montre uniquement.
  let medaille = null;
  if (r.mode === 'contre-la-montre' && Number.isFinite(r.meilleurTour) && r.cibles) {
    medaille = medaillePourTemps(r.meilleurTour, r.cibles);
  }

  const defisReussis = evalueDefis({
    circuit: r.circuit,
    mode: r.mode,
    voiture: r.voiture ?? doc.voitureActive,
    position, arrive, niveauAdversaires, medaille,
    reapparitions: entier(r.stats?.reapparitions ?? 0, 0, 99),
    derapagesPalier3: stats.derapages[2],
    murs: entier(r.stats?.murs ?? 0, 0, 999),
    loopings: stats.loopings,
  }, doc.defis ?? []);

  const detail = recompenseCourse({
    position, arrive, adversaires, bonusStyle, defisReussis, medailles: [],
  });

  // --- écriture du profil ---------------------------------------------------
  doc.credits = Math.min(16000, (doc.credits ?? 0) + detail.total);

  doc.defis = [...new Set([...(doc.defis ?? []), ...defisReussis])];

  // Les peintures spéciales débloquées par un défi.
  for (const id of defisReussis) {
    const peinture = DEFIS_PAR_ID[id]?.peinture;
    if (peinture && !doc.peintures.includes(peinture)) doc.peintures.push(peinture);
  }

  const stat = doc.stats ?? {};
  stat.courses = (stat.courses ?? 0) + 1;
  if (position === 1 && arrive) stat.victoires = (stat.victoires ?? 0) + 1;
  if (position <= 3 && arrive) stat.podiums = (stat.podiums ?? 0) + 1;
  if (arrive && (stat.meilleurePlace == null || position < stat.meilleurePlace)) {
    stat.meilleurePlace = position;
  }
  doc.stats = stat;

  marqueModifie(doc, 'defis', 'stats', 'peintures');

  return {
    gains: detail.total,
    lignes: detail.lignes,
    defis: defisReussis.map((id) => ({ id, nom: DEFIS_PAR_ID[id]?.nom ?? id })),
    multiplicateur: niveauAdversaires,
    profil: profilPublic(doc),
  };
}

/** Bonus de classement général à la fin d'un Grand Prix. */
export function appliqueGrandPrix(doc, { position, adversaires = [] }) {
  const place = entier(position, 1, COURSE.participantsMax);
  const base = BONUS_GRAND_PRIX[place - 1] ?? 0;
  if (base === 0) return { gains: 0, profil: profilPublic(doc) };

  const { valeur } = multiplicateurAdversite(adversaires);
  const gains = Math.round(base * valeur);
  doc.credits = Math.min(16000, (doc.credits ?? 0) + gains);

  return { gains, profil: profilPublic(doc) };
}

/**
 * Temps de contre-la-montre : médaille, record personnel, crédits.
 *
 * Une médaille ne rapporte qu'une fois par circuit, et en obtenir une
 * directement donne aussi les inférieures pas encore acquises — sinon un
 * joueur doué serait puni d'avoir été bon du premier coup.
 */
export function appliqueTour(doc, { circuit, temps, voiture, niveau, cibles, fantome, splits }) {
  const resultat = { gains: 0, lignes: [], medaille: null, record: false };
  if (!Number.isFinite(temps) || temps <= 0) return { ...resultat, profil: profilPublic(doc) };

  const medaille = medaillePourTemps(temps, cibles);
  const dejaAcquise = doc.medailles?.[circuit] ?? null;

  if (medaille) {
    const rangObtenu = ORDRE_MEDAILLES.indexOf(medaille);
    const rangAcquis = dejaAcquise ? ORDRE_MEDAILLES.indexOf(dejaAcquise) : -1;

    for (let i = rangAcquis + 1; i <= rangObtenu; i++) {
      const m = ORDRE_MEDAILLES[i];
      resultat.gains += GAINS_MEDAILLES[m];
      resultat.lignes.push({ libelle: `Médaille ${m}`, credits: GAINS_MEDAILLES[m] });
    }

    if (rangObtenu > rangAcquis) {
      doc.medailles = { ...(doc.medailles ?? {}), [circuit]: medaille };
      marqueModifie(doc, 'medailles');
      resultat.medaille = medaille;
    }
  }

  const ancien = doc.records?.[circuit];
  if (!ancien || temps < ancien.temps - MARGE_RECORD) {
    doc.records = {
      ...(doc.records ?? {}),
      [circuit]: {
        temps,
        voiture: voiture ?? doc.voitureActive,
        niveau: niveau ?? 0,
        fantome: typeof fantome === 'string' ? fantome.slice(0, TAILLE_MAX) : null,
        // Intermédiaires du tour record : ils servent de référence au HUD à la
        // prochaine session. Bornés, car ils viennent du client.
        splits: Array.isArray(splits)
          ? splits.slice(0, 16).map((t) => (Number.isFinite(Number(t)) ? +Number(t).toFixed(3) : null))
          : null,
        date: new Date(),
      },
    };
    marqueModifie(doc, 'records');
    resultat.record = true;
    if (ancien) {
      resultat.gains += GAIN_RECORD;
      resultat.lignes.push({ libelle: 'Record personnel battu', credits: GAIN_RECORD });
    }
  }

  doc.credits = Math.min(16000, (doc.credits ?? 0) + resultat.gains);
  return { ...resultat, profil: profilPublic(doc) };
}
