// Fabrique le circuit n8n de l'accueil client IA par SMS (fiches 1.1 et 1.5) à partir de la logique testée,
// de config-client.json et du .env. Usage : node construire.js   ->   n8n/famille-1-accueil-client-ia.n8n.json
// Option : TRACES=oui node construire.js  (garde aussi les exécutions réussies, utile pendant les essais).
// Un seul circuit : il est mis à jour sur place dans n8n (même id), jamais dupliqué.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { chargerConfig, aRemplir, HORS_CODE } = require('./charger-config.js');

const ICI = __dirname;
const complet = chargerConfig(ICI);
const manque = aRemplir(complet);
const { cleAccueil, tableRdv, tableMessages, tableConversations, tableAttente, ntfyIdentifiant, anthropicIdentifiant, twilioIdentifiant } = complet;
// Ce qui sert à construire (clés, tables, identifiants) n'est pas recopié dans le code des blocs.
const cfg = Object.fromEntries(Object.entries(complet).filter(([k]) => !HORS_CODE.includes(k)));
const SMS = cfg.smsActifs === true && !!twilioIdentifiant;
const REELS = (cfg.reel && cfg.reel.numeros) || [];
const BASE = String(cfg.urlN8n || '').replace(/\/$/, '') + '/webhook/';
if (manque.length) console.log('À remplir dans .env :\n  - ' + manque.join('\n  - '));

// Logique d'agenda (heure de Paris, créneaux) puis logique SMS, sans les lignes réservées aux tests locaux.
const sansExports = (s) => s.replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '').trim();
const logiqueAgenda = sansExports(fs.readFileSync(path.join(ICI, 'logique', 'logique-agenda.js'), 'utf8'));
const logiqueSms = sansExports(fs.readFileSync(path.join(ICI, 'logique', 'logique-sms.js'), 'utf8')
  .replace(/\/\/ @@tests-seulement[\s\S]*?\/\/ @@fin-tests-seulement\n?/, ''));
const html = fs.readFileSync(path.join(ICI, 'demo', 'page-demo.html'), 'utf8');

const uid = (s) => {
  const h = crypto.createHash('md5').update('vx-famille-1-accueil-' + s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const AVERTISSEMENT = [
  '// Logique VorcheX (copie de logique/logique-agenda.js et de logique/logique-sms.js, testées par tests/test-logique-sms.js).',
  '// Ne pas modifier ici : modifier la logique ou config-client.json puis relancer « node construire.js ».',
].join('\n');
const avecLogique = (corps) => [AVERTISSEMENT, logiqueAgenda, logiqueSms, `const CFG = ${JSON.stringify(cfg)};`, '', corps].join('\n');

const nodes = [];
const connections = {};
const add = (name, type, typeVersion, position, parameters, extra = {}) => {
  if (nodes.some((n) => n.name === name)) throw new Error('Nom de bloc en double : ' + name);
  nodes.push({ parameters, id: uid(name), name, type, typeVersion, position, ...extra });
};
const lien = (de, vers, sortie = 0, type = 'main') => {
  connections[de] = connections[de] || {};
  const c = (connections[de][type] = connections[de][type] || []);
  while (c.length <= sortie) c.push([]);
  c[sortie].push({ node: vers, type, index: 0 });
};
const table = (id) => ({ __rl: true, mode: 'id', value: id || 'A_REMPLIR' });
const colonne = (id, type = 'string') => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type, canBeUsedToMatch: true });
const colonnes = (noms, types = {}) => ({
  mappingMode: 'defineBelow',
  value: Object.fromEntries(noms.map((c) => [c, `={{ $json.${c} }}`])),
  matchingColumns: [], schema: noms.map((c) => colonne(c, types[c] || 'string')),
  attemptToConvertTypes: false, convertFieldsToString: false,
});
const filtreId = { matchType: 'allConditions', filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: '={{ $json.id }}' }] } };
const continuerSiErreur = { onError: 'continueRegularOutput' };
const entetes = (paires) => ({ responseHeaders: { entries: paires.map(([name, value]) => ({ name, value })) } });
const XML = ['Content-Type', 'text/xml; charset=utf-8'];
const SANS_CACHE = ['Cache-Control', 'no-store'];

