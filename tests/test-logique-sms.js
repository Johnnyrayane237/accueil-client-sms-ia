// Tests de la logique SMS (fiches 1.1 et 1.5). Lancer : node tests/test-logique-sms.js
// Aucun envoi, aucun appel réseau : on vérifie les décisions (plans) pour chaque situation de la fiche.
const assert = require('assert');
const path = require('path');
const L = require('../logique/logique-sms.js');
const { chargerConfig } = require('../charger-config.js');

const cfg = chargerConfig(path.join(__dirname, '..'));
let ok = 0;
const t = (nom, fn) => {
  try { fn(); ok++; console.log('OK  ', nom); } catch (e) { console.log('ÉCHEC', nom, '\n     ', e.stack.split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; }
};
const P = (s) => depuisHeureParis(s); // heure de Paris -> Date
const VOUS = '+33639980001';
const DURAND = '+33639980002';
const PETIT = '+33639980003';
const VENDREDI_10H = P('2026-11-20T10:00');
const reglages = { id: 7, pause: false, decalageMs: 0 };
const ctx = (extra = {}) => ({ cfg, maintenant: VENDREDI_10H, reel: VENDREDI_10H, conversations: [], rdvs: [], attente: [], messages: [], reglages, ...extra });
const sms = (plan) => plan.envois.filter((e) => e.canal === 'sms');
const alertes = (plan) => plan.envois.filter((e) => e.canal === 'alerte');
const conv = (plan) => (plan.conversations.find((c) => c.op === 'enregistrer') || {}).conv;
const rdv = (id, debut, extra = {}) => ({ id, debut: isoParis(P(debut)), fin: isoParis(new Date(P(debut).getTime() + 3600000)), nom: 'Julie Martin', telephone: VOUS, adresse: '12 rue des Lilas, Montreuil', motif: 'fuite sous l’évier', appel_id: 'sms', createdAt: '2026-11-20T09:00:00.000Z', ...extra });
const ligneConv = (c) => ({ id: c.id || 1, numero: c.numero || VOUS, etape: c.etape || '', besoin: c.besoin || '', urgence: 'non', nom: c.nom || '', adresse: c.adresse || '', creneaux: JSON.stringify(c.creneaux || []), choix: c.choix ? JSON.stringify(c.choix) : '', rdv_id: c.rdv_id || '', maj: c.maj || '2026-11-20 09:55' });
const attenteDemo = [
  { id: 11, numero: DURAND, nom: 'Mme Durand', adresse: '8 avenue Jean Jaurès, Montreuil', besoin: 'chauffe-eau', souhait: '', cree_le: '2026-11-19 08:00', statut: 'en_attente', ref: '' },
  { id: 12, numero: PETIT, nom: 'M. Petit', adresse: '21 rue de Paris, Bagnolet', besoin: 'robinet', souhait: '', cree_le: '2026-11-19 09:00', statut: 'en_attente', ref: '' },
];

// ------------------------------------------------------------- SMS : alphabet et longueur
t('GSM-7 : les accents incompatibles sont remplacés, é è à ù gardés', () => {
  assert.strictEqual(L.versGsm('Prêt ? Ça marche, à côté de l’évier 👍'), "Pret ? Ça marche, à coté de l'évier");
  assert.strictEqual(L.segmentsSms('é'.repeat(160)).segments, 1);
  assert.strictEqual(L.segmentsSms('a'.repeat(161)).segments, 2);
  assert.strictEqual(L.segmentsSms('ê').encodage, 'UCS-2');
});
t('modèles : tous en GSM-7, 2 SMS au plus avec des valeurs longues ; l’appel manqué tient en 1 SMS', () => {
  const vars = {
    creneau: 'mercredi 25 novembre à 14 h 30', liste: '1) mercredi 25/11 à 14 h 30\n2) jeudi 26/11 à 8 h\n3) jeudi 26/11 à 14 h',
    adresse: '128 boulevard de la République, Rosny-sous-Bois', heure: '14 h 30', nom: 'Jean-Baptiste Lefèvre', quand: "dès l'ouverture", salut: 'Bonne soirée.', rappel: 'Rappel la veille par SMS.',
  };
  for (const nom of Object.keys(cfg.modeles)) {
    const texte = L.versGsm(L.rendre(nom, vars, cfg));
    const s = L.segmentsSms(texte);
    assert.strictEqual(s.encodage, 'GSM-7', nom);
    assert.ok(s.segments <= 2, `${nom} : ${s.segments} SMS (${s.caracteres} caractères)`);
    assert.ok(!/\{\w+\}/.test(texte), `${nom} : variable non remplacée`);
  }
  assert.strictEqual(L.segmentsSms(L.versGsm(L.rendre('appelManque', {}, cfg))).segments, 1);
});

// ------------------------------------------------------------- Mots-clés
t('mots-clés : réponses courtes reconnues, phrases longues laissées à l’IA', () => {
  assert.strictEqual(L.motCle('oui !'), 'OUI');
  assert.strictEqual(L.motCle('Je confirme'), 'OUI');
  assert.strictEqual(L.motCle('ANNULER'), 'ANNULER');
  assert.strictEqual(L.motCle('déplacer'), 'DEPLACER');
  assert.strictEqual(L.motCle('Stop'), 'STOP');
  assert.strictEqual(L.motCle('urgent'), 'URGENT');
  assert.strictEqual(L.motCle('rendez-vous'), 'RDV');
  assert.strictEqual(L.motCle('je voudrais annuler parce que je ne serai pas là mardi'), null);
});
t('choix d’un créneau : « 2 », « le 2 », « deuxième », mais pas « 5 » sur 3', () => {
  assert.strictEqual(L.choixNumero('2', 3), 2);
  assert.strictEqual(L.choixNumero('le 3 svp', 3), 3);
  assert.strictEqual(L.choixNumero('Deuxième', 3), 2);
  assert.strictEqual(L.choixNumero('5', 3), null);
  assert.strictEqual(L.choixNumero('demain matin', 3), null);
});
t('heures calmes : de 21 h à 8 h', () => {
  assert.strictEqual(L.heuresCalmes(P('2026-11-20T20:59'), cfg), false);
  assert.strictEqual(L.heuresCalmes(P('2026-11-20T21:00'), cfg), true);
  assert.strictEqual(L.heuresCalmes(P('2026-11-21T07:59'), cfg), true);
  assert.strictEqual(L.heuresCalmes(P('2026-11-21T08:00'), cfg), false);
});

// ------------------------------------------------------------- 1.1 Appel manqué
t('appel manqué de jour : SMS immédiat, conversation ouverte, alerte discrète au responsable', () => {
  const plan = L.traiterAppelManque(ctx({ numeroBrut: '06 39 98 00 01' }));
  assert.strictEqual(sms(plan).length, 1);
  assert.strictEqual(sms(plan)[0].contexte, 'appel-manque');
  assert.strictEqual(sms(plan)[0].proactif, false);
  assert.strictEqual(conv(plan).etape, 'attente_besoin');
  assert.strictEqual(alertes(plan)[0].priorite, 'low');
  assert.strictEqual(plan.entrees[0].canal, 'appel');
});
t('appel manqué à 23 h, métier d’urgence : SMS de nuit envoyé tout de suite (« répondez URGENT »)', () => {
  const plan = L.traiterAppelManque(ctx({ numeroBrut: VOUS, maintenant: P('2026-11-20T23:00') }));
  assert.strictEqual(sms(plan)[0].contexte, 'appel-manque-nuit');
  assert.ok(/URGENT/.test(sms(plan)[0].texte));
  const ops = L.operations(plan, ctx({ maintenant: P('2026-11-20T23:00') }));
  assert.strictEqual(ops.find((o) => o.contexte === 'appel-manque-nuit').statut, 'envoye');
});
t('appel manqué à 23 h, métier sans urgence : SMS programmé pour 8 h, pas envoyé de nuit', () => {
  const c2 = { ...cfg, metierUrgence: false };
  const plan = L.traiterAppelManque({ ...ctx({ numeroBrut: VOUS, maintenant: P('2026-11-20T23:00') }), cfg: c2 });
  const ops = L.operations(plan, { ...ctx({ maintenant: P('2026-11-20T23:00') }), cfg: c2 });
  assert.strictEqual(ops.find((o) => o.contexte === 'appel-manque' && o.sens === 'sortant').statut, 'differe');
});
t('numéro masqué : compté, aucun SMS', () => {
  const plan = L.traiterAppelManque(ctx({ numeroBrut: 'anonymous' }));
  assert.strictEqual(sms(plan).length, 0);
  assert.strictEqual(plan.entrees.length, 1);
});
t('numéro exclu : rien ; fournisseur : message différent, sans conversation', () => {
  assert.strictEqual(L.traiterAppelManque(ctx({ numeroBrut: '+33639980051' })).envois.length, 0);
  const plan = L.traiterAppelManque(ctx({ numeroBrut: '+33639980050' }));
  assert.strictEqual(sms(plan)[0].contexte, 'appel-manque-fournisseur');
  assert.strictEqual(plan.conversations.length, 0);
});
t('client avec un rendez-vous à venir : message adapté (DEPLACER, ANNULER)', () => {
  const plan = L.traiterAppelManque(ctx({ numeroBrut: VOUS, rdvs: [rdv(5, '2026-11-24T14:00')] }));
  assert.strictEqual(sms(plan)[0].contexte, 'appel-manque-client');
  assert.ok(/mardi 24\/11 à 14 h/.test(sms(plan)[0].texte));
});
t('deux appels en 30 min : un seul SMS (anti-doublon)', () => {
  const messages = [{ id: 1, canal: 'sms', sens: 'sortant', numero: VOUS, contexte: 'appel-manque', date: '2026-11-20 09:45', statut: 'envoye' }];
  assert.strictEqual(sms(L.traiterAppelManque(ctx({ numeroBrut: VOUS, messages }))).length, 0);
  const vieux = [{ ...messages[0], date: '2026-11-20 09:20' }];
  assert.strictEqual(sms(L.traiterAppelManque(ctx({ numeroBrut: VOUS, messages: vieux }))).length, 1);
});
t('numéro fixe : pas de SMS possible, alerte « à rappeler »', () => {
  const plan = L.traiterAppelManque(ctx({ numeroBrut: '01 43 00 00 00' }));
  assert.strictEqual(sms(plan).length, 0);
  assert.strictEqual(alertes(plan)[0].priorite, 'high');
});
t('accueil en pause (PAUSE du dirigeant) : aucun SMS, alerte seulement', () => {
  const plan = L.traiterAppelManque(ctx({ numeroBrut: VOUS, reglages: { ...reglages, pause: true } }));
  assert.strictEqual(sms(plan).length, 0);
  assert.strictEqual(alertes(plan).length, 1);
});

// ------------------------------------------------------------- 1.1 Conversation jusqu'au rendez-vous
const convBesoin = ligneConv({ etape: 'attente_besoin' });
t('SMS libre : Claude est d’abord consulté, avec la date du jour', () => {
  const r = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'Bonjour, mon évier fuit', conversations: [convBesoin] }));
  assert.strictEqual(r.besoinIA, true);
  assert.ok(/vendredi 20 novembre/.test(r.texteIA));
  assert.ok(/mon évier fuit/.test(r.texteIA));
});
t('besoin compris : 3 créneaux libres proposés (aujourd’hui 14 h, lundi 8 h, lundi 14 h)', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'Bonjour, mon évier fuit', conversations: [convBesoin] }), { intention: 'besoin', besoin: 'fuite sous l’évier', urgence: false });
  const c = conv(plan);
  assert.strictEqual(c.etape, 'choix_creneau');
  assert.deepStrictEqual(c.creneaux.map((x) => x.debut), ['2026-11-20T14:00', '2026-11-23T08:00', '2026-11-23T14:00']);
  assert.ok(/1\) vendredi 20\/11 à 14 h\n2\) lundi 23\/11 à 8 h\n3\) lundi 23\/11 à 14 h/.test(sms(plan)[0].texte));
});
t('« plutôt mardi après-midi » : nouvelles propositions sur ce moment', () => {
  const c0 = ligneConv({ etape: 'choix_creneau', besoin: 'fuite', creneaux: [{ debut: '2026-11-20T14:00' }] });
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'plutôt mardi après-midi', conversations: [c0] }), { intention: 'date', jour: '2026-11-24', partie: 'apres-midi' });
  assert.deepStrictEqual(conv(plan).creneaux.map((x) => x.debut), ['2026-11-24T14:00', '2026-11-25T14:00', '2026-11-26T14:00']);
});
const convChoix = ligneConv({ etape: 'choix_creneau', besoin: 'fuite sous l’évier', creneaux: [{ debut: '2026-11-20T14:00' }, { debut: '2026-11-23T08:00' }, { debut: '2026-11-23T14:00' }] });
t('choix « 2 » sans nom ni adresse : on les demande, sans IA', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: '2', conversations: [convChoix] }));
  assert.ok(!plan.besoinIA);
  assert.strictEqual(conv(plan).etape, 'coordonnees');
  assert.strictEqual(conv(plan).choix.debut, '2026-11-23T08:00');
  assert.ok(/lundi 23 novembre à 8 h/.test(sms(plan)[0].texte));
});
t('nom et adresse reçus : rendez-vous créé dans la table partagée, confirmation, alerte', () => {
  const c0 = ligneConv({ etape: 'coordonnees', besoin: 'fuite sous l’évier', choix: { debut: '2026-11-23T08:00' } });
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'Julie Martin, 12 rue des Lilas Montreuil', conversations: [c0] }), { intention: 'coordonnees', nom: 'Julie Martin', adresse: '12 rue des Lilas, Montreuil', urgence: false });
  assert.strictEqual(plan.rdv.length, 1);
  const l = plan.rdv[0].ligne;
  assert.strictEqual(l.debut, '2026-11-23T08:00:00+01:00');
  assert.strictEqual(l.fin, '2026-11-23T09:00:00+01:00');
  assert.strictEqual(l.telephone, VOUS);
  assert.strictEqual(l.appel_id, 'sms');
  assert.strictEqual(sms(plan)[0].contexte, 'reservation');
  assert.strictEqual(alertes(plan)[0].titre, 'Nouveau rendez-vous (SMS)');
  assert.strictEqual(conv(plan).etape, 'reserve');
});
t('« 2, Julie Martin, 12 rue des Lilas » : choix et coordonnées dans le même SMS', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: '2, Julie Martin, 12 rue des Lilas', conversations: [convChoix] }), { intention: 'coordonnees', nom: 'Julie Martin', adresse: '12 rue des Lilas, Montreuil' });
  assert.strictEqual(plan.rdv[0].ligne.debut, '2026-11-23T08:00:00+01:00');
});
t('créneau pris entre-temps (par un autre canal, ex. un agent vocal) : jamais de double réservation', () => {
  const c0 = ligneConv({ etape: 'coordonnees', besoin: 'fuite', nom: 'Julie', choix: { debut: '2026-11-23T08:00' } });
  const pris = { ...rdv(9, '2026-11-23T08:00'), telephone: '+33612345678', appel_id: 'call_x' };
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: '12 rue des Lilas', conversations: [c0], rdvs: [pris] }), { intention: 'coordonnees', adresse: '12 rue des Lilas' });
  assert.strictEqual(plan.rdv.length, 0);
  assert.strictEqual(conv(plan).etape, 'choix_creneau');
  assert.ok(!conv(plan).creneaux.some((x) => x.debut === '2026-11-23T08:00'));
});
t('« URGENT » : alerte urgente au responsable et SMS rassurant', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'URGENT', conversations: [convBesoin] }));
  assert.strictEqual(alertes(plan)[0].priorite, 'urgent');
  assert.strictEqual(sms(plan)[0].contexte, 'urgence');
});
t('urgence comprise par Claude (« l’eau coule partout ») : même traitement', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: "l'eau coule partout dans la cuisine", conversations: [convBesoin] }), { intention: 'besoin', besoin: 'inondation cuisine', urgence: true });
  assert.strictEqual(alertes(plan)[0].priorite, 'urgent');
});
t('Claude indisponible : des règles simples prennent le relais', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'Mon chauffe-eau ne marche plus', conversations: [convBesoin] }), null);
  assert.strictEqual(conv(plan).etape, 'choix_creneau');
  assert.strictEqual(conv(plan).besoin, 'Mon chauffe-eau ne marche plus');
});
t('question : transmise au responsable, le client est prévenu', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'Vous acceptez les chèques ?', conversations: [ligneConv({ etape: 'reserve' })] }), { intention: 'question' });
  assert.strictEqual(alertes(plan)[0].titre, "Question d'un client");
  assert.strictEqual(sms(plan)[0].contexte, 'transmis');
});

