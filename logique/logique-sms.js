// Logique de l'accueil client IA par SMS : fiches 1.1 (appels manqués rappelés par SMS, conversation jusqu'au
// rendez-vous) et 1.5 (rappels anti-absence, confirmation, annulation, liste d'attente, relance des absents).
// Fonctions pures, sans dépendance. Elles s'appuient sur logique-agenda.js (heure de Paris, créneaux libres,
// lecture des rendez-vous), que construire.js recopie AVANT ce fichier dans les blocs « Code » du circuit n8n.
// Chaque décision renvoie un « plan » (messages à envoyer, lignes à écrire) : le circuit n8n ne fait qu'appliquer.

// @@tests-seulement : en local, la logique d'agenda est chargée ici ; dans n8n, elle est déjà au-dessus.
if (typeof creneauxLibres === 'undefined') {
  Object.assign(globalThis, require('./logique-agenda.js'));
}
// @@fin-tests-seulement

const JOURS_SMS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const NUMERO_REGLAGES = '#reglages';

// --- SMS : alphabet GSM-7 (160 caractères par SMS ; un seul caractère hors alphabet fait tomber à 70) ------

const GSM_BASE = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const GSM_EXT = new Set(Array.from('^{}\\[~]|€'));
const VERS_GSM = {
  'ê': 'e', 'ë': 'e', 'â': 'a', 'á': 'a', 'ã': 'a', 'î': 'i', 'ï': 'i', 'í': 'i', 'ô': 'o', 'ó': 'o', 'õ': 'o',
  'û': 'u', 'ú': 'u', 'ç': 'c', 'ÿ': 'y', 'Ê': 'E', 'Ë': 'E', 'È': 'E', 'Â': 'A', 'À': 'A', 'Á': 'A', 'Î': 'I',
  'Ï': 'I', 'Ô': 'O', 'Û': 'U', 'Ù': 'U', 'Ú': 'U', 'œ': 'oe', 'Œ': 'OE', '’': "'", '‘': "'", '«': '"', '»': '"',
  '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', ' ': ' ', '•': '-', '°': 'o',
};

// Remplace ce qui sortirait de l'alphabet GSM-7 (ê, â, ô, ç, apostrophe typographique, émojis…).
function versGsm(texte) {
  let res = '';
  for (const c of Array.from(String(texte || ''))) {
    if (GSM_BASE.has(c) || GSM_EXT.has(c)) { res += c; continue; }
    if (VERS_GSM[c] !== undefined) { res += VERS_GSM[c]; continue; }
    const sans = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (sans && Array.from(sans).every((x) => GSM_BASE.has(x))) res += sans;
    // sinon (émoji, signe rare) : retiré
  }
  return res.replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
}

// Nombre de SMS facturés pour un texte.
function segmentsSms(texte) {
  const s = Array.from(String(texte || ''));
  if (s.every((c) => GSM_BASE.has(c) || GSM_EXT.has(c))) {
    const n = s.reduce((t, c) => t + (GSM_EXT.has(c) ? 2 : 1), 0);
    return { encodage: 'GSM-7', caracteres: n, segments: n <= 160 ? 1 : Math.ceil(n / 153) };
  }
  const n = String(texte || '').length;
  return { encodage: 'UCS-2', caracteres: n, segments: n <= 70 ? 1 : Math.ceil(n / 67) };
}

// --- Heures ----------------------------------------------------------------

function minutesParis(instant) { const p = partiesParis(instant); return p.h * 60 + p.min; }
function enMinutes(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); }

// Vrai entre la fin et le début des envois (par défaut de 21 h à 8 h) : aucun SMS spontané.
function heuresCalmes(maintenant, cfg) {
  const m = minutesParis(maintenant);
  return m < enMinutes(cfg.envoi.debut) || m >= enMinutes(cfg.envoi.fin);
}

// "2026-11-20 23:12" (heure de Paris), format de la colonne date.
function dateMessage(instant) { return isoParis(instant).slice(0, 16).replace('T', ' '); }

// "mardi 24/11 à 14 h" (listes de créneaux, au plus court).
function libelleCourt(instant) {
  const p = partiesParis(instant);
  return `${JOURS_SMS[p.js]} ${p.j}/${String(p.m).padStart(2, '0')} à ${heureLibelle(instant)}`;
}

function salut(maintenant) { return partiesParis(maintenant).h >= 18 ? 'Bonne soirée.' : 'Bonne journée.'; }

// --- Numéros -----------------------------------------------------------------

function numeroLisible(tel) {
  const m = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(tel || '');
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : (tel || 'numéro masqué');
}

// Pour l'écran de démo : les vrais numéros (appels reçus) ne sont jamais affichés en entier.
function masquerNumero(tel) {
  const m = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(tel || '');
  return m ? `0${m[1]} ${m[2]} •• •• ${m[5]}` : '••';
}

// Numéros réservés par l'ARCEP aux œuvres de fiction (06 39 98 xx xx) : ceux de la démo.
function estNumeroDemo(tel) { return /^\+3363998\d{4}$/.test(tel || ''); }

function numeroMasque(brut) {
  const s = String(brut || '').trim().toLowerCase();
  if (!s || /anonymous|restricted|unknown|private|unavailable|masqu/.test(s)) return true;
  const t = s.replace(/[^\d+]/g, '');
  return ['+266696687', '+7378742833', '+2562533', '+8656696', '+86282452253'].includes(t) || t.replace(/\D/g, '').length < 6;
}

// Fixe français (01 à 05, 08, 09) : il ne reçoit pas de SMS.
function estFixeFrancais(tel) { return /^\+33[1-589]\d{8}$/.test(tel || ''); }

// Vrais portables de test (.env NUMEROS_REELS) : les seuls qui reçoivent de vrais SMS pendant la démo.
function numerosReels(cfg) { return ((cfg.reel && cfg.reel.numeros) || []).map((n) => normaliserTelephone(n)).filter(Boolean); }
function estReel(numero, cfg) { return !!numero && numerosReels(cfg).includes(numero); }
// La page de démo ne connaît le vrai portable que sous une clé (« reel-1 »), jamais en clair.
// En démo seulement, on retrouve ici, côté serveur, le numéro qu'elle désigne.
function numeroEntrant(brut, cfg) {
  const m = /^reel-(\d+)$/.exec(String(brut || '').trim());
  if (!m || !(cfg.demo && cfg.demo.actif)) return brut;
  return numerosReels(cfg)[Number(m[1]) - 1] || brut;
}

function typeContact(numero, cfg) {
  if (!numero) return 'inconnu';
  // En démo, le responsable est le téléphone simulé : un vrai portable de test joue toujours le client.
  const demo = cfg.demo && cfg.demo.actif;
  if (demo ? numero === cfg.demo.responsable : numero === cfg.numeroDirigeant) return 'dirigeant';
  const c = (cfg.contacts || []).find((x) => normaliserTelephone(x.numero) === numero);
  return c ? c.type : 'client';
}

// --- Mots-clés et choix ----------------------------------------------------------

function normaliserTexte(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[’']/g, ' ').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const MOTS_CLES = [
  ['STOP', /^(STOP|STOP SMS|ARRET|ARRETER|DESABONNER|DESINSCRIRE|DESINSCRIPTION)$/],
  ['PAUSE', /^PAUSE$/],
  ['REPRISE', /^(REPRISE|REPRENDRE|START|RELANCER)$/],
  ['OUI', /^(OUI|OUI MERCI|OUI JE CONFIRME|OK|OKAY|D ACCORD|DACCORD|JE CONFIRME|CONFIRME|CONFIRMER|CONFIRMATION|C EST BON|PARFAIT|YES)$/],
  ['ANNULER', /^(ANNULER|ANNULE|ANNULATION|JE VEUX ANNULER|ANNULER LE RDV|ANNULER MON RDV|ANNULER LE RENDEZ VOUS)$/],
  ['DEPLACER', /^(DEPLACER|DEPLACE|DECALER|REPORTER|CHANGER|MODIFIER|JE VEUX DEPLACER|DEPLACER LE RDV|DEPLACER MON RDV|DEPLACER LE RENDEZ VOUS)$/],
  ['URGENT', /^(URGENT|URGENCE|C EST URGENT|TRES URGENT)$/],
  ['AUTRE', /^(AUTRE|AUTRES|AUTRE DATE|AUTRES DATES|AUTRE CRENEAU|AUTRES CRENEAUX)$/],
  ['ATTENTE', /^(ATTENTE|LISTE D ATTENTE|LISTE)$/],
  ['RAPPEL', /^(RAPPEL|RAPPELEZ MOI|RAPPELER|APPELEZ MOI|APPELEZ MOI SVP|RAPPELEZ MOI SVP)$/],
  ['RDV', /^(RDV|UN RDV|RENDEZ VOUS|UN RENDEZ VOUS|NOUVEAU RDV|PRENDRE RDV|PRENDRE UN RDV)$/],
];

// Mot-clé d'un SMS court (« oui », « Annuler ! », « stop »…), ou null.
function motCle(texte) {
  const n = normaliserTexte(texte);
  if (!n || n.length > 40) return null;
  for (const [mot, re] of MOTS_CLES) if (re.test(n)) return mot;
  return null;
}

// Choix d'un créneau (« 2 », « le 2 », « 2 svp », « deuxième »…) : numéro de 1 à n, ou null.
function choixNumero(texte, n) {
  const t = normaliserTexte(texte);
  const mots = { PREMIER: 1, PREMIERE: 1, '1ER': 1, '1ERE': 1, DEUXIEME: 2, SECOND: 2, SECONDE: 2, '2EME': 2, TROISIEME: 3, '3EME': 3 };
  const m = /^(?:LE |LA |N |NO |NUMERO |CRENEAU |CHOIX |OPTION )?([1-9])(?: [A-Z]+){0,3}$/.exec(t);
  let k = m ? Number(m[1]) : null;
  if (!k) {
    const w = /^(?:LE |LA )?([0-9A-Z]+)(?: [A-Z]+){0,3}$/.exec(t);
    if (w && mots[w[1]]) k = mots[w[1]];
  }
  return k && k <= n ? k : null;
}

// --- Modèles de messages (config-client.json > modeles) ---------------------------------

function rendre(nom, vars, cfg) {
  const modele = (cfg.modeles || {})[nom];
  if (!modele) throw new Error('Modèle de message inconnu : ' + nom);
  const v = { entreprise: cfg.nomEntreprise, numero: cfg.numeroAffiche, preparation: cfg.preparation || '', ...vars };
  return modele.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined || v[k] === null ? '' : String(v[k])))
    .replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
}