// Message vocal quand personne ne décroche (vrai appel Twilio). La voix Léa (Amazon Polly) parle français.
const twimlVoix = '<?xml version="1.0" encoding="UTF-8"?><Response><Say language="fr-FR" voice="Polly.Lea-Neural">'
  + `Bonjour, vous êtes bien chez ${cfg.nomEntreprise}. Nous ne pouvons pas décrocher pour le moment. `
  + 'Vous allez recevoir un SMS dans quelques secondes : répondez-y, et nous fixons votre rendez-vous par écrit. À tout de suite !'
  + '</Say><Hangup/></Response>';
const twimlVide = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// ---------------------------------------------------------------- Note
add('Mode d’emploi VorcheX', 'n8n-nodes-base.stickyNote', 1, [-1760, -980], {
  width: 760, height: 620, color: 5,
  content: [
    `## Accueil client IA par SMS — ${cfg.nomEntreprise} (VorcheX)`,
    'Fiches **1.1** (appel manqué → SMS → conversation écrite jusqu’au rendez-vous) et **1.5** (rappels la veille et le jour J, OUI / DEPLACER / ANNULER, liste d’attente, relance des absents). Agenda : une table n8n de rendez-vous, partageable avec un agent vocal qui lit le même format.',
    '',
    '**Entrées** (toutes protégées par `?cle=…`) : appel manqué (Twilio ou page de démo), SMS reçu, page de démo, état de la démo, boutons de la démo.',
    '**Chaque heure** : rappels, SMS programmés la nuit (envoyés à 8 h), offres de liste d’attente expirées. **Chaque nuit à 3 h 30** : effacement RGPD.',
    '**Claude (Haiku)** lit les SMS libres : besoin, urgence, nom, adresse, jour souhaité. En cas de panne, des règles simples prennent le relais.',
    '',
    '**Principe** : le bloc « Décider » applique la logique testée et produit des opérations ; le circuit ne fait que les appliquer (tables, SMS, alertes).',
    SMS ? `**SMS réels** : uniquement vers le(s) portable(s) de test (${REELS.length}). Les téléphones de démo restent simulés.` : '**SMS** : simulés (bloc Twilio grisé). Pour les activer : identifiant Twilio dans n8n, TWILIO_IDENTIFIANT et SMS_ACTIFS=oui dans .env, puis `node construire.js`.',
    ntfyIdentifiant ? '**Alertes** : ntfy, sur le téléphone du responsable.' : '**Alertes** : identifiant ntfy à créer.',
    '',
    'Guide : GUIDE-DEMO.md · Les clés API ne vont jamais dans .env, uniquement dans les identifiants n8n.',
  ].join('\n'),
});

// ---------------------------------------------------------------- Entrées
const ENTREES = [
  ['Webhook · appel manqué', 'POST', 'vx-accueil-appel-manque', 'appel'],
  ['Webhook · SMS reçu', 'POST', 'vx-accueil-sms', 'sms'],
  ['Webhook · page de démo', 'GET', 'vx-accueil-demo', 'page'],
  ['Webhook · état de la démo', 'GET', 'vx-accueil-etat', 'etat'],
  ['Webhook · action de démo', 'POST', 'vx-accueil-action', 'action'],
];
const V = 'Vérifier l’accès';
ENTREES.forEach(([nom, methode, chemin], i) => {
  add(nom, 'n8n-nodes-base.webhook', 2.1, [-1700, -300 + i * 190], {
    httpMethod: methode, path: chemin, responseMode: 'responseNode', options: {},
  }, { webhookId: uid('webhook-' + chemin) });
  lien(nom, V);
});

