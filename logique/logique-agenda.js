// Agenda et heure de Paris pour l'accueil client IA par SMS.
// Fonctions pures, sans dépendance : heure de Paris, plages d'ouverture, créneaux libres, lecture des rendez-vous.
// Elles viennent de la logique de Lucie (standardiste vocal, fiche 1.2) : les deux projets lisent le même format
// de rendez-vous, ce qui leur permet de partager un agenda quand on les installe ensemble.
const FUSEAU = 'Europe/Paris';

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// --- Heure de Paris -------------------------------------------------------

// Composantes de l'heure de Paris pour un instant donné.
function partiesParis(instant) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p = {};
  for (const x of f.formatToParts(instant)) p[x.type] = x.value;
  const jours = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { a: +p.year, m: +p.month, j: +p.day, h: +p.hour, min: +p.minute, js: jours[p.weekday] };
}

// Décalage de Paris (en minutes) par rapport à UTC, à un instant donné.
function decalageParis(instant) {
  const p = partiesParis(instant);
  const commeUtc = Date.UTC(p.a, p.m - 1, p.j, p.h, p.min);
  return Math.round((commeUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

// "2026-11-24T09:00" (heure de Paris) -> objet Date (instant exact). Gère l'heure d'été.
function depuisHeureParis(local) {
  const r = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(local || '').trim());
  if (!r) return null;
  const [a, m, j, h, mi] = [+r[1], +r[2], +r[3], +(r[4] || 0), +(r[5] || 0)];
  if (m < 1 || m > 12 || j < 1 || j > 31 || h > 23 || mi > 59) return null;
  const naif = Date.UTC(a, m - 1, j, h, mi);
  let d = new Date(naif - decalageParis(new Date(naif)) * 60000);
  d = new Date(naif - decalageParis(d) * 60000); // deuxième passe autour des changements d'heure
  const verif = partiesParis(d);
  if (verif.j !== j || verif.m !== m) return null; // date impossible (31 février…)
  return d;
}

// Date -> "2026-11-24T09:00:00+01:00" (format accepté par Google Agenda).
function isoParis(instant) {
  const p = partiesParis(instant);
  const dec = decalageParis(instant);
  const s = dec >= 0 ? '+' : '-';
  const z = (n) => String(n).padStart(2, '0');
  return `${p.a}-${z(p.m)}-${z(p.j)}T${z(p.h)}:${z(p.min)}:00${s}${z(Math.floor(Math.abs(dec) / 60))}:${z(Math.abs(dec) % 60)}`;
}

// Date -> "mardi 24 novembre à 9 h" / "à 14 h 30" (pour être lu à voix haute).
function libelleParis(instant) {
  const p = partiesParis(instant);
  const heure = p.min ? `${p.h} h ${String(p.min).padStart(2, '0')}` : `${p.h} h`;
  return `${JOURS[p.js]} ${p.j === 1 ? '1er' : p.j} ${MOIS[p.m - 1]} à ${heure}`;
}

function jourParis(instant) {
  const p = partiesParis(instant);
  return `${p.a}-${String(p.m).padStart(2, '0')}-${String(p.j).padStart(2, '0')}`;
}

function ajouterJours(jour, n) {
  const [a, m, j] = jour.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return d.toISOString().slice(0, 10);
}

// --- Téléphone ------------------------------------------------------------

// Numéro français dicté -> format international +33…, ou null s'il est invalide.
function normaliserTelephone(brut) {
  if (!brut) return null;
  let t = String(brut).replace(/[^\d+]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (/^0[1-9]\d{8}$/.test(t)) t = '+33' + t.slice(1);
  if (/^33[1-9]\d{8}$/.test(t)) t = '+' + t;
  if (/^\+33[1-9]\d{8}$/.test(t)) return t;
  if (/^\+\d{8,15}$/.test(t) && !t.startsWith('+33')) return t; // numéro étranger : accepté tel quel
  return null;
}

function estMobile(tel) {
  return /^\+33[67]\d{8}$/.test(tel || '');
}

// --- Horaires et créneaux -------------------------------------------------

// Plages d'ouverture d'un jour (heure de Paris), en minutes depuis minuit.
function plagesDuJour(jour, cfg) {
  const d = depuisHeureParis(jour + 'T12:00');
  const js = partiesParis(d).js;
  if ((cfg.joursFermes || []).includes(jour)) return [];
  return (cfg.horaires[js] || []).map(([deb, fin]) => {
    const [h1, m1] = deb.split(':').map(Number);
    const [h2, m2] = fin.split(':').map(Number);
    return [h1 * 60 + m1, h2 * 60 + m2];
  });
}

// Intervalles occupés [debut, fin] (ms) à partir des événements Google Agenda.
function intervallesOccupes(evenements) {
  const res = [];
  for (const e of evenements || []) {
    if (!e || !e.start) continue;
    if (e.status === 'cancelled' || e.transparency === 'transparent') continue;
    let deb, fin;
    if (e.start.dateTime) {
      deb = new Date(e.start.dateTime).getTime();
      fin = new Date((e.end && e.end.dateTime) || e.start.dateTime).getTime();
    } else if (e.start.date) { // journée entière (congés, chantier bloquant…)
      deb = depuisHeureParis(e.start.date + 'T00:00').getTime();
      fin = depuisHeureParis(((e.end && e.end.date) || ajouterJours(e.start.date, 1)) + 'T00:00').getTime();
    } else continue;
    if (fin > deb) res.push([deb, fin]);
  }
  return res;
}

function chevauche(deb, fin, occupes, margeMs) {
  return occupes.some(([d, f]) => deb < f + margeMs && fin + margeMs > d);
}

// Liste des créneaux libres à proposer à l'appelant.
function creneauxLibres(evenements, demande, cfg, maintenant) {
  const occupes = intervallesOccupes(evenements);
  const duree = cfg.dureeRdvMin * 60000;
  const marge = (cfg.margeTrajetMin || 0) * 60000;
  const auPlusTot = maintenant.getTime() + cfg.delaiMinimumH * 3600000;
  const res = [];
  for (let i = 0; i < demande.nbJours && res.length < cfg.nbPropositions; i++) {
    const jour = ajouterJours(demande.jourDebut, i);
    for (const [ouv, ferm] of plagesDuJour(jour, cfg)) {
      for (let t = ouv; t + cfg.dureeRdvMin <= ferm; t += cfg.pasMin) {
        if (demande.partie === 'matin' && t >= 12 * 60) continue;
        if (demande.partie === 'apres-midi' && t < 12 * 60) continue;
        const hh = String(Math.floor(t / 60)).padStart(2, '0');
        const mm = String(t % 60).padStart(2, '0');
        const deb = depuisHeureParis(`${jour}T${hh}:${mm}`).getTime();
        if (deb < auPlusTot) continue;
        if (chevauche(deb, deb + duree, occupes, marge)) continue;
        res.push(new Date(deb));
        break; // un seul créneau par plage (matin / après-midi) : des choix variés à l'oral
      }
      if (res.length >= cfg.nbPropositions) break;
    }
  }
  return res.slice(0, cfg.nbPropositions).map((d) => ({
    debut: isoParis(d).slice(0, 16),
    libelle: libelleParis(d),
  }));
}

// "jeudi 19 novembre" (sans l'heure).
function jourLibelle(instant) {
  const p = partiesParis(instant);
  return `${JOURS[p.js]} ${p.j === 1 ? '1er' : p.j} ${MOIS[p.m - 1]}`;
}

// "14 h" / "14 h 30".
function heureLibelle(instant) {
  const p = partiesParis(instant);
  return p.min ? `${p.h} h ${String(p.min).padStart(2, '0')}` : `${p.h} h`;
}

// Texte de date : ISO avec fuseau ("…+01:00", "…Z") ou heure de Paris sans fuseau ("2026-11-19 17:54").
function lireDate(texte) {
  const s = String(texte || '').trim();
  if (!s) return null;
  if (/(Z|[+-]\d{2}:\d{2})$/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  return depuisHeureParis(s.replace(' ', 'T'));
}

// --- Rendez-vous : lignes de la table n8n ou événements Google -> même forme ---

// Une ligne (debut/fin) ou un événement Google -> événement { start, end } pour le calcul d'occupation.
function versEvenement(e) {
  if (!e) return null;
  if (e.start) return e;
  if (e.debut) return { id: e.id, start: { dateTime: e.debut }, end: { dateTime: e.fin || e.debut } };
  return null;
}

// Une ligne ou un événement -> { id, idBrut, debut, fin, nom, telephone, adresse, motif } (null si inexploitable).
function versRdv(e) {
  if (!e) return null;
  if (e.debut) {
    return {
      id: String(e.id), idBrut: e.id, debut: e.debut, fin: e.fin || e.debut, nom: e.nom || '',
      telephone: e.telephone || '', adresse: e.adresse || '', motif: e.motif || '',
    };
  }
  if (e.start && e.start.dateTime) { // événement créé par le circuit (description structurée)
    const desc = String(e.description || '');
    const champ = (nom) => ((new RegExp(nom + ' : (.*)')).exec(desc) || [])[1] || '';
    return {
      id: String(e.id), idBrut: e.id, debut: e.start.dateTime, fin: (e.end && e.end.dateTime) || e.start.dateTime,
      nom: champ('Client') || e.summary || '', telephone: champ('Téléphone').trim(),
      adresse: e.location || '', motif: champ('Motif'),
    };
  }
  return null;
}

// --- Conservation limitée des données (RGPD) ----------------------------------

// Identifiants des lignes plus anciennes que « jours » (champ de date au choix).
function lignesAPurger(lignes, champ, jours, maintenant) {
  const limite = maintenant.getTime() - jours * 86400000;
  return (lignes || []).filter((l) => {
    const d = l && l.id !== undefined && lireDate(l[champ]);
    return d && d.getTime() < limite;
  }).map((l) => ({ id: l.id }));
}

// Vérifie un créneau demandé (texte "AAAA-MM-JJTHH:MM") : { deb, fin } ou { erreur }.
function validerCreneau(texte, cfg, maintenant) {
  const deb = depuisHeureParis(texte);
  if (!deb) return { erreur: 'Heure de rendez-vous non comprise. Repropose un des créneaux donnés.' };
  if (deb.getTime() < maintenant.getTime() + cfg.delaiMinimumH * 3600000) {
    return { erreur: 'Ce créneau est trop proche ou déjà passé. Vérifie de nouveau les créneaux.' };
  }
  const p = partiesParis(deb);
  const minutes = p.h * 60 + p.min;
  const ok = plagesDuJour(jourParis(deb), cfg).some(([o, f]) => minutes >= o && minutes + cfg.dureeRdvMin <= f);
  if (!ok) return { erreur: "Ce créneau est en dehors des horaires d'intervention. Vérifie de nouveau les créneaux." };
  return { deb, fin: new Date(deb.getTime() + cfg.dureeRdvMin * 60000) };
}

module.exports = {
  partiesParis, decalageParis, depuisHeureParis, isoParis, libelleParis, jourParis, ajouterJours,
  normaliserTelephone, estMobile, plagesDuJour, intervallesOccupes, chevauche, creneauxLibres, jourLibelle,
  heureLibelle, lireDate, versEvenement, versRdv, lignesAPurger, validerCreneau
};