function listeCreneaux(creneaux) {
  return creneaux.map((c, i) => `${i + 1}) ${libelleCourt(lireDate(c.debut))}`).join('\n');
}

// --- Lignes des tables ------------------------------------------------------------

const lignes = (arr) => (arr || []).filter((l) => l && l.id !== undefined && l.id !== null);

function lireJson(s, defaut) {
  if (s && typeof s === 'object') return s;
  try { const v = JSON.parse(s); return v === null || v === undefined ? defaut : v; } catch (e) { return defaut; }
}

// Réglages vivants (pause demandée par le dirigeant, horloge de la démo), rangés dans la table des conversations.
function reglagesDe(conversations) {
  const r = lignes(conversations).find((c) => c.numero === NUMERO_REGLAGES);
  const v = r ? lireJson(r.choix, {}) : {};
  return { id: r ? r.id : null, pause: !!v.pause, decalageMs: Number(v.decalageMs) || 0 };
}

// Heure utilisée par toutes les décisions : l'heure réelle, ou l'heure simulée de la démo.
function horloge(reglages, reel, cfg) {
  return new Date(reel.getTime() + (cfg.demo && cfg.demo.actif ? reglages.decalageMs : 0));
}

function nouvelleConversation(numero) {
  return { id: null, numero, etape: '', besoin: '', urgence: false, nom: '', adresse: '', creneaux: [], choix: null, rdv_id: '', maj: '' };
}

// Conversation en cours avec un numéro. Après conversationExpireH sans message, on repart de zéro
// (en gardant le nom et l'adresse).
function conversationDe(conversations, numero, maintenant, cfg) {
  const r = lignes(conversations).find((c) => c.numero === numero);
  if (!r) return nouvelleConversation(numero);
  const conv = {
    id: r.id, numero, etape: r.etape || '', besoin: r.besoin || '', urgence: r.urgence === 'oui',
    nom: r.nom || '', adresse: r.adresse || '', creneaux: lireJson(r.creneaux, []) || [],
    choix: lireJson(r.choix, null), rdv_id: r.rdv_id || '', maj: r.maj || '',
  };
  const maj = lireDate(conv.maj);
  if (conv.etape !== 'desabonne' && maj && maintenant - maj > cfg.conversationExpireH * 3600000) {
    Object.assign(conv, { etape: '', besoin: '', urgence: false, creneaux: [], choix: null, rdv_id: '' });
  }
  return conv;
}

function numerosDesabonnes(conversations) {
  return new Set(lignes(conversations).filter((c) => c.etape === 'desabonne').map((c) => c.numero));
}

// --- Rendez-vous (table n8n, partageable avec un agent vocal) ---------------------------------------

function rdvsClient(rdvs, numero, maintenant) {
  return lignes(rdvs).map((l) => ({ ...versRdv(l), ligne: l }))
    .filter((r) => r.id && r.telephone === numero && lireDate(r.debut) && lireDate(r.debut) > maintenant)
    .sort((a, b) => lireDate(a.debut) - lireDate(b.debut));
}

function prochainRdv(rdvs, numero, maintenant) { return rdvsClient(rdvs, numero, maintenant)[0] || null; }

// Identité d'un rendez-vous à une heure donnée : un rendez-vous déplacé reçoit de nouveaux rappels.
function cleRdv(r) { return `${r.id}@${isoParis(lireDate(r.debut)).slice(0, 16)}`; }

// Le créneau est-il encore possible (horaires, délai minimum, aucun chevauchement) ?
function creneauLibre(debut, rdvs, cfg, maintenant, exclureId) {
  const v = validerCreneau(String(debut).slice(0, 16), cfg, maintenant);
  if (v.erreur) return false;
  const evts = lignes(rdvs).filter((r) => String(r.id) !== String(exclureId || '')).map(versEvenement).filter(Boolean);
  return !chevauche(v.deb.getTime(), v.fin.getTime(), intervallesOccupes(evts), (cfg.margeTrajetMin || 0) * 60000);
}

// Créneaux à proposer ; « apres » : seulement ceux qui suivent ce début (bouton AUTRE).
function proposer(rdvs, demande, cfg, maintenant, apres) {
  const evts = lignes(rdvs).map(versEvenement).filter(Boolean);
  let liste = creneauxLibres(evts, demande, { ...cfg, nbPropositions: apres ? 40 : cfg.nbPropositions }, maintenant);
  if (apres) liste = liste.filter((c) => lireDate(c.debut) > lireDate(apres)).slice(0, cfg.nbPropositions);
  return liste;
}

// Ce que le client a demandé (jour, matin ou après-midi) -> demande pour creneauxLibres.
function demandeCreneaux(x, maintenant, cfg) {
  let jourDebut = jourParis(maintenant); // aujourd'hui : le délai minimum écarte les créneaux trop proches
  if (x && /^\d{4}-\d{2}-\d{2}$/.test(x.jour || '') && x.jour > jourDebut) jourDebut = x.jour;
  const partie = x && ['matin', 'apres-midi'].includes(x.partie) ? x.partie : 'indifferent';
  return { jourDebut, nbJours: cfg.horizonJours, partie };
}

// --- Plans ------------------------------------------------------------------------

function planVide() {
  return { entrees: [], envois: [], conversations: [], rdv: [], attente: [], messages: [], reglages: null, resume: '', info: '' };
}

const envoiSms = (numero, texte, contexte, ref = '', proactif = false) => ({ canal: 'sms', numero, texte, contexte, ref: String(ref || ''), proactif });
const envoiAlerte = (titre, texte, { numero = '', priorite = 'default', tags = '', contexte = 'alerte', ref = '' } = {}) => ({
  canal: 'alerte', numero, titre, texte, priorite, tags, contexte, ref: String(ref || ''), proactif: false,
});

function enregistrer(plan, conv) { plan.conversations.push({ op: 'enregistrer', conv: { ...conv } }); }

// --- 1.1 · Appel manqué ------------------------------------------------------------------