add(V, 'n8n-nodes-base.code', 2, [-1440, 80], {
  jsCode: [
    `const CLE = ${JSON.stringify(cleAccueil)};`,
    `const DEMO = ${JSON.stringify(!!(cfg.demo && cfg.demo.actif))};`,
    `const ROUTES = ${JSON.stringify(Object.fromEntries(ENTREES.map(([, , chemin, route]) => [chemin, route])))};`,
    `const NOMS = ${JSON.stringify(Object.fromEntries(ENTREES.map(([nom, , , route]) => [nom, route])))};`,
    'const SORTIES = { refus: 0, page: 1, appel: 2, sms: 3, etat: 4, action: 5, ignorer: 6 };',
    'const e = $input.first().json;',
    'const q = e.query || {};',
    'const b = e.body || {};',
    "const url = String(e.webhookUrl || '');",
    "let route = Object.entries(ROUTES).filter(([chemin]) => url.includes('/' + chemin)).map(([, r]) => r)[0] || '';",
    'for (const [nom, r] of Object.entries(NOMS)) { try { if (!route && $(nom).isExecuted) route = r; } catch (err) {} }',
    "const cle = String(q.cle || b.cle || '');",
    '// Sans la bonne clé (dans l’adresse ou le formulaire), rien n’est lu ni écrit.',
    "if (!route || cle !== CLE) return [{ json: { route: 'refus', sortie: 0 } }];",
    "if (['page', 'etat', 'action'].includes(route) && !DEMO) return [{ json: { route: 'refus', sortie: 0 } }];",
    '// Appel déjà décroché ou terminé (rappel d’état Twilio) : ce n’est pas un appel manqué.',
    "if (route === 'appel' && /^(completed|in-progress|answered)$/i.test(String(b.CallStatus || ''))) return [{ json: { route: 'ignorer', sortie: 6 } }];",
    'return [{ json: {',
    '  route, sortie: SORTIES[route], cle,',
    "  from: String(b.From || b.from || ''), texte: String(b.Body || b.body || '').slice(0, 800),",
    "  action: String(b.action || ''), cible: String(b.cible || ''), id: String(b.id || ''),",
    '} }];',
  ].join('\n'),
});

const QE = 'Quelle entrée ?';
add(QE, 'n8n-nodes-base.switch', 3.2, [-1200, 80], { mode: 'expression', numberOutputs: 7, output: '={{ $json.sortie }}', options: {} });
lien(V, QE);

add('Réponse · accès refusé', 'n8n-nodes-base.respondToWebhook', 1.1, [-940, -420], {
  respondWith: 'text', responseBody: 'Accès refusé.', options: { responseCode: 403 },
});
lien(QE, 'Réponse · accès refusé', 0);

add('Page de démo', 'n8n-nodes-base.code', 2, [-940, -240], {
  jsCode: [
    '// Page à deux téléphones (demo/page-demo.html). La clé et l’adresse sont ajoutées ici, côté serveur.',
    `const HTML = ${JSON.stringify(html)};`,
    `const BASE = ${JSON.stringify(BASE)};`,
    'const e = $input.first().json;',
    "return [{ json: { html: HTML.split('__CLE__').join(e.cle).split('__BASE__').join(BASE) } }];",
  ].join('\n'),
});
lien(QE, 'Page de démo', 1);
add('Réponse · page', 'n8n-nodes-base.respondToWebhook', 1.1, [-700, -240], {
  respondWith: 'text', responseBody: '={{ $json.html }}',
  options: entetes([['Content-Type', 'text/html; charset=utf-8'], SANS_CACHE]),
});
lien('Page de démo', 'Réponse · page');

add('Réponse · appel (voix)', 'n8n-nodes-base.respondToWebhook', 1.1, [-940, -60], {
  respondWith: 'text', responseBody: twimlVoix, options: entetes([XML]),
});
lien(QE, 'Réponse · appel (voix)', 2);
add('Réponse · SMS reçu', 'n8n-nodes-base.respondToWebhook', 1.1, [-940, 120], {
  respondWith: 'text', responseBody: twimlVide, options: entetes([XML]),
});
lien(QE, 'Réponse · SMS reçu', 3);
add('Réponse · appel ignoré', 'n8n-nodes-base.respondToWebhook', 1.1, [-940, 480], {
  respondWith: 'text', responseBody: twimlVide, options: entetes([XML]),
});
lien(QE, 'Réponse · appel ignoré', 6);