// ------------------------------------------------------------- STOP et pause
t('STOP : désinscription confirmée, plus aucun SMS ensuite (rappels compris)', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'stop', conversations: [convBesoin] }));
  assert.strictEqual(conv(plan).etape, 'desabonne');
  const ops = L.operations(plan, ctx({ conversations: [convBesoin] }));
  assert.strictEqual(ops.find((o) => o.contexte === 'stop').statut, 'envoye');
  const desabonne = ligneConv({ etape: 'desabonne' });
  const r = L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-23T18:10'), conversations: [desabonne], rdvs: [rdv(5, '2026-11-24T14:00')] }));
  assert.strictEqual(r.length, 0);
  const suite = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'Bonjour ?', conversations: [desabonne] }));
  assert.strictEqual(sms(suite).length, 0);
  assert.strictEqual(alertes(suite).length, 1);
});
t('PAUSE envoyé par le responsable : tout est suspendu ; REPRISE relance', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: cfg.demo.responsable, texte: 'pause' }));
  assert.strictEqual(plan.reglages.pause, true);
  const ops = L.operations(plan, ctx());
  const reg = ops.find((o) => o.numero === L.NUMERO_REGLAGES);
  assert.strictEqual(reg.op, 'conv-maj');
  assert.deepStrictEqual(JSON.parse(reg.choix), { pause: true, decalageMs: 0 });
  const pendant = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'Bonjour', reglages: { ...reglages, pause: true } }));
  assert.strictEqual(sms(pendant).length, 0);
  assert.strictEqual(L.planHoraire(ctx({ maintenant: P('2026-11-23T18:10'), rdvs: [rdv(5, '2026-11-24T14:00')], reglages: { ...reglages, pause: true } })).envois.length, 0);
  assert.strictEqual(L.traiterSms(ctx({ numeroBrut: cfg.demo.responsable, texte: 'REPRISE' })).reglages.pause, false);
});