// ctx : { cfg, maintenant, numeroBrut, conversations, rdvs, messages, reglages }
function traiterAppelManque(ctx) {
  const { cfg, maintenant } = ctx;
  const plan = planVide();
  const numero = numeroMasque(ctx.numeroBrut) ? null : normaliserTelephone(ctx.numeroBrut);
  plan.entrees.push({ canal: 'appel', numero: numero || '', texte: 'Appel manqué', contexte: 'appel-manque' });
  if (!numero) {
    plan.envois.push(envoiAlerte('Appel manqué', 'Numéro masqué : impossible de répondre par SMS.', { priorite: 'low', tags: 'telephone_receiver' }));
    plan.resume = 'numéro masqué : compté, pas de SMS';
    return plan;
  }
  const lisible = numeroLisible(numero);
  const type = typeContact(numero, cfg);
  if (type === 'dirigeant' || type === 'exclu') { plan.resume = `numéro ${type} : rien envoyé`; return plan; }
  if (ctx.reglages.pause) {
    plan.envois.push(envoiAlerte('Appel manqué (accueil en pause)', `${lisible} : aucun SMS envoyé pendant la pause.`, { numero, tags: 'pause_button' }));
    plan.resume = 'en pause';
    return plan;
  }
  const conv = conversationDe(ctx.conversations, numero, maintenant, cfg);
  if (conv.etape === 'desabonne') {
    plan.envois.push(envoiAlerte('Appel manqué', `${lisible} : client désinscrit des SMS, à rappeler.`, { numero, tags: 'telephone_receiver' }));
    plan.resume = 'client désinscrit';
    return plan;
  }
  if (estFixeFrancais(numero)) {
    plan.envois.push(envoiAlerte('Appel manqué (fixe)', `${lisible} : un fixe ne reçoit pas de SMS, à rappeler.`, { numero, priorite: 'high', tags: 'telephone_receiver' }));
    plan.resume = 'fixe : alerte au dirigeant';
    return plan;
  }
  const limite = maintenant.getTime() - cfg.antiDoublonMin * 60000;
  const doublon = lignes(ctx.messages).some((m) => {
    const d = lireDate(m.date);
    // Un SMS refusé par l'opérateur (statut « echec ») ne compte pas : le client n'a rien reçu.
    return m.canal === 'sms' && m.sens === 'sortant' && m.numero === numero && /^appel-manque/.test(m.contexte || '')
      && m.statut !== 'echec' && d && d.getTime() >= limite && d <= maintenant;
  });
  if (doublon) { plan.resume = `déjà rappelé par SMS il y a moins de ${cfg.antiDoublonMin} min`; return plan; }

  if (type === 'fournisseur') {
    plan.envois.push(envoiSms(numero, rendre('appelManqueFournisseur', {}, cfg), 'appel-manque-fournisseur'));
    const nom = ((cfg.contacts || []).find((c) => normaliserTelephone(c.numero) === numero) || {}).nom || 'Fournisseur';
    plan.envois.push(envoiAlerte('Appel manqué (fournisseur)', `${nom} (${lisible}) : à rappeler.`, { numero, tags: 'package' }));
    plan.resume = 'fournisseur';
    return plan;
  }
  const prochain = prochainRdv(ctx.rdvs, numero, maintenant);
  if (prochain) {
    plan.envois.push(envoiSms(numero, rendre('appelManqueClient', { creneau: libelleCourt(lireDate(prochain.debut)) }, cfg), 'appel-manque-client', cleRdv(prochain)));
    enregistrer(plan, { ...conv, etape: 'reserve', maj: dateMessage(maintenant) });
    plan.envois.push(envoiAlerte('Appel manqué (client)', `${prochain.nom || lisible} a appelé ; rendez-vous ${libelleParis(lireDate(prochain.debut))}. SMS envoyé.`, { numero, priorite: 'low', tags: 'telephone_receiver' }));
    plan.resume = 'client avec rendez-vous';
    return plan;
  }
  const calme = heuresCalmes(maintenant, cfg);
  if (calme && cfg.metierUrgence) {
    plan.envois.push(envoiSms(numero, rendre('appelManqueNuit', {}, cfg), 'appel-manque-nuit'));
  } else {
    plan.envois.push(envoiSms(numero, rendre('appelManque', {}, cfg), 'appel-manque', '', calme)); // la nuit : programmé pour 8 h
  }
  enregistrer(plan, { ...conv, etape: 'attente_besoin', besoin: '', urgence: false, creneaux: [], choix: null, rdv_id: '', maj: dateMessage(maintenant) });
  plan.envois.push(envoiAlerte('Appel manqué', `${lisible} : ${calme && !cfg.metierUrgence ? 'SMS programmé pour ' + cfg.envoi.debut.replace(':', ' h ') : 'SMS envoyé, la conversation continue par écrit'}.`, { numero, priorite: 'low', tags: 'telephone_receiver' }));
  plan.resume = calme ? 'appel manqué de nuit' : 'appel manqué';
  return plan;
}

// --- 1.1 et 1.5 · SMS reçu ------------------------------------------------------------

// Texte transmis à Claude pour comprendre un SMS libre.
function texteIA(conv, texte, maintenant) {
  const etapes = {
    '': 'début de conversation', attente_besoin: 'on attend que le client décrive son besoin',
    choix_creneau: 'le client doit choisir un des créneaux proposés', coordonnees: 'on attend son nom et son adresse',
    reserve: 'rendez-vous déjà pris', urgence: 'urgence signalée', rappel: 'rappel demandé', termine: 'conversation terminée', relance: 'relancé après une absence',
  };
  return [
    `Date et heure : ${libelleParis(maintenant)} (heure de Paris). Aujourd'hui : ${jourParis(maintenant)}.`,
    `Étape de la conversation : ${etapes[conv.etape] || conv.etape}.`,
    conv.creneaux.length ? `Créneaux proposés : ${conv.creneaux.map((c, i) => `${i + 1}) ${libelleParis(lireDate(c.debut))}`).join(' ; ')}.` : '',
    `Déjà connu : besoin « ${conv.besoin || '?'} », nom « ${conv.nom || '?'} », adresse « ${conv.adresse || '?'} ».`,
    `SMS du client : « ${texte} »`,
  ].filter(Boolean).join('\n');
}

const VIDES = /^(|null|undefined|inconnu|inconnue|non precise|non précisé|non précisée|n\/a|na|aucun|aucune|vide|-|\?)$/i;
const champ = (v) => (typeof v === 'string' && !VIDES.test(v.trim()) ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : '');

// Réponse de Claude nettoyée ; sans Claude (panne), quelques règles simples prennent le relais.
function lireExtraction(x, texte, conv) {
  if (x && typeof x === 'object' && !x.error) {
    const jour = champ(x.jour);
    const partie = normaliserTexte(x.partie).replace(' ', '-').toLowerCase();
    return {
      intention: champ(x.intention).toLowerCase(), besoin: champ(x.besoin), urgence: x.urgence === true || x.urgence === 'true',
      nom: champ(x.nom).slice(0, 80), adresse: champ(x.adresse), jour: /^\d{4}-\d{2}-\d{2}$/.test(jour) ? jour : '',
      partie: ['matin', 'apres-midi'].includes(partie) ? partie : '', rappel: x.rappel === true || x.rappel === 'true',
    };
  }
  const t = String(texte || '');
  const res = { intention: 'besoin', besoin: '', urgence: /\b(urgen|inond|d[ée]g[âa]t des eaux|gaz)/i.test(t), nom: '', adresse: '', jour: '', partie: '', rappel: /rappel/i.test(t) };
  if (conv.etape === 'coordonnees') {
    const i = t.indexOf(',');
    if (i > 0 && /\d/.test(t.slice(i))) { res.nom = t.slice(0, i).trim().slice(0, 80); res.adresse = t.slice(i + 1).trim().slice(0, 200); }
    res.intention = 'coordonnees';
  } else if (t.trim().length > 3) {
    res.besoin = t.trim().slice(0, 120);
  }
  if (/apr[eè]s[- ]midi/i.test(t)) res.partie = 'apres-midi';
  else if (/\bmatin/i.test(t)) res.partie = 'matin';
  return res;
}