// ---------------------------------------------------------------- Tâches planifiées
add('Chaque heure', 'n8n-nodes-base.scheduleTrigger', 1.2, [-1700, 760], {
  rule: { interval: [{ field: 'cronExpression', expression: '1 * * * *' }] },
});
add('Tâche horaire', 'n8n-nodes-base.code', 2, [-1440, 760], { jsCode: "return [{ json: { route: 'horaire' } }];" });
lien('Chaque heure', 'Tâche horaire');
add('Chaque nuit (3 h 30)', 'n8n-nodes-base.scheduleTrigger', 1.2, [-1700, 960], {
  rule: { interval: [{ field: 'cronExpression', expression: '30 3 * * *' }] },
});
add('Purge nocturne', 'n8n-nodes-base.code', 2, [-1440, 960], { jsCode: "return [{ json: { route: 'purge' } }];" });
lien('Chaque nuit (3 h 30)', 'Purge nocturne');

// ---------------------------------------------------------------- Lecture des tables (une fois par exécution)
const LECTURES = [
  ['Lire les conversations', tableConversations],
  ['Lire les rendez-vous', tableRdv],
  ['Lire la liste d’attente', tableAttente],
  ['Lire les messages', tableMessages],
];
LECTURES.forEach(([nom, id], i) => {
  add(nom, 'n8n-nodes-base.dataTable', 1.1, [-440 + i * 220, 360], {
    resource: 'row', operation: 'get', dataTableId: table(id), returnAll: true, filters: {},
  }, { executeOnce: true, alwaysOutputData: true });
  if (i > 0) lien(LECTURES[i - 1][0], nom);
});
const L0 = LECTURES[0][0];
lien('Réponse · appel (voix)', L0);
lien('Réponse · SMS reçu', L0);
lien(QE, L0, 4);
lien(QE, L0, 5);
lien('Tâche horaire', L0);
lien('Purge nocturne', L0);

const CONTEXTE = [
  'const estExecute = (n) => { try { return $(n).isExecuted; } catch (e) { return false; } };',
  'const tous = (n) => { try { return $(n).all().map((i) => i.json); } catch (e) { return []; } };',
  'const reel = new Date();',
  "const conversations = tous('Lire les conversations');",
  'const reglages = reglagesDe(conversations);',
  'const maintenant = horloge(reglages, reel, CFG);',
  "const ctx = { cfg: CFG, reel, maintenant, reglages, conversations, rdvs: tous('Lire les rendez-vous'), attente: tous('Lire la liste d’attente'), messages: tous('Lire les messages') };",
].join('\n');

add('Décider', 'n8n-nodes-base.code', 2, [460, 360], {
  jsCode: avecLogique([
    CONTEXTE,
    `const e = estExecute('${V}') ? $('${V}').first().json : { route: estExecute('Tâche horaire') ? 'horaire' : 'purge' };`,
    "const suite = (sortie, plan) => [{ json: { route: e.route, sortie, ops: operations(plan, ctx), resume: plan.resume || '', info: plan.info || '' } }];",
    'switch (e.route) {',
    "  case 'etat': return [{ json: { route: 'etat', sortie: 0, etat: etatDemo(ctx) } }];",
    "  case 'appel': return suite(3, traiterAppelManque({ ...ctx, numeroBrut: numeroEntrant(e.from, CFG) }));",
    "  case 'sms': {",
    '    const r = traiterSms({ ...ctx, numeroBrut: numeroEntrant(e.from, CFG), texte: e.texte });',
    "    return r.besoinIA ? [{ json: { route: 'sms', sortie: 1, texteIA: r.texteIA } }] : suite(3, r);",
    '  }',
    "  case 'action': return suite(2, actionDemo(ctx, e));",
    "  case 'horaire': return suite(3, planHoraire(ctx));",
    '  default: return suite(3, purgeRgpd(ctx));',
    '}',
  ].join('\n')),
});
lien(LECTURES[3][0], 'Décider');

const SUITE = 'Suite ?';
add(SUITE, 'n8n-nodes-base.switch', 3.2, [680, 360], { mode: 'expression', numberOutputs: 4, output: '={{ $json.sortie }}', options: {} });
lien('Décider', SUITE);

add('Réponse · état', 'n8n-nodes-base.respondToWebhook', 1.1, [940, 100], {
  respondWith: 'json', responseBody: '={{ JSON.stringify($json.etat) }}', options: entetes([SANS_CACHE]),
});
lien(SUITE, 'Réponse · état', 0);