// ------------------------------------------------------------- 1.5 Confirmation, annulation, déplacement
t('OUI au rappel : confirmation enregistrée (et rappel du jour J allégé)', () => {
  const r5 = rdv(5, '2026-11-24T14:00');
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'Oui', rdvs: [r5] }));
  assert.strictEqual(sms(plan)[0].contexte, 'confirmation');
  assert.strictEqual(sms(plan)[0].ref, L.cleRdv(r5));
  const messages = [{ id: 1, sens: 'sortant', canal: 'sms', contexte: 'confirmation', ref: L.cleRdv(r5), statut: 'envoye' }];
  const jour = L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-24T11:05'), rdvs: [r5], messages }));
  assert.strictEqual(jour[0].contexte, 'rappel-jour');
  assert.ok(/tout à l'heure/.test(jour[0].texte));
});
t('ANNULER : créneau libéré, proposé aux 2 personnes de la liste d’attente', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'annuler', rdvs: [rdv(5, '2026-11-24T14:00')], attente: attenteDemo }));
  assert.deepStrictEqual(plan.rdv, [{ op: 'supprimer', id: 5 }]);
  assert.strictEqual(sms(plan)[0].contexte, 'annulation');
  const offres = sms(plan).filter((e) => e.contexte === 'offre-attente');
  assert.deepStrictEqual(offres.map((e) => e.numero), [DURAND, PETIT]);
  assert.ok(offres.every((e) => e.proactif && e.ref === '2026-11-24T14:00'));
  assert.deepStrictEqual(plan.attente.map((a) => a.statut), ['propose', 'propose']);
});
t('annulation à 22 h : les offres partent à 8 h (heures calmes), la confirmation tout de suite', () => {
  const soir = P('2026-11-23T22:00');
  const plan = L.traiterSms(ctx({ maintenant: soir, numeroBrut: VOUS, texte: 'annuler', rdvs: [rdv(5, '2026-11-24T14:00')], attente: attenteDemo }));
  const ops = L.operations(plan, ctx({ maintenant: soir }));
  assert.strictEqual(ops.find((o) => o.contexte === 'annulation').statut, 'envoye');
  assert.ok(ops.filter((o) => o.contexte === 'offre-attente').every((o) => o.statut === 'differe'));
});
const attenteProposee = attenteDemo.map((a) => ({ ...a, statut: 'propose', ref: '2026-11-24T14:00' }));
t('liste d’attente : le premier OUI obtient la place', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: DURAND, texte: 'OUI', attente: attenteProposee }));
  assert.strictEqual(plan.rdv[0].ligne.debut, '2026-11-24T14:00:00+01:00');
  assert.strictEqual(plan.rdv[0].ligne.nom, 'Mme Durand');
  assert.strictEqual(plan.rdv[0].ligne.appel_id, 'liste-attente');
  assert.deepStrictEqual(plan.attente[0], { op: 'maj', id: 11, statut: 'servi', ref: '2026-11-24T14:00' });
  assert.strictEqual(sms(plan)[0].contexte, 'attente-gagne');
});
t('liste d’attente : le second OUI apprend que la place est prise et reste inscrit', () => {
  const prise = { ...rdv(20, '2026-11-24T14:00'), telephone: DURAND, appel_id: 'liste-attente' };
  const plan = L.traiterSms(ctx({ numeroBrut: PETIT, texte: 'oui', attente: attenteProposee, rdvs: [prise] }));
  assert.strictEqual(plan.rdv.length, 0);
  assert.strictEqual(sms(plan)[0].contexte, 'attente-perdu');
  assert.deepStrictEqual(plan.attente[0], { op: 'maj', id: 12, statut: 'en_attente', ref: '' });
});
t('DEPLACER puis « 1 » : le rendez-vous est déplacé, l’ancien créneau proposé à la liste d’attente', () => {
  const r5 = rdv(5, '2026-11-24T14:00');
  const p1 = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'Déplacer', rdvs: [r5] }));
  const c = conv(p1);
  assert.strictEqual(c.rdv_id, '5');
  assert.ok(!c.creneaux.some((x) => x.debut === '2026-11-24T14:00'));
  const p2 = L.traiterSms(ctx({ numeroBrut: VOUS, texte: '1', rdvs: [r5], attente: attenteDemo, conversations: [ligneConv(c)] }));
  assert.deepStrictEqual(p2.rdv[0], { op: 'deplacer', id: 5, debut: isoParis(P(c.creneaux[0].debut)), fin: isoParis(new Date(P(c.creneaux[0].debut).getTime() + 3600000)) });
  assert.strictEqual(sms(p2)[0].contexte, 'deplace');
  assert.strictEqual(sms(p2).filter((e) => e.contexte === 'offre-attente').length, 2);
});