// ctx : { cfg, maintenant, numeroBrut, texte, conversations, rdvs, attente, messages, reglages }
// extraction : undefined = première lecture ; objet = réponse de Claude ; null = Claude indisponible.
// Renvoie { besoinIA: true, texteIA } quand il faut d'abord demander à Claude, sinon un plan.
function traiterSms(ctx, extraction) {
  const { cfg, maintenant } = ctx;
  const plan = planVide();
  const numero = normaliserTelephone(ctx.numeroBrut);
  const texte = String(ctx.texte || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  plan.entrees.push({ canal: 'sms', numero: numero || '', texte, contexte: 'sms-recu' });
  if (!numero) { plan.resume = 'numéro invalide'; return plan; }
  const lisible = numeroLisible(numero);
  const kw = motCle(texte);
  const type = typeContact(numero, cfg);

  // Le dirigeant pilote l'accueil : PAUSE (ou STOP) suspend tout, REPRISE relance.
  if (type === 'dirigeant') {
    if (kw === 'PAUSE' || kw === 'STOP') {
      plan.reglages = { ...ctx.reglages, pause: true };
      plan.envois.push(envoiAlerte('Accueil SMS en pause', 'Plus aucun SMS automatique aux clients. Écrivez REPRISE pour relancer.', { tags: 'pause_button' }));
    } else if (kw === 'REPRISE') {
      plan.reglages = { ...ctx.reglages, pause: false };
      plan.envois.push(envoiAlerte('Accueil SMS relancé', 'Les SMS automatiques reprennent.', { tags: 'arrow_forward' }));
    } else {
      plan.envois.push(envoiAlerte('Commande non comprise', 'Commandes possibles : PAUSE (tout suspendre) ou REPRISE.', { priorite: 'low', tags: 'grey_question' }));
    }
    plan.resume = 'commande du dirigeant';
    return plan;
  }
  if (type === 'exclu') { plan.resume = 'numéro exclu'; return plan; }
  if (type === 'fournisseur') {
    plan.envois.push(envoiAlerte('SMS d\'un fournisseur', `${lisible} : « ${texte} »`, { numero, tags: 'package' }));
    plan.resume = 'fournisseur : transmis';
    return plan;
  }

  const conv = conversationDe(ctx.conversations, numero, maintenant, cfg);
  conv.maj = dateMessage(maintenant);

  // STOP : obligation légale, toujours respectée, même en pause.
  if (kw === 'STOP') {
    enregistrer(plan, { ...conv, etape: 'desabonne' });
    plan.envois.push(envoiSms(numero, rendre('stop', {}, cfg), 'stop'));
    plan.envois.push(envoiAlerte('Client désinscrit des SMS', `${lisible} a répondu STOP.`, { numero, priorite: 'low', tags: 'no_bell' }));
    plan.resume = 'désinscription';
    return plan;
  }
  if (conv.etape === 'desabonne') {
    if (kw === 'REPRISE') {
      enregistrer(plan, { ...conv, etape: '' });
      plan.envois.push(envoiSms(numero, rendre('reabonne', {}, cfg), 'reabonnement'));
      plan.resume = 'réinscription';
    } else {
      plan.envois.push(envoiAlerte('Message d\'un client désinscrit', `${lisible} : « ${texte} »`, { numero, tags: 'speech_balloon' }));
      plan.resume = 'client désinscrit : transmis sans réponse';
    }
    return plan;
  }
  if (ctx.reglages.pause) {
    plan.envois.push(envoiAlerte('Message reçu (accueil en pause)', `${lisible} : « ${texte} »`, { numero, tags: 'speech_balloon' }));
    plan.resume = 'en pause : transmis sans réponse';
    return plan;
  }

  // Réponse « OUI » à une place libérée (liste d'attente) : premier arrivé, premier servi.
  const offre = lignes(ctx.attente).filter((a) => a.numero === numero && a.statut === 'propose').pop();
  if (offre && kw === 'OUI') return repondreOffre(ctx, plan, conv, offre);

  const prochain = prochainRdv(ctx.rdvs, numero, maintenant);
  if (kw === 'OUI' && prochain) {
    const deb = lireDate(prochain.debut);
    plan.envois.push(envoiSms(numero, rendre('merciConfirmation', { creneau: libelleParis(deb) }, cfg), 'confirmation', cleRdv(prochain)));
    plan.envois.push(envoiAlerte('Rendez-vous confirmé', `${prochain.nom || lisible} confirme ${libelleParis(deb)}.`, { numero, priorite: 'low', tags: 'white_check_mark' }));
    enregistrer(plan, { ...conv, etape: 'reserve' });
    plan.resume = 'confirmation';
    return plan;
  }
  if (kw === 'ANNULER') {
    if (!prochain) {
      plan.envois.push(envoiSms(numero, rendre('aucunRdv', {}, cfg), 'aucun-rdv'));
      enregistrer(plan, { ...conv, etape: 'termine', creneaux: [], choix: null, rdv_id: '' });
      plan.resume = 'annulation sans rendez-vous';
      return plan;
    }
    const deb = lireDate(prochain.debut);
    plan.rdv.push({ op: 'supprimer', id: prochain.idBrut });
    plan.envois.push(envoiSms(numero, rendre('annulation', { creneau: libelleParis(deb) }, cfg), 'annulation', cleRdv(prochain)));
    plan.envois.push(envoiAlerte('Rendez-vous annulé', `${prochain.nom || lisible} annule ${libelleParis(deb)} (${prochain.adresse}). Le créneau est libéré.`, { numero, tags: 'x' }));
    enregistrer(plan, { ...conv, etape: 'termine', creneaux: [], choix: null, rdv_id: '' });
    offresAttente(ctx, plan, { debut: prochain.debut }, numero);
    plan.resume = 'annulation';
    return plan;
  }
  if (kw === 'DEPLACER') {
    if (!prochain) {
      plan.envois.push(envoiSms(numero, rendre('aucunRdv', {}, cfg), 'aucun-rdv'));
      plan.resume = 'déplacement sans rendez-vous';
      return plan;
    }
    const liste = proposer(ctx.rdvs, demandeCreneaux(null, maintenant, cfg), cfg, maintenant);
    if (!liste.length) return aucunCreneau(ctx, plan, conv);
    plan.envois.push(envoiSms(numero, rendre('deplacerChoix', { liste: listeCreneaux(liste) }, cfg), 'creneaux', cleRdv(prochain)));
    enregistrer(plan, {
      ...conv, etape: 'choix_creneau', creneaux: liste, choix: null, rdv_id: String(prochain.id),
      besoin: prochain.motif || conv.besoin, nom: prochain.nom || conv.nom, adresse: prochain.adresse || conv.adresse,
    });
    plan.resume = 'déplacement : créneaux proposés';
    return plan;
  }
  if (kw === 'URGENT') return urgence(ctx, plan, conv, conv.besoin || 'urgence signalée par SMS');
  if (kw === 'RAPPEL') return rappelDemande(ctx, plan, conv);
  if (kw === 'ATTENTE') return inscrireAttente(ctx, plan, conv);
  if (kw === 'RDV') {
    if (conv.besoin) return proposerCreneaux(ctx, plan, conv, null, 'creneaux');
    plan.envois.push(envoiSms(numero, rendre('demanderBesoin', {}, cfg), 'demande-besoin'));
    enregistrer(plan, { ...conv, etape: 'attente_besoin' });
    plan.resume = 'demande du besoin';
    return plan;
  }
  if (conv.etape === 'choix_creneau') {
    if (kw === 'AUTRE') {
      const dernier = conv.creneaux.length ? conv.creneaux[conv.creneaux.length - 1].debut : null;
      const liste = proposer(ctx.rdvs, demandeCreneaux(null, maintenant, cfg), cfg, maintenant, dernier);
      if (!liste.length) return aucunCreneau(ctx, plan, conv);
      plan.envois.push(envoiSms(numero, rendre('autresCreneaux', { liste: listeCreneaux(liste) }, cfg), 'creneaux'));
      enregistrer(plan, { ...conv, creneaux: liste });
      plan.resume = 'autres créneaux';
      return plan;
    }
    const k = choixNumero(texte, conv.creneaux.length);
    if (k) return choisir(ctx, plan, conv, conv.creneaux[k - 1]);
    if (kw === 'OUI') {
      plan.envois.push(envoiSms(numero, rendre('choixIncompris', {}, cfg), 'choix-incompris'));
      plan.resume = 'choix incompris';
      return plan;
    }
  }

  // Texte libre : Claude le lit d'abord.
  if (extraction === undefined) return { besoinIA: true, texteIA: texteIA(conv, texte, maintenant) };
  const x = lireExtraction(extraction, texte, conv);
  if (x.nom) conv.nom = x.nom;
  if (x.adresse) conv.adresse = x.adresse;
  if (x.besoin) conv.besoin = x.besoin;
  if (x.urgence) return urgence(ctx, plan, conv, x.besoin || conv.besoin || texte);
  if (x.rappel) return rappelDemande(ctx, plan, conv);
  // « 2, Julie Martin, 12 rue des Lilas » : le choix et les coordonnées dans le même SMS.
  const kLibre = conv.etape === 'choix_creneau' ? choixNumero(texte.split(/[ ,.;:)]/)[0], conv.creneaux.length) : null;
  if (kLibre) return choisir(ctx, plan, conv, conv.creneaux[kLibre - 1]);
  if (conv.etape === 'coordonnees' && conv.choix) {
    if (conv.nom && conv.adresse) return choisir(ctx, plan, conv, conv.choix);
    plan.envois.push(envoiSms(numero, conv.nom ? rendre('demanderAdresse', { nom: conv.nom }, cfg) : rendre('demanderNom', {}, cfg), 'coordonnees'));
    enregistrer(plan, conv);
    plan.resume = 'coordonnées incomplètes';
    return plan;
  }
  if (!x.besoin && x.intention === 'remerciement') {
    plan.envois.push(envoiSms(numero, rendre('merci', { salut: salut(maintenant) }, cfg), 'merci'));
    enregistrer(plan, conv);
    plan.resume = 'remerciement';
    return plan;
  }
  if (!x.besoin && x.intention === 'question') {
    plan.envois.push(envoiAlerte('Question d\'un client', `${conv.nom || lisible} : « ${texte} »`, { numero, priorite: 'high', tags: 'speech_balloon' }));
    plan.envois.push(envoiSms(numero, rendre('transmis', {}, cfg), 'transmis'));
    enregistrer(plan, conv);
    plan.resume = 'question transmise';
    return plan;
  }
  if (conv.etape === 'choix_creneau' && (x.jour || x.partie)) return proposerCreneaux(ctx, plan, conv, x, 'autresCreneaux');
  if (x.besoin || ((x.jour || x.partie) && conv.besoin)) return proposerCreneaux(ctx, plan, conv, x, 'creneaux');
  if (conv.etape === 'choix_creneau') {
    plan.envois.push(envoiSms(numero, rendre('choixIncompris', {}, cfg), 'choix-incompris'));
    enregistrer(plan, conv);
    plan.resume = 'choix incompris';
    return plan;
  }
  plan.envois.push(envoiSms(numero, rendre('demanderBesoin', {}, cfg), 'demande-besoin'));
  enregistrer(plan, { ...conv, etape: 'attente_besoin' });
  plan.resume = 'besoin à préciser';
  return plan;
}