const IA = 'Comprendre le SMS (Claude)';
add(IA, '@n8n/n8n-nodes-langchain.informationExtractor', 1.2, [940, 300], {
  text: '={{ $json.texteIA }}',
  schemaType: 'fromAttributes',
  attributes: {
    attributes: [
      { name: 'intention', type: 'string', required: true, description: 'Un seul mot parmi : besoin (il décrit un problème ou veut un rendez-vous), choix (il choisit un des créneaux proposés), coordonnees (il donne son nom ou son adresse), question (il pose une question), remerciement (merci, d’accord, à demain), autre' },
      { name: 'besoin', type: 'string', required: false, description: 'Le problème ou la prestation demandée, en quelques mots (ex. : fuite sous l’évier, chauffe-eau en panne). Vide si le SMS n’en parle pas.' },
      { name: 'urgence', type: 'boolean', required: false, description: 'Vrai seulement pour une vraie urgence : grosse fuite, inondation, dégât des eaux, plus d’eau du tout, odeur de gaz.' },
      { name: 'nom', type: 'string', required: false, description: 'Nom de la personne si elle le donne (ex. : Julie Martin). Vide sinon.' },
      { name: 'adresse', type: 'string', required: false, description: 'Adresse de l’intervention si elle est donnée (numéro, rue, ville). Vide sinon.' },
      { name: 'jour', type: 'string', required: false, description: 'Date souhaitée au format AAAA-MM-JJ, calculée à partir de la date du jour indiquée, si le client en demande une (ex. : « mardi », « demain »). Vide sinon.' },
      { name: 'partie', type: 'string', required: false, description: 'matin ou apres-midi si le client précise un moment de la journée. Vide sinon.' },
      { name: 'rappel', type: 'boolean', required: false, description: 'Vrai si le client demande à être rappelé par téléphone.' },
    ],
  },
  options: {
    systemPromptTemplate: `Tu lis un SMS envoyé par un client à ${cfg.nomEntreprise} (${cfg.metier || 'artisan'}). Le contexte (date du jour, étape de la conversation, créneaux déjà proposés) est donné avant le SMS. Extrais uniquement ce que le client écrit, sans rien inventer. Laisse vide ce qui manque.`,
  },
}, continuerSiErreur);
lien(SUITE, IA, 1);
add('Claude (Comprendre le SMS)', '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.6, [940, 500], {
  model: { __rl: true, mode: 'id', value: 'claude-haiku-5-5' }, options: {},
}, anthropicIdentifiant ? { credentials: { anthropicApi: { id: anthropicIdentifiant, name: 'Anthropic account' } } } : {});
lien('Claude (Comprendre le SMS)', IA, 0, 'ai_languageModel');

add('Décider après l’IA', 'n8n-nodes-base.code', 2, [1200, 300], {
  jsCode: avecLogique([
    CONTEXTE,
    `const e = $('${V}').first().json;`,
    'const r = $input.first().json || {};',
    "// Réponse de Claude ; en cas de panne (r.error), null : des règles simples prennent le relais.",
    "const extraction = r.output && typeof r.output === 'object' && !r.error ? r.output : null;",
    'const plan = traiterSms({ ...ctx, numeroBrut: numeroEntrant(e.from, CFG), texte: e.texte }, extraction);',
    "return [{ json: { route: 'sms', sortie: 3, ops: operations(plan, ctx), resume: plan.resume || '', ia: !!extraction } }];",
  ].join('\n')),
});
lien(IA, 'Décider après l’IA');

add('Réponse · action', 'n8n-nodes-base.respondToWebhook', 1.1, [940, 700], {
  respondWith: 'json', responseBody: '={{ JSON.stringify({ ok: true, info: $json.info || "" }) }}', options: entetes([SANS_CACHE]),
});
lien(SUITE, 'Réponse · action', 2);

const ECL = 'Éclater les opérations';
add(ECL, 'n8n-nodes-base.code', 2, [1460, 360], {
  jsCode: [
    '// Une opération par élément ; « Quelle opération ? » les range (tables d’abord, messages en dernier).',
    'const d = $input.first().json || {};',
    'return (d.ops || []).map((o) => ({ json: o }));',
  ].join('\n'),
});
lien(SUITE, ECL, 3);
lien('Décider après l’IA', ECL);
lien('Réponse · action', ECL);