// ------------------------------------------------------------- 1.5 Rappels
const r24 = rdv(5, '2026-11-24T14:00');
t('rappel la veille à 18 h, une seule fois', () => {
  const r = L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-23T18:05'), rdvs: [r24] }));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].contexte, 'rappel-veille');
  assert.ok(/demain à 14 h, 12 rue des Lilas/.test(r[0].texte));
  const deja = [{ id: 1, sens: 'sortant', contexte: 'rappel-veille', ref: L.cleRdv(r24) }];
  assert.strictEqual(L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-23T19:05'), rdvs: [r24], messages: deja })).length, 0);
});
t('aucun rappel avant 18 h la veille, ni pendant les heures calmes', () => {
  assert.strictEqual(L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-23T17:00'), rdvs: [r24] })).length, 0);
  assert.strictEqual(L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-23T21:30'), rdvs: [r24] })).length, 0);
});
t('rappel du jour J, 3 h avant ; pour un rendez-vous à 9 h, à 8 h (jamais avant)', () => {
  const r = L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-24T11:01'), rdvs: [r24] }));
  assert.strictEqual(r[0].contexte, 'rappel-jour');
  const r9 = rdv(6, '2026-11-24T09:00');
  assert.strictEqual(L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-24T07:30'), rdvs: [r9] })).length, 0);
  assert.strictEqual(L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-24T08:00'), rdvs: [r9] }))[0].contexte, 'rappel-jour');
});
t('veille manquée (tâche arrêtée) : seul le rappel du jour part, pas de « demain » faux', () => {
  const r = L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-24T11:30'), rdvs: [r24] }));
  assert.deepStrictEqual(r.map((x) => x.contexte), ['rappel-jour']);
});
t('rendez-vous pris le soir pour le lendemain : la confirmation suffit, pas de rappel « veille »', () => {
  const tardif = { ...r24, createdAt: isoParis(P('2026-11-23T19:30')) };
  assert.strictEqual(L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-23T20:00'), rdvs: [tardif] })).length, 0);
});
t('rendez-vous déplacé : il reçoit de nouveaux rappels (nouvelle clé)', () => {
  const deja = [{ id: 1, sens: 'sortant', contexte: 'rappel-veille', ref: L.cleRdv(r24) }];
  const deplace = { ...r24, debut: isoParis(P('2026-11-25T14:00')), fin: isoParis(P('2026-11-25T15:00')) };
  assert.strictEqual(L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-24T18:05'), rdvs: [deplace], messages: deja })).length, 1);
});
t('numéro fixe (rendez-vous pris par téléphone) : pas de SMS de rappel', () => {
  const fixe = { ...r24, telephone: '+33143000000' };
  assert.strictEqual(L.rappelsAEnvoyer(ctx({ maintenant: P('2026-11-23T18:05'), rdvs: [fixe] })).length, 0);
});
t('tâche horaire : les SMS de la nuit partent à 8 h, sauf pour un client désinscrit', () => {
  const messages = [
    { id: 1, canal: 'sms', sens: 'sortant', numero: VOUS, texte: 'a', statut: 'differe' },
    { id: 2, canal: 'sms', sens: 'sortant', numero: PETIT, texte: 'b', statut: 'differe' },
  ];
  const conversations = [ligneConv({ id: 3, numero: PETIT, etape: 'desabonne' })];
  const plan = L.planHoraire(ctx({ maintenant: P('2026-11-21T08:01'), messages, conversations }));
  assert.deepStrictEqual(plan.messages.map((m) => m.op), ['envoyer', 'maj']);
  const ops = L.operations(plan, ctx({ maintenant: P('2026-11-21T08:01'), conversations }));
  assert.deepStrictEqual(ops.map((o) => o.op), ['msg-maj', 'envoyer', 'msg-maj']);
  assert.strictEqual(L.planHoraire(ctx({ maintenant: P('2026-11-21T07:00'), messages })).messages.length, 0);
});

// ------------------------------------------------------------- Opérations, démo, RGPD
t('opérations : ordre fixe (suppressions, mises à jour, créations, messages) et texte GSM', () => {
  const plan = L.traiterSms(ctx({ numeroBrut: VOUS, texte: 'annuler', rdvs: [rdv(5, '2026-11-24T14:00')], attente: attenteDemo }));
  const ops = L.operations(plan, ctx({ attente: attenteDemo }));
  const sorties = ops.map((o) => o.sortie);
  assert.deepStrictEqual(sorties, sorties.slice().sort((a, b) => a - b));
  assert.ok(ops.filter((o) => o.op === 'msg-creer' && o.canal === 'sms').every((o) => L.segmentsSms(o.texte).encodage === 'GSM-7'));
  assert.strictEqual(ops.find((o) => o.op === 'msg-creer').sens, 'entrant');
});
t('démo : remise à zéro des seules données fictives (les rendez-vous venus d’un autre canal restent)', () => {
  const lucie = { ...rdv(30, '2026-11-25T10:00'), telephone: '+33612345678', appel_id: 'call_1' };
  const plan = L.actionDemo(ctx({ rdvs: [rdv(5, '2026-11-24T14:00'), lucie], attente: attenteDemo, conversations: [convBesoin], messages: [{ id: 1 }, { id: 2 }] }), { action: 'reinitialiser' });
  assert.deepStrictEqual(plan.rdv, [{ op: 'supprimer', id: 5 }]);
  assert.strictEqual(plan.messages.length, 2);
  assert.strictEqual(plan.attente.filter((a) => a.op === 'ajouter').length, 2);
  assert.deepStrictEqual(plan.reglages, { ...reglages, pause: false, decalageMs: 0 });
});
t('démo : « la veille à 18 h » avance l’horloge et envoie le rappel', () => {
  const plan = L.actionDemo(ctx({ rdvs: [r24] }), { action: 'horloge', cible: 'veille' });
  assert.strictEqual(plan.envois[0].contexte, 'rappel-veille');
  assert.strictEqual(plan.reglages.decalageMs, P('2026-11-23T18:02') - VENDREDI_10H);
  const sansRdv = L.actionDemo(ctx(), { action: 'horloge', cible: 'veille' });
  assert.ok(/Prenez/.test(sansRdv.info));
});
t('démo : « client absent » relance sans reproche après l’heure du rendez-vous', () => {
  const plan = L.actionDemo(ctx({ rdvs: [r24] }), { action: 'absent' });
  assert.strictEqual(sms(plan)[0].contexte, 'relance-absent');
  assert.ok(/Aucun souci/.test(sms(plan)[0].texte));
  assert.strictEqual(conv(plan).etape, 'relance');
  const suite = L.traiterSms(ctx({ maintenant: P('2026-11-24T15:40'), numeroBrut: VOUS, texte: 'RDV', conversations: [ligneConv(conv(plan))] }));
  assert.strictEqual(conv(suite).etape, 'choix_creneau');
});
t('état de la démo : fils par téléphone, alertes, agenda (numéros réels masqués), compteurs', () => {
  const lucie = { ...rdv(30, '2026-11-25T10:00'), telephone: '+33612345678', appel_id: 'call_1' };
  const messages = [
    { id: 1, canal: 'appel', sens: 'entrant', numero: VOUS, texte: 'Appel manqué', contexte: 'appel-manque', date: '2026-11-20 09:58', statut: 'recu' },
    { id: 2, canal: 'sms', sens: 'sortant', numero: VOUS, texte: 'Bonjour', contexte: 'appel-manque', date: '2026-11-20 09:58', statut: 'envoye', segments: 1 },
    { id: 3, canal: 'alerte', sens: 'sortant', numero: VOUS, titre: 'Appel manqué', texte: '…', contexte: 'alerte', date: '2026-11-20 09:58', statut: 'envoye', priorite: 'low' },
  ];
  const e = L.etatDemo(ctx({ rdvs: [r24, lucie], messages }));
  assert.strictEqual(e.fils[VOUS].length, 2); // l'appel manqué puis le SMS
  assert.strictEqual(e.fils[VOUS][0].canal, 'appel');
  assert.strictEqual(e.fils[VOUS][1].heure, '9:58');
  assert.strictEqual(e.alertes.length, 1);
  assert.strictEqual(e.agenda.length, 2);
  assert.strictEqual(e.agenda[1].telephone, '06 12 •• •• 78');
  assert.strictEqual(e.agenda[1].source, 'Appel (agent vocal)');
  assert.strictEqual(e.compteurs.appelsManques, 1);
  assert.strictEqual(e.compteurs.smsEnvoyes, 1);
});
t('RGPD : messages de plus de 90 jours effacés, réglages jamais effacés', () => {
  const messages = [{ id: 1, date: '2026-08-01 10:00' }, { id: 2, date: '2026-11-19 10:00' }];
  const conversations = [{ id: 7, numero: L.NUMERO_REGLAGES, maj: '2025-01-01 10:00' }, ligneConv({ id: 8, maj: '2026-09-01 10:00' })];
  const plan = L.purgeRgpd(ctx({ messages, conversations }));
  assert.deepStrictEqual(plan.messages, [{ op: 'supprimer', id: 1 }]);
  assert.deepStrictEqual(plan.conversations, [{ op: 'supprimer', id: 8 }]);
});

t('rappel promis seulement s’il partira vraiment (veille, jour J, ou rien)', () => {
  const r = (deb, now) => L.rendre('confirmation', { creneau: 'x', adresse: 'y', rappel: L.phraseRappel(P(deb), P(now), cfg) }, cfg);
  assert.ok(r('2026-11-24T14:00', '2026-11-20T10:00').includes('Rappel la veille par SMS.'));
  assert.ok(r('2026-11-23T14:00', '2026-11-22T19:00').includes('Rappel par SMS le jour J.'));
  assert.ok(!/Rappel/.test(r('2026-11-23T14:00', '2026-11-23T12:00')));
  assert.ok(!/  /.test(r('2026-11-23T14:00', '2026-11-23T12:00')));
});

// ------------------------------------------------------------- Vrai portable de test (appel réel, vrais SMS)
const MOI = '+33612345678';
const cfgR = { ...cfg, numeroDirigeant: MOI, reel: { numeros: [MOI] } };
const ctxR = (extra = {}) => ctx({ cfg: cfgR, ...extra });
t('vrai portable : en démo il joue le client, même si c’est le numéro du dirigeant ; le responsable reste le téléphone simulé', () => {
  assert.strictEqual(L.typeContact(MOI, cfgR), 'client');
  assert.strictEqual(L.typeContact(cfgR.demo.responsable, cfgR), 'dirigeant');
  assert.strictEqual(L.typeContact(MOI, { ...cfgR, demo: { ...cfgR.demo, actif: false } }), 'dirigeant');
  assert.ok(L.estReel(MOI, cfgR) && !L.estReel(VOUS, cfgR));
});
t('vrai appel : SMS au vrai portable, et son numéro masqué dans l’alerte (écran, ntfy, vidéo)', () => {
  const plan = L.traiterAppelManque(ctxR({ numeroBrut: MOI }));
  assert.strictEqual(sms(plan)[0].numero, MOI);
  const ops = L.operations(plan, ctxR());
  const alerte = ops.find((o) => o.canal === 'alerte');
  assert.ok(alerte.texte.includes('06 12 •• •• 78') && !alerte.texte.includes('06 12 34 56 78'), alerte.texte);
  assert.strictEqual(ops.find((o) => o.canal === 'sms' && o.sens === 'sortant').statut, 'envoye');
});
t('état : le vrai portable a son onglet, en lecture seule, sans jamais exposer le numéro entier', () => {
  const messages = [
    { id: 1, canal: 'appel', sens: 'entrant', numero: MOI, texte: 'Appel manqué', contexte: 'appel-manque', date: '2026-11-20 09:58', statut: 'recu' },
    { id: 2, canal: 'sms', sens: 'sortant', numero: MOI, texte: 'Bonjour', contexte: 'appel-manque', date: '2026-11-20 09:58', statut: 'envoye', segments: 1 },
  ];
  const e = L.etatDemo(ctxR({ messages }));
  const p = e.personnes.find((x) => x.role === 'reel');
  assert.deepStrictEqual(p, { numero: 'reel-1', nom: 'Votre portable', role: 'reel', lisible: '06 12 •• •• 78' });
  assert.strictEqual(e.fils['reel-1'].length, 2);
  assert.ok(!JSON.stringify(e).includes(MOI) && !JSON.stringify(e).includes('06 12 34 56 78'));
  assert.ok(!L.etatDemo(ctxR()).personnes.some((x) => x.role === 'reel')); // pas d'onglet avant le premier appel
});
t('boutons de la démo : l’horloge suit le rendez-vous du vrai portable ; la remise à zéro l’efface', () => {
  const r = { ...rdv(40, '2026-11-24T14:00'), telephone: MOI };
  const plan = L.actionDemo(ctxR({ rdvs: [r] }), { action: 'horloge', cible: 'veille' });
  assert.ok(/lundi 23 novembre/.test(plan.info), plan.info);
  assert.strictEqual(sms(plan)[0].numero, MOI);
  assert.strictEqual(sms(plan)[0].contexte, 'rappel-veille');
  const raz = L.actionDemo(ctxR({ rdvs: [r], conversations: [ligneConv({ id: 9, numero: MOI })] }), { action: 'reinitialiser' });
  assert.deepStrictEqual(raz.rdv, [{ op: 'supprimer', id: 40 }]);
  assert.deepStrictEqual(raz.conversations, [{ op: 'supprimer', id: 9 }]);
});
t('SMS programmé envoyé à 8 h : l’opération « envoyer » est bien marquée sortante', () => {
  const m = { id: 5, canal: 'sms', sens: 'sortant', numero: MOI, texte: 'x', contexte: 'appel-manque', statut: 'differe', date: '2026-11-20 23:00' };
  const plan = L.planHoraire(ctxR({ maintenant: P('2026-11-21T08:01'), messages: [m] }));
  const env = L.operations(plan, ctxR()).find((o) => o.op === 'envoyer');
  assert.strictEqual(env.sens, 'sortant');
  assert.strictEqual(env.numero, MOI);
});

// ------------------------------------------------------------- Compte d'essai Twilio : SMS simulés, vrai appel affiché sur la page
t('anti-doublon : un SMS refusé par Twilio (« echec ») ne compte pas, le rappel suivant repart', () => {
  const refuse = [{ id: 1, canal: 'sms', sens: 'sortant', numero: VOUS, contexte: 'appel-manque', date: '2026-11-20 09:45', statut: 'echec' }];
  assert.strictEqual(sms(L.traiterAppelManque(ctx({ numeroBrut: VOUS, messages: refuse }))).length, 1);
});
t('page de démo : « reel-1 » désigne le vrai portable, en démo seulement', () => {
  assert.strictEqual(L.numeroEntrant('reel-1', cfgR), MOI);
  assert.strictEqual(L.numeroEntrant(' reel-1 ', cfgR), MOI);
  assert.strictEqual(L.numeroEntrant('reel-2', cfgR), 'reel-2'); // inconnu : laissé tel quel, donc numéro invalide
  assert.strictEqual(L.numeroEntrant(VOUS, cfgR), VOUS);
  assert.strictEqual(L.numeroEntrant('reel-1', { ...cfgR, demo: { ...cfgR.demo, actif: false } }), 'reel-1');
  const plan = L.traiterAppelManque(ctxR({ numeroBrut: L.numeroEntrant('reel-1', cfgR) }));
  assert.strictEqual(sms(plan)[0].numero, MOI);
  assert.strictEqual(L.traiterSms(ctxR({ numeroBrut: 'reel-2', texte: 'OUI' })).resume, 'numéro invalide');
});
t('état : la clé « reel-N » suit la place du numéro dans NUMEROS_REELS (même si le premier n’a rien)', () => {
  const AUTRE = '+33698765432';
  const c2 = { ...cfgR, reel: { numeros: [AUTRE, MOI] } };
  const messages = [{ id: 1, canal: 'appel', sens: 'entrant', numero: MOI, texte: 'Appel manqué', contexte: 'appel-manque', date: '2026-11-20 09:58', statut: 'recu' }];
  const e = L.etatDemo(ctxR({ cfg: c2, messages }));
  assert.deepStrictEqual(e.personnes.filter((x) => x.role === 'reel').map((x) => x.numero), ['reel-2']);
  assert.strictEqual(L.numeroEntrant('reel-2', c2), MOI);
});

console.log(`\n${ok} test(s) réussi(s)${process.exitCode ? ', au moins un échec' : ''}.`);