function proposerCreneaux(ctx, plan, conv, x, modele) {
  const { cfg, maintenant } = ctx;
  const liste = proposer(ctx.rdvs, demandeCreneaux(x, maintenant, cfg), cfg, maintenant);
  if (!liste.length) return aucunCreneau(ctx, plan, conv);
  plan.envois.push(envoiSms(conv.numero, rendre(modele, { liste: listeCreneaux(liste) }, cfg), 'creneaux'));
  enregistrer(plan, { ...conv, etape: 'choix_creneau', creneaux: liste, choix: null });
  plan.resume = 'créneaux proposés';
  return plan;
}

function aucunCreneau(ctx, plan, conv) {
  plan.envois.push(envoiSms(conv.numero, rendre('aucunCreneau', {}, ctx.cfg), 'aucun-creneau'));
  enregistrer(plan, { ...conv, etape: 'attente_besoin', creneaux: [] });
  plan.resume = 'aucun créneau libre';
  return plan;
}

// Le client a choisi un créneau : on revérifie qu'il est libre, puis on réserve, déplace ou demande les coordonnées.
function choisir(ctx, plan, conv, creneau) {
  const { cfg, maintenant } = ctx;
  const numero = conv.numero;
  if (!creneauLibre(creneau.debut, ctx.rdvs, cfg, maintenant, conv.rdv_id)) {
    const liste = proposer(ctx.rdvs, demandeCreneaux({ jour: String(creneau.debut).slice(0, 10) }, maintenant, cfg), cfg, maintenant);
    if (!liste.length) return aucunCreneau(ctx, plan, conv);
    plan.envois.push(envoiSms(numero, rendre('creneauPris', { liste: listeCreneaux(liste) }, cfg), 'creneaux'));
    enregistrer(plan, { ...conv, etape: 'choix_creneau', creneaux: liste, choix: null });
    plan.resume = 'créneau pris entre-temps';
    return plan;
  }
  const deb = depuisHeureParis(String(creneau.debut).slice(0, 16));
  const fin = new Date(deb.getTime() + cfg.dureeRdvMin * 60000);
  if (conv.rdv_id) { // déplacement d'un rendez-vous existant
    const ancien = lignes(ctx.rdvs).map(versRdv).find((r) => r && r.id === String(conv.rdv_id));
    plan.rdv.push({ op: 'deplacer', id: ancien ? ancien.idBrut : conv.rdv_id, debut: isoParis(deb), fin: isoParis(fin) });
    const adresse = (ancien && ancien.adresse) || conv.adresse;
    plan.envois.push(envoiSms(numero, rendre('deplace', { creneau: libelleParis(deb), adresse, rappel: phraseRappel(deb, maintenant, cfg) }, cfg), 'deplace'));
    plan.envois.push(envoiAlerte('Rendez-vous déplacé', `${conv.nom || numeroLisible(numero)} : ${ancien ? libelleParis(lireDate(ancien.debut)) + ' → ' : ''}${libelleParis(deb)}, ${adresse}.`, { numero, tags: 'arrows_counterclockwise' }));
    enregistrer(plan, { ...conv, etape: 'reserve', creneaux: [], choix: null, rdv_id: '' });
    if (ancien) offresAttente(ctx, plan, { debut: ancien.debut }, numero);
    plan.resume = 'rendez-vous déplacé';
    return plan;
  }
  if (!conv.nom || !conv.adresse) {
    const modele = conv.etape === 'coordonnees' ? (conv.nom ? 'demanderAdresse' : 'demanderNom') : 'demanderCoordonnees';
    plan.envois.push(envoiSms(numero, rendre(modele, { creneau: libelleParis(deb), nom: conv.nom }, cfg), 'coordonnees'));
    enregistrer(plan, { ...conv, etape: 'coordonnees', choix: { debut: creneau.debut } });
    plan.resume = 'coordonnées demandées';
    return plan;
  }
  return reserver(ctx, plan, conv, deb, fin, 'sms');
}

// Phrase sur le prochain rappel, seulement si un rappel partira vraiment (jamais de fausse promesse) :
// mêmes règles que rappelsAEnvoyer.
function phraseRappel(deb, maintenant, cfg) {
  if (!cfg.modules || !cfg.modules.rappels) return '';
  const jourRdv = jourParis(deb);
  if (depuisHeureParis(`${ajouterJours(jourRdv, -1)}T${cfg.rappels.veilleHeure}`) > maintenant) return 'Rappel la veille par SMS.';
  let dueJ = new Date(deb.getTime() - cfg.rappels.heuresAvant * 3600000);
  const ouverture = depuisHeureParis(`${jourRdv}T${cfg.envoi.debut}`);
  if (jourParis(dueJ) !== jourRdv || dueJ < ouverture) dueJ = ouverture;
  return dueJ > maintenant && deb - dueJ >= 45 * 60000 ? 'Rappel par SMS le jour J.' : '';
}

function reserver(ctx, plan, conv, deb, fin, origine) {
  const { cfg, maintenant } = ctx;
  const numero = conv.numero;
  const motif = conv.besoin || 'rendez-vous pris par SMS';
  plan.rdv.push({ op: 'creer', ligne: { debut: isoParis(deb), fin: isoParis(fin), nom: conv.nom, telephone: numero, adresse: conv.adresse, motif, appel_id: origine } });
  const modele = origine === 'liste-attente' ? 'attenteGagne' : 'confirmation';
  plan.envois.push(envoiSms(numero, rendre(modele, { creneau: libelleParis(deb), adresse: conv.adresse, rappel: phraseRappel(deb, maintenant, cfg) }, cfg), origine === 'liste-attente' ? 'attente-gagne' : 'reservation'));
  plan.envois.push(envoiAlerte(origine === 'liste-attente' ? 'Créneau revendu (liste d\'attente)' : 'Nouveau rendez-vous (SMS)',
    `${libelleParis(deb)} – ${conv.nom} ${numeroLisible(numero)} – ${conv.adresse} – ${motif}`, { numero, tags: origine === 'liste-attente' ? 'tada' : 'calendar' }));
  enregistrer(plan, { ...conv, etape: 'reserve', creneaux: [], choix: null, rdv_id: '' });
  plan.resume = origine === 'liste-attente' ? 'place revendue' : 'rendez-vous réservé';
  return plan;
}

function urgence(ctx, plan, conv, description) {
  const lisible = numeroLisible(conv.numero);
  plan.envois.push(envoiAlerte('URGENCE client', `${description} – ${conv.nom || 'nom inconnu'} ${lisible}${conv.adresse ? ' – ' + conv.adresse : ''}. À rappeler tout de suite.`,
    { numero: conv.numero, priorite: 'urgent', tags: 'rotating_light' }));
  plan.envois.push(envoiSms(conv.numero, rendre('urgence', {}, ctx.cfg), 'urgence'));
  enregistrer(plan, { ...conv, etape: 'urgence', urgence: true, besoin: conv.besoin || description });
  plan.resume = 'urgence';
  return plan;
}

function rappelDemande(ctx, plan, conv) {
  const { cfg, maintenant } = ctx;
  const quand = heuresCalmes(maintenant, cfg) ? "dès l'ouverture" : 'dans la journée';
  plan.envois.push(envoiAlerte('Client à rappeler', `${conv.nom || numeroLisible(conv.numero)} ${numeroLisible(conv.numero)}${conv.besoin ? ' – ' + conv.besoin : ''}.`, { numero: conv.numero, priorite: 'high', tags: 'telephone_receiver' }));
  plan.envois.push(envoiSms(conv.numero, rendre('rappelDemande', { quand }, cfg), 'rappel-demande'));
  enregistrer(plan, { ...conv, etape: 'rappel' });
  plan.resume = 'rappel demandé';
  return plan;
}

// --- 1.5 · Liste d'attente ------------------------------------------------------------

function inscrireAttente(ctx, plan, conv) {
  const { cfg, maintenant } = ctx;
  const deja = lignes(ctx.attente).find((a) => a.numero === conv.numero && ['en_attente', 'propose'].includes(a.statut));
  if (!deja) {
    plan.attente.push({ op: 'ajouter', ligne: { numero: conv.numero, nom: conv.nom, adresse: conv.adresse, besoin: conv.besoin, souhait: '', cree_le: dateMessage(maintenant), statut: 'en_attente', ref: '' } });
    plan.envois.push(envoiAlerte('Liste d\'attente', `${conv.nom || numeroLisible(conv.numero)} s'inscrit${conv.besoin ? ' (' + conv.besoin + ')' : ''}.`, { numero: conv.numero, priorite: 'low', tags: 'hourglass' }));
  }
  plan.envois.push(envoiSms(conv.numero, rendre('attenteInscrit', {}, cfg), 'attente-inscrit'));
  enregistrer(plan, { ...conv, etape: 'attente_liste', creneaux: [] });
  plan.resume = "inscription sur la liste d'attente";
  return plan;
}