// ---------------------------------------------------------------- Écritures (ordre : du haut vers le bas)
const QO = 'Quelle opération ?';
add(QO, 'n8n-nodes-base.switch', 3.2, [1700, 360], { mode: 'expression', numberOutputs: 13, output: '={{ $json.sortie }}', options: {} });
lien(ECL, QO);

const CHAMPS_RDV = ['debut', 'fin', 'nom', 'telephone', 'adresse', 'motif', 'appel_id'];
const CHAMPS_CONV = ['numero', 'etape', 'besoin', 'urgence', 'nom', 'adresse', 'creneaux', 'choix', 'rdv_id', 'maj'];
const CHAMPS_ATTENTE = ['numero', 'nom', 'adresse', 'besoin', 'souhait', 'cree_le', 'statut', 'ref'];
const CHAMPS_MSG = ['date', 'canal', 'sens', 'numero', 'texte', 'contexte', 'ref', 'statut', 'titre', 'priorite', 'tags', 'segments'];
const ECRITURES = [
  ['Rendez-vous · supprimer', tableRdv, 'deleteRows'],
  ['Rendez-vous · déplacer', tableRdv, 'update', ['debut', 'fin']],
  ['Rendez-vous · créer', tableRdv, 'insert', CHAMPS_RDV],
  ['Conversation · supprimer', tableConversations, 'deleteRows'],
  ['Conversation · mettre à jour', tableConversations, 'update', CHAMPS_CONV],
  ['Conversation · créer', tableConversations, 'insert', CHAMPS_CONV],
  ['Liste d’attente · supprimer', tableAttente, 'deleteRows'],
  ['Liste d’attente · mettre à jour', tableAttente, 'update', ['statut', 'ref']],
  ['Liste d’attente · ajouter', tableAttente, 'insert', CHAMPS_ATTENTE],
  ['Message · supprimer', tableMessages, 'deleteRows'],
  ['Message · mettre à jour', tableMessages, 'update', ['statut', 'date']],
  ['Message · enregistrer', tableMessages, 'insert', CHAMPS_MSG],
];
ECRITURES.forEach(([nom, id, operation, champs], i) => {
  const p = { resource: 'row', operation, dataTableId: table(id) };
  if (operation !== 'insert') Object.assign(p, filtreId);
  if (champs) p.columns = colonnes(champs, { segments: 'number' });
  p.options = {};
  add(nom, 'n8n-nodes-base.dataTable', 1.1, [1980, -440 + i * 150], p, operation === 'insert' ? {} : continuerSiErreur);
  lien(QO, nom, i);
});

// ---------------------------------------------------------------- Envois
const ENV = 'Envoyer ?';
add(ENV, 'n8n-nodes-base.switch', 3.2, [2260, 1360], {
  mode: 'expression', numberOutputs: 3,
  // 0 : vrai SMS (seulement vers un portable de test) · 1 : alerte ntfy · 2 : rien (simulé, programmé, bloqué, reçu)
  output: `={{ $json.sens !== 'sortant' || $json.statut !== 'envoye' ? 2 : ($json.canal === 'alerte' ? 1 : (${JSON.stringify(REELS)}.includes($json.numero) ? 0 : 2)) }}`,
  options: {},
});
lien('Message · enregistrer', ENV);
lien(QO, ENV, 12);

add('SMS (Twilio)', 'n8n-nodes-base.twilio', 1, [2520, 1260], {
  resource: 'sms', operation: 'send', from: cfg.numeroSms || '', to: '={{ $json.numero }}', toWhatsapp: false,
  message: '={{ $json.texte }}', options: {},
}, {
  ...continuerSiErreur,
  ...(twilioIdentifiant ? { credentials: { twilioApi: { id: twilioIdentifiant, name: 'Twilio account' } } } : {}),
  ...(SMS ? {} : { disabled: true }),
});
lien(ENV, 'SMS (Twilio)', 0);

// Twilio refuse un envoi (compte d'essai, numéro non vérifié, texte refusé…) : le message passe en « echec »
// (il ne compte plus comme envoyé) et le responsable est prévenu que le client n'a rien reçu.
const REFUS = 'SMS refusé ?';
add(REFUS, 'n8n-nodes-base.code', 2, [2780, 1260], {
  jsCode: [
    "const envoyes = $('Envoyer ?').all(); // mêmes éléments, dans le même ordre, que l'entrée de Twilio",
    'const refus = [];',
    '$input.all().forEach((item, i) => {',
    '  const err = item.json && item.json.error;',
    '  const m = envoyes[i] && envoyes[i].json;',
    '  if (!err || !m || !m.id) return;',
    "  const raison = String(typeof err === 'string' ? err : (err.message || JSON.stringify(err))).slice(0, 200);",
    "  refus.push({ json: { id: m.id, statut: 'echec', date: m.date, numero: m.numero, ref: m.ref || '', raison } });",
    '});',
    'return refus;',
  ].join('\n'),
});
lien('SMS (Twilio)', REFUS);
lien(REFUS, 'Message · mettre à jour');

const ALERTE_REFUS = 'Alerte · SMS refusé';
add(ALERTE_REFUS, 'n8n-nodes-base.code', 2, [3040, 1260], {
  jsCode: avecLogique([
    'return $input.all().map(({ json: r }) => ({ json: {',
    "  date: r.date, canal: 'alerte', sens: 'sortant', numero: r.numero,",
    "  texte: masquerNumero(r.numero) + ' : SMS refusé par Twilio (' + r.raison + '). Le client n’a rien reçu, à rappeler.',",
    "  contexte: 'alerte', ref: r.ref, statut: 'envoye', titre: 'SMS non parti', priorite: 'high', tags: 'warning', segments: 0,",
    '} }));',
  ].join('\n')),
});
lien(REFUS, ALERTE_REFUS);
lien(ALERTE_REFUS, 'Message · enregistrer');

add('Alerte au responsable (ntfy)', 'n8n-nodes-base.httpRequest', 4.2, [2520, 1460], {
  method: 'POST', url: cfg.ntfyUrl,
  ...(ntfyIdentifiant ? { authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth' } : {}),
  // Paramètres dans l'adresse plutôt qu'en en-têtes : les accents passent sans encodage spécial.
  sendQuery: true,
  queryParameters: {
    parameters: [
      { name: 'title', value: "={{ $json.titre || 'Accueil client IA' }}" },
      { name: 'priority', value: "={{ $json.priorite || 'default' }}" },
      { name: 'tags', value: "={{ $json.tags || '' }}" },
    ],
  },
  sendBody: true, contentType: 'raw', rawContentType: 'text/plain', body: '={{ $json.texte }}',
  options: { timeout: 5000 },
}, {
  ...continuerSiErreur,
  ...(ntfyIdentifiant ? { credentials: { httpBearerAuth: { id: ntfyIdentifiant, name: 'Bearer Auth account' } } } : {}),
});
lien(ENV, 'Alerte au responsable (ntfy)', 1);

// ---------------------------------------------------------------- Écriture du fichier
const workflow = {
  name: `Accueil client IA par SMS — ${cfg.nomEntreprise} (VorcheX)`,
  nodes, connections, active: false,
  settings: {
    executionOrder: 'v1', timezone: 'Europe/Paris',
    // La page de démo interroge l'état toutes les 4 s : on ne garde que les erreurs, sauf pendant les essais.
    saveDataSuccessExecution: process.env.TRACES === 'oui' ? 'all' : 'none', saveDataErrorExecution: 'all', saveManualExecutions: true,
  },
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
  tags: [],
};
fs.mkdirSync(path.join(ICI, 'n8n'), { recursive: true });
const sortie = path.join(ICI, 'n8n', 'famille-1-accueil-client-ia.n8n.json');
fs.writeFileSync(sortie, JSON.stringify(workflow, null, 2));
const taille = Math.round(fs.statSync(sortie).size / 1024);
console.log(`${nodes.length} blocs écrits dans ${path.relative(ICI, sortie)} (${taille} Ko) · SMS réels : ${SMS ? 'oui (portables de test)' : 'non'}`);