// Un créneau vient de se libérer : on le propose aux premiers inscrits (les plus anciens d'abord).
function offresAttente(ctx, plan, libere, numeroExclu) {
  const { cfg, maintenant } = ctx;
  if (!cfg.modules || !cfg.modules.listeAttente) return;
  const deb = lireDate(libere.debut);
  if (!deb || deb.getTime() < maintenant.getTime() + cfg.delaiMinimumH * 3600000) return;
  const h = partiesParis(deb).h;
  const desabonnes = numerosDesabonnes(ctx.conversations);
  const ref = isoParis(deb).slice(0, 16);
  const candidats = lignes(ctx.attente).filter((a) => {
    const expiree = a.statut === 'propose' && (!lireDate(a.ref) || lireDate(a.ref) <= maintenant);
    const compatible = !a.souhait || (a.souhait === 'matin' ? h < 12 : a.souhait === 'apres-midi' ? h >= 12 : true);
    return (a.statut === 'en_attente' || expiree) && a.numero !== numeroExclu && !desabonnes.has(a.numero) && compatible;
  }).sort((a, b) => (lireDate(a.cree_le) || 0) - (lireDate(b.cree_le) || 0)).slice(0, cfg.listeAttente.nbOffres);
  for (const c of candidats) {
    plan.attente.push({ op: 'maj', id: c.id, statut: 'propose', ref });
    plan.envois.push(envoiSms(c.numero, rendre('offreAttente', { creneau: libelleParis(deb) }, cfg), 'offre-attente', ref, true));
  }
  if (candidats.length) {
    plan.envois.push(envoiAlerte('Créneau proposé à la liste d\'attente', `${libelleParis(deb)} : proposé à ${candidats.map((c) => c.nom || numeroLisible(c.numero)).join(', ')}. Le premier qui répond OUI l'obtient.`, { priorite: 'low', tags: 'hourglass' }));
  }
}

function repondreOffre(ctx, plan, conv, offre) {
  const { cfg, maintenant } = ctx;
  const deb = lireDate(offre.ref);
  if (deb && deb > maintenant && creneauLibre(offre.ref, ctx.rdvs, cfg, maintenant)) {
    plan.attente.push({ op: 'maj', id: offre.id, statut: 'servi', ref: offre.ref });
    const qui = { ...conv, nom: offre.nom || conv.nom || 'Client liste d\'attente', adresse: offre.adresse || conv.adresse || 'adresse à confirmer', besoin: offre.besoin || conv.besoin || "liste d'attente" };
    return reserver(ctx, plan, qui, deb, new Date(deb.getTime() + cfg.dureeRdvMin * 60000), 'liste-attente');
  }
  plan.attente.push({ op: 'maj', id: offre.id, statut: 'en_attente', ref: '' });
  plan.envois.push(envoiSms(conv.numero, rendre('attentePerdu', {}, cfg), 'attente-perdu'));
  enregistrer(plan, { ...conv, etape: 'attente_liste' });
  plan.resume = 'place déjà prise';
  return plan;
}

// --- 1.5 · Rappels (chaque heure) ---------------------------------------------------------

// Rappel la veille (à partir de 18 h) puis le jour même (3 h avant, jamais avant 8 h). Un seul de chaque,
// jamais pendant les heures calmes, et pas de rappel si le rendez-vous a été pris ou modifié après l'heure du rappel.
function rappelsAEnvoyer(ctx) {
  const { cfg, maintenant } = ctx;
  if (!cfg.modules || !cfg.modules.rappels || heuresCalmes(maintenant, cfg)) return [];
  const msgs = lignes(ctx.messages).filter((m) => m.sens === 'sortant');
  const deja = new Set(msgs.filter((m) => /^rappel-/.test(m.contexte || '')).map((m) => `${m.contexte}|${m.ref}`));
  const confirmes = new Set(msgs.filter((m) => m.contexte === 'confirmation').map((m) => m.ref));
  const desabonnes = numerosDesabonnes(ctx.conversations);
  const res = [];
  for (const l of lignes(ctx.rdvs)) {
    const r = versRdv(l);
    const deb = r && lireDate(r.debut);
    if (!deb || deb <= maintenant || !estMobile(r.telephone) || desabonnes.has(r.telephone)) continue;
    const cle = cleRdv(r);
    const modifie = [lireDate(l.createdAt || l.created_at), lireDate(l.updatedAt || l.updated_at)].filter(Boolean).sort((a, b) => b - a)[0] || null;
    const jourRdv = jourParis(deb);
    const veille = ajouterJours(jourRdv, -1);
    const dueV = depuisHeureParis(`${veille}T${cfg.rappels.veilleHeure}`);
    let dueJ = new Date(deb.getTime() - cfg.rappels.heuresAvant * 3600000);
    const ouverture = depuisHeureParis(`${jourRdv}T${cfg.envoi.debut}`);
    if (jourParis(dueJ) !== jourRdv || dueJ < ouverture) dueJ = ouverture;
    const vars = { heure: heureLibelle(deb), adresse: r.adresse || 'adresse à confirmer', creneau: libelleParis(deb) };
    if (jourParis(maintenant) === veille && maintenant >= dueV && !deja.has(`rappel-veille|${cle}`) && !(modifie && modifie > dueV)) {
      res.push(envoiSms(r.telephone, rendre('rappelVeille', vars, cfg), 'rappel-veille', cle, true));
    } else if (jourParis(maintenant) === jourRdv && maintenant >= dueJ && deb - dueJ >= 45 * 60000 && deb - maintenant >= 30 * 60000
      && !deja.has(`rappel-jour|${cle}`) && !(modifie && modifie > dueJ)) {
      res.push(envoiSms(r.telephone, rendre(confirmes.has(cle) ? 'rappelJourConfirme' : 'rappelJour', vars, cfg), 'rappel-jour', cle, true));
    }
  }
  return res;
}

// Tâche horaire : rappels, SMS programmés pendant la nuit, places proposées restées sans réponse.
function planHoraire(ctx) {
  const { cfg, maintenant } = ctx;
  const plan = planVide();
  if (ctx.reglages.pause) { plan.resume = 'accueil en pause : rien envoyé'; return plan; }
  for (const a of lignes(ctx.attente)) {
    if (a.statut === 'propose' && (!lireDate(a.ref) || lireDate(a.ref) <= maintenant)) plan.attente.push({ op: 'maj', id: a.id, statut: 'en_attente', ref: '' });
  }
  if (heuresCalmes(maintenant, cfg)) { plan.resume = 'heures calmes : rien envoyé'; return plan; }
  const desabonnes = numerosDesabonnes(ctx.conversations);
  for (const m of lignes(ctx.messages).filter((x) => x.statut === 'differe')) {
    plan.messages.push(desabonnes.has(m.numero) ? { op: 'maj', id: m.id, statut: 'bloque' } : { op: 'envoyer', id: m.id, ligne: m });
  }
  plan.envois.push(...rappelsAEnvoyer(ctx));
  plan.resume = `${plan.envois.length} rappel(s), ${plan.messages.filter((m) => m.op === 'envoyer').length} SMS programmé(s) envoyé(s)`;
  return plan;
}

// --- 1.5 · Relance d'un client absent -----------------------------------------------------

function relanceAbsent(ctx, idRdv) {
  const { cfg, maintenant } = ctx;
  const plan = planVide();
  const l = lignes(ctx.rdvs).find((x) => String(x.id) === String(idRdv));
  const r = l && versRdv(l);
  if (!r || !lireDate(r.debut)) { plan.info = 'Rendez-vous introuvable.'; return plan; }
  const deb = lireDate(r.debut);
  if (deb > maintenant) { plan.info = "Ce rendez-vous n'est pas encore passé."; return plan; }
  if (!estMobile(r.telephone)) { plan.info = 'Pas de portable pour ce client : à rappeler.'; return plan; }
  const conv = conversationDe(ctx.conversations, r.telephone, maintenant, cfg);
  plan.envois.push(envoiSms(r.telephone, rendre('relanceAbsent', { nom: r.nom || '', heure: heureLibelle(deb) }, cfg), 'relance-absent', cleRdv(r), true));
  plan.envois.push(envoiAlerte('Client absent relancé', `${r.nom || numeroLisible(r.telephone)} (${libelleParis(deb)}) : SMS envoyé pour reprogrammer.`, { numero: r.telephone, priorite: 'low', tags: 'repeat' }));
  enregistrer(plan, { ...conv, etape: 'relance', besoin: r.motif || conv.besoin, nom: r.nom || conv.nom, adresse: r.adresse || conv.adresse, creneaux: [], choix: null, rdv_id: '', maj: dateMessage(maintenant) });
  plan.resume = 'relance absent';
  plan.info = 'Relance envoyée au client.';
  return plan;
}

// --- Démo : actions des boutons -------------------------------------------------------------

function personnesDemo(cfg) { return ((cfg.demo && cfg.demo.personnes) || []).map((p) => ({ ...p, numero: normaliserTelephone(p.numero) })); }

// ctx.reel : heure réelle ; params : corps de la requête (action, cible, id).
// Rendez-vous que pilotent les boutons « avancer l'horloge » et « absence » : le plus récent du téléphone
// « Vous » ou d'un vrai portable de test.
function rdvDemo(ctx, quand) {
  const client = (personnesDemo(ctx.cfg).find((p) => p.role === 'client') || {}).numero;
  return [client, ...numerosReels(ctx.cfg)].map((n) => prochainRdv(ctx.rdvs, n, quand)).filter(Boolean)
    .sort((a, b) => Number(b.idBrut) - Number(a.idBrut))[0] || null;
}

function actionDemo(ctx, params) {
  const { cfg, reel } = ctx;
  const action = String((params && params.action) || '');
  const aEffacer = (n) => estNumeroDemo(n) || estReel(n, cfg);
  const SANS_RDV = 'Prenez d’abord un rendez-vous par SMS (téléphone « Vous » ou votre vrai portable).';
  let plan = planVide();

  if (action === 'reinitialiser') {
    for (const m of lignes(ctx.messages)) plan.messages.push({ op: 'supprimer', id: m.id });
    for (const c of lignes(ctx.conversations)) if (aEffacer(c.numero)) plan.conversations.push({ op: 'supprimer', id: c.id });
    for (const a of lignes(ctx.attente)) if (aEffacer(a.numero)) plan.attente.push({ op: 'supprimer', id: a.id });
    for (const r of lignes(ctx.rdvs)) if (aEffacer(normaliserTelephone(r.telephone))) plan.rdv.push({ op: 'supprimer', id: r.id });
    personnesDemo(cfg).filter((p) => p.role === 'attente').forEach((p, i) => {
      plan.attente.push({ op: 'ajouter', ligne: { numero: p.numero, nom: p.nom, adresse: p.adresse || '', besoin: p.besoin || '', souhait: p.souhait || '', cree_le: dateMessage(new Date(reel.getTime() - (5 - i) * 3600000)), statut: 'en_attente', ref: '' } });
    });
    plan.reglages = { ...ctx.reglages, pause: false, decalageMs: 0 };
    plan.info = 'Démo remise à zéro : 2 personnes attendent une place.';
    plan.resume = 'réinitialisation';
    return plan;
  }

  if (action === 'horloge') {
    const cible = String(params.cible || '');
    if (cible === 'reel') {
      plan.reglages = { ...ctx.reglages, decalageMs: 0 };
      plan.info = "Retour à l'heure réelle.";
      return plan;
    }
    const r = rdvDemo(ctx, reel);
    if (!r) { plan.info = SANS_RDV; return plan; }
    const deb = lireDate(r.debut);
    let quand;
    if (cible === 'veille') {
      quand = depuisHeureParis(`${ajouterJours(jourParis(deb), -1)}T${cfg.rappels.veilleHeure}`);
      if (quand < reel) { plan.info = 'La veille à ' + heureLibelle(quand) + ' est déjà passée : passez au rappel du jour J.'; return plan; }
    } else if (cible === 'jour') {
      quand = new Date(deb.getTime() - cfg.rappels.heuresAvant * 3600000);
      const ouverture = depuisHeureParis(`${jourParis(deb)}T${cfg.envoi.debut}`);
      if (quand < ouverture) quand = ouverture;
    } else {
      plan.info = 'Action inconnue.';
      return plan;
    }
    quand = new Date(Math.max(quand.getTime(), reel.getTime()) + 2 * 60000);
    const reglages = { ...ctx.reglages, decalageMs: Math.max(0, quand.getTime() - reel.getTime()) };
    plan = planHoraire({ ...ctx, reglages, maintenant: quand });
    plan.reglages = reglages;
    plan.maintenant = quand;
    plan.info = `Horloge avancée : ${libelleParis(quand)}.`;
    return plan;
  }

  if (action === 'absent') {
    const r = rdvDemo(ctx, reel);
    if (!r) { plan.info = SANS_RDV; return plan; }
    const apres = new Date(lireDate(r.fin || r.debut).getTime() + 30 * 60000);
    const reglages = { ...ctx.reglages, decalageMs: Math.max(0, apres.getTime() - reel.getTime()) };
    plan = relanceAbsent({ ...ctx, reglages, maintenant: apres }, r.id);
    plan.reglages = reglages;
    plan.maintenant = apres;
    plan.info = `Horloge : ${libelleParis(apres)}. ${plan.info}`;
    return plan;
  }

  plan.info = 'Action inconnue.';
  return plan;
}

// --- Démo : ce qu'affichent les deux téléphones ---------------------------------------------------

function etatDemo(ctx) {
  const { cfg, maintenant, reglages } = ctx;
  const msgs = lignes(ctx.messages).slice().sort((a, b) => Number(a.id) - Number(b.id));
  const court = (m) => {
    const d = lireDate(m.date);
    return { id: m.id, sens: m.sens, canal: m.canal, texte: m.texte, contexte: m.contexte, statut: m.statut, segments: Number(m.segments) || 0, jour: d ? jourLibelle(d) : '', heure: d ? heureLibelle(d).replace(' h ', ':').replace(/ h$/, ':00') : '' };
  };
  const personnes = personnesDemo(cfg);
  const fils = {};
  const dansFil = (m) => m.canal === 'sms' || m.canal === 'appel';
  for (const p of personnes) fils[p.numero] = msgs.filter((m) => m.numero === p.numero && dansFil(m)).map(court);
  // Vrai portable de test : un onglet de plus, numéro masqué (jamais envoyé en entier à la page).
  // La clé suit la place du numéro dans NUMEROS_REELS, comme numeroEntrant().
  numerosReels(cfg).forEach((n, i) => {
    if (!msgs.some((m) => m.numero === n)) return;
    const cle = `reel-${i + 1}`;
    personnes.push({ numero: cle, nom: 'Votre portable', role: 'reel', masque: masquerNumero(n) });
    fils[cle] = msgs.filter((m) => m.numero === n && dansFil(m)).map(court);
  });
  const alertes = msgs.filter((m) => m.canal === 'alerte' || (m.canal === 'sms' && m.numero === cfg.demo.responsable && m.sens === 'entrant'))
    .map((m) => ({ ...court(m), titre: m.canal === 'alerte' ? m.titre : 'Commande envoyée', priorite: m.priorite || 'default', tags: m.tags || '' }))
    .reverse().slice(0, 60);
  const sortants = msgs.filter((m) => m.sens === 'sortant');
  const compte = (re) => sortants.filter((m) => re.test(m.contexte || '')).length;
  const refs = (ctxt) => new Set(sortants.filter((m) => m.contexte === ctxt).map((m) => m.ref));
  const [conf, rv, rj] = [refs('confirmation'), refs('rappel-veille'), refs('rappel-jour')];
  const agenda = lignes(ctx.rdvs).map((l) => {
    const r = versRdv(l); const deb = r && lireDate(r.debut); const fin = r && lireDate(r.fin);
    if (!deb || (fin || deb) < new Date(maintenant.getTime() - 12 * 3600000)) return null;
    const tel = normaliserTelephone(r.telephone);
    const cle = cleRdv(r);
    return {
      id: r.id, debut: r.debut, quand: libelleCourt(deb), nom: r.nom, adresse: r.adresse, motif: r.motif,
      telephone: estNumeroDemo(tel) ? numeroLisible(tel) : masquerNumero(tel),
      source: l.appel_id === 'sms' ? 'SMS' : l.appel_id === 'liste-attente' ? "Liste d'attente" : 'Appel (agent vocal)',
      confirme: conf.has(cle), rappelVeille: rv.has(cle), rappelJour: rj.has(cle), passe: (fin || deb) < maintenant,
    };
  }).filter(Boolean).sort((a, b) => lireDate(a.debut) - lireDate(b.debut));
  const attente = lignes(ctx.attente).filter((a) => a.statut !== 'servi')
    .sort((a, b) => (lireDate(a.cree_le) || 0) - (lireDate(b.cree_le) || 0))
    .map((a) => ({ nom: a.nom || numeroLisible(a.numero), besoin: a.besoin, statut: a.statut, souhait: a.souhait }));
  const smsSortants = sortants.filter((m) => m.canal === 'sms' && m.statut === 'envoye');
  return {
    entreprise: cfg.nomEntreprise,
    horloge: { libelle: libelleParis(maintenant), jour: jourLibelle(maintenant), heure: heureLibelle(maintenant), simulee: reglages.decalageMs > 0, decalageH: Math.round(reglages.decalageMs / 360000) / 10 },
    pause: reglages.pause,
    calme: heuresCalmes(maintenant, cfg),
    smsReels: !!cfg.smsActifs,
    personnes: personnes.map((p) => ({ numero: p.numero, nom: p.nom, role: p.role, lisible: p.masque || numeroLisible(p.numero) })),
    responsable: cfg.demo.responsable,
    contacts: (cfg.contacts || []).map((c) => ({ numero: normaliserTelephone(c.numero), nom: c.nom, type: c.type })),
    fils, alertes, agenda, attente,
    compteurs: {
      appelsManques: msgs.filter((m) => m.canal === 'appel').length,
      smsEnvoyes: smsSortants.length,
      segments: smsSortants.reduce((t, m) => t + (Number(m.segments) || 0), 0),
      conversations: new Set(msgs.filter((m) => m.canal === 'sms' && m.sens === 'entrant' && (estNumeroDemo(m.numero) || estReel(m.numero, cfg)) && m.numero !== cfg.demo.responsable).map((m) => m.numero)).size,
      rdvPris: compte(/^(reservation|attente-gagne)$/),
      urgences: compte(/^urgence$/),
      rappels: compte(/^rappel-(veille|jour)$/),
      confirmations: compte(/^confirmation$/),
      annulations: compte(/^annulation$/),
      revendus: compte(/^attente-gagne$/),
      programmes: msgs.filter((m) => m.statut === 'differe').length,
    },
  };
}

// --- RGPD : conservation limitée ----------------------------------------------------------

function purgeRgpd(ctx) {
  const { cfg, maintenant } = ctx;
  const plan = planVide();
  const c = cfg.conservation;
  for (const x of lignesAPurger(lignes(ctx.messages), 'date', c.messagesJours, maintenant)) plan.messages.push({ op: 'supprimer', id: x.id });
  const convs = lignes(ctx.conversations).filter((x) => x.numero !== NUMERO_REGLAGES);
  for (const x of lignesAPurger(convs, 'maj', c.conversationsJours, maintenant)) plan.conversations.push({ op: 'supprimer', id: x.id });
  for (const x of lignesAPurger(lignes(ctx.attente), 'cree_le', c.attenteJours, maintenant)) plan.attente.push({ op: 'supprimer', id: x.id });
  plan.resume = `${plan.messages.length} message(s), ${plan.conversations.length} conversation(s), ${plan.attente.length} inscription(s) effacés`;
  return plan;
}

// --- Plan -> opérations du circuit n8n ---------------------------------------------------------

// Numéro de sortie du bloc « Quelle opération ? » : les suppressions d'abord, les messages en dernier.
const SORTIES = {
  'rdv-supprimer': 0, 'rdv-deplacer': 1, 'rdv-creer': 2, 'conv-supprimer': 3, 'conv-maj': 4, 'conv-creer': 5,
  'attente-supprimer': 6, 'attente-maj': 7, 'attente-ajouter': 8, 'msg-supprimer': 9, 'msg-maj': 10, 'msg-creer': 11, 'envoyer': 12,
};

function ligneConversation(conv, maintenant) {
  return {
    numero: conv.numero, etape: conv.etape || '', besoin: conv.besoin || '', urgence: conv.urgence ? 'oui' : 'non',
    nom: conv.nom || '', adresse: conv.adresse || '', creneaux: JSON.stringify(conv.creneaux || []),
    choix: conv.choix ? JSON.stringify(conv.choix) : '', rdv_id: String(conv.rdv_id || ''), maj: conv.maj || dateMessage(maintenant),
  };
}

// Chaque élément du plan devient une ligne à écrire. Les SMS reçoivent ici leur statut :
// envoye, differe (heures calmes : envoyé à 8 h) ou bloque (client désinscrit, numéro fixe).
function operations(plan, ctx) {
  const { cfg } = ctx;
  // Heure du plan (heure simulée après « avancer l'horloge »), sinon celle du contexte.
  const maintenant = plan.maintenant ? new Date(plan.maintenant) : ctx.maintenant;
  const ops = [];
  const op = (nom, donnees) => ops.push({ op: nom, sortie: SORTIES[nom], ...donnees });
  const date = dateMessage(maintenant);
  for (const r of plan.rdv) {
    if (r.op === 'supprimer') op('rdv-supprimer', { id: r.id });
    if (r.op === 'deplacer') op('rdv-deplacer', { id: r.id, debut: r.debut, fin: r.fin });
    if (r.op === 'creer') op('rdv-creer', r.ligne);
  }
  const desabonnes = numerosDesabonnes(ctx.conversations);
  for (const c of plan.conversations) {
    if (c.op === 'supprimer') { op('conv-supprimer', { id: c.id }); continue; }
    const ligne = ligneConversation(c.conv, maintenant);
    if (ligne.etape === 'desabonne') desabonnes.add(ligne.numero); else desabonnes.delete(ligne.numero);
    if (c.conv.id !== null && c.conv.id !== undefined) op('conv-maj', { id: c.conv.id, ...ligne });
    else op('conv-creer', ligne);
  }
  if (plan.reglages) {
    const ligne = { numero: NUMERO_REGLAGES, etape: 'reglages', besoin: '', urgence: 'non', nom: '', adresse: '', creneaux: '[]', rdv_id: '', maj: date, choix: JSON.stringify({ pause: !!plan.reglages.pause, decalageMs: plan.reglages.decalageMs || 0 }) };
    const id = ctx.reglages && ctx.reglages.id;
    if (id !== null && id !== undefined) op('conv-maj', { id, ...ligne }); else op('conv-creer', ligne);
  }
  for (const a of plan.attente) {
    if (a.op === 'supprimer') op('attente-supprimer', { id: a.id });
    if (a.op === 'maj') op('attente-maj', { id: a.id, statut: a.statut, ref: a.ref || '' });
    if (a.op === 'ajouter') op('attente-ajouter', a.ligne);
  }
  for (const m of plan.messages) {
    if (m.op === 'supprimer') op('msg-supprimer', { id: m.id });
    if (m.op === 'maj') op('msg-maj', { id: m.id, statut: m.statut, date });
    if (m.op === 'envoyer') {
      op('msg-maj', { id: m.id, statut: 'envoye', date });
      op('envoyer', { canal: m.ligne.canal, sens: 'sortant', numero: m.ligne.numero, texte: m.ligne.texte, titre: m.ligne.titre || '', priorite: m.ligne.priorite || 'default', tags: m.ligne.tags || '', statut: 'envoye' });
    }
  }
  for (const e of plan.entrees) {
    op('msg-creer', { date, canal: e.canal, sens: 'entrant', numero: e.numero, texte: e.texte, contexte: e.contexte, ref: '', statut: 'recu', titre: '', priorite: '', tags: '', segments: e.canal === 'sms' ? segmentsSms(e.texte).segments : 0 });
  }
  // En démo, le numéro d'un vrai portable de test n'apparaît jamais en entier dans les alertes (écran, ntfy, vidéo).
  const masquer = (t) => (cfg.demo && cfg.demo.actif
    ? numerosReels(cfg).reduce((s, n) => s.split(numeroLisible(n)).join(masquerNumero(n)), String(t || '')) : t);
  for (const e of plan.envois) {
    let texte = e.texte;
    let statut = 'envoye';
    if (e.canal === 'alerte') texte = masquer(texte);
    if (e.canal === 'sms') {
      texte = versGsm(texte);
      if (desabonnes.has(e.numero) && e.contexte !== 'stop') statut = 'bloque';
      else if (estFixeFrancais(e.numero)) statut = 'bloque';
      else if (e.proactif && heuresCalmes(maintenant, cfg)) statut = 'differe';
    }
    op('msg-creer', {
      date, canal: e.canal, sens: 'sortant', numero: e.numero || '', texte, contexte: e.contexte, ref: e.ref || '', statut,
      titre: e.titre || '', priorite: e.priorite || '', tags: e.tags || '', segments: e.canal === 'sms' ? segmentsSms(texte).segments : 0,
    });
  }
  return ops;
}

module.exports = {
  versGsm, segmentsSms, minutesParis, heuresCalmes, dateMessage, libelleCourt, numeroLisible, masquerNumero,
  estNumeroDemo, numerosReels, estReel, numeroEntrant, numeroMasque, estFixeFrancais, typeContact, normaliserTexte, motCle, choixNumero, rendre,
  listeCreneaux, reglagesDe, horloge, conversationDe, rdvsClient, prochainRdv, cleRdv, creneauLibre, proposer,
  demandeCreneaux, planVide, traiterAppelManque, texteIA, lireExtraction, traiterSms, offresAttente,
  phraseRappel, rappelsAEnvoyer, planHoraire, relanceAbsent, actionDemo, etatDemo, purgeRgpd, operations, SORTIES, NUMERO_REGLAGES,
};
