// Tests du circuit n8n généré (structure + exécution réelle du code des blocs « Code » avec des données simulées).
// Lancer : node tests/test-circuit.js   (reconstruit d'abord le circuit)
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const ICI = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(ICI, 'construire.js')], { cwd: ICI, stdio: 'pipe' });
const wf = require(path.join(ICI, 'n8n', 'famille-1-accueil-client-ia.n8n.json'));
const { chargerConfig } = require(path.join(ICI, 'charger-config.js'));
const cfg = chargerConfig(ICI);

let ok = 0;
const t = (nom, fn) => {
  try { fn(); ok++; console.log('OK  ', nom); } catch (e) { console.log('ÉCHEC', nom, '\n     ', e.stack.split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; }
};
const bloc = (nom) => { const n = wf.nodes.find((x) => x.name === nom); if (!n) throw new Error('Bloc absent : ' + nom); return n; };
const suivants = (nom, sortie = 0) => (((wf.connections[nom] || {}).main || [])[sortie] || []).map((c) => c.node);

// Exécute le code d'un bloc « Code » comme n8n : $input, $('Bloc') (bloc non exécuté = erreur, comme dans n8n).
function executer(nom, input, noeuds = {}) {
  const $ = (n) => {
    if (!noeuds[n]) throw new Error(`Referenced node is unexecuted: ${n}`);
    return { isExecuted: true, first: () => ({ json: noeuds[n][0] }), all: () => noeuds[n].map((json) => ({ json })) };
  };
  const $input = { first: () => ({ json: input[0] }), all: () => input.map((json) => ({ json })) };
  return new Function('$', '$input', bloc(nom).parameters.jsCode)($, $input).map((i) => i.json);
}
// Évalue une expression n8n « ={{ … }} » pour un élément.
const expr = (e, $json) => new Function('$json', `return (${e.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '')});`)($json);

const CLE = cfg.cleAccueil;
const W = 'https://n8n.vorchex.tech/webhook/';
const VOUS = '+33639980001';
const VIDE = [{}]; // table vide lue avec « toujours sortir des données »
const tables = (extra = {}) => ({ 'Lire les conversations': VIDE, 'Lire les rendez-vous': VIDE, 'Lire la liste d’attente': VIDE, 'Lire les messages': VIDE, ...extra });
const verifier = (chemin, { query = {}, body = {} } = {}) => executer('Vérifier l’accès', [{ webhookUrl: W + chemin, query, body }])[0];

// ------------------------------------------------------------- Structure
t('toutes les liaisons visent des blocs existants ; noms et webhooks uniques', () => {
  const noms = new Set(wf.nodes.map((n) => n.name));
  assert.strictEqual(noms.size, wf.nodes.length);
  for (const [de, types] of Object.entries(wf.connections)) {
    assert.ok(noms.has(de), de);
    for (const sorties of Object.values(types)) for (const s of sorties) for (const c of s) assert.ok(noms.has(c.node), `${de} -> ${c.node}`);
  }
  const hooks = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  assert.strictEqual(hooks.length, 5);
  assert.strictEqual(new Set(hooks.map((n) => n.parameters.path)).size, 5);
  assert.strictEqual(new Set(hooks.map((n) => n.webhookId)).size, 5);
  assert.ok(hooks.every((n) => n.parameters.responseMode === 'responseNode'));
});
t('le code des blocs se compile (aucun nom déclaré deux fois entre la logique d’agenda et la logique SMS)', () => {
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(() => new Function('$', '$input', n.parameters.jsCode), n.name);
  }
  assert.ok(!bloc('Décider').parameters.jsCode.includes('@@tests-seulement'));
  assert.ok(!bloc('Décider').parameters.jsCode.includes('require('));
});
t('aucune clé dans le code de la logique ; la clé d’accès seulement dans « Vérifier l’accès »', () => {
  const avecCle = wf.nodes.filter((n) => JSON.stringify(n.parameters).includes(CLE)).map((n) => n.name);
  assert.deepStrictEqual(avecCle, ['Vérifier l’accès']);
});
t('chaque entrée a sa réponse ; les lectures se font une seule fois, même sur table vide', () => {
  assert.deepStrictEqual(suivants('Quelle entrée ?', 0), ['Réponse · accès refusé']);
  assert.deepStrictEqual(suivants('Quelle entrée ?', 1), ['Page de démo']);
  assert.deepStrictEqual(suivants('Quelle entrée ?', 2), ['Réponse · appel (voix)']);
  assert.deepStrictEqual(suivants('Quelle entrée ?', 3), ['Réponse · SMS reçu']);
  assert.deepStrictEqual(suivants('Quelle entrée ?', 6), ['Réponse · appel ignoré']);
  assert.deepStrictEqual(suivants('Suite ?', 0), ['Réponse · état']);
  for (const n of ['Lire les conversations', 'Lire les rendez-vous', 'Lire la liste d’attente', 'Lire les messages']) {
    assert.ok(bloc(n).executeOnce && bloc(n).alwaysOutputData, n);
  }
  assert.ok(bloc('Réponse · appel (voix)').parameters.responseBody.includes('language="fr-FR"'));
});
t('écritures rangées de haut en bas dans l’ordre des sorties (suppressions d’abord, messages et envois en dernier)', () => {
  const ys = suivants('Quelle opération ?', 0).concat(...Array.from({ length: 11 }, (_, i) => suivants('Quelle opération ?', i + 1)))
    .map((n) => bloc(n).position[1]);
  assert.deepStrictEqual(ys, ys.slice().sort((a, b) => a - b));
  assert.ok(bloc('Envoyer ?').position[1] > Math.max(...ys));
});
t('Claude branché sur l’extracteur ; Twilio grisé tant que les SMS ne sont pas activés', () => {
  assert.strictEqual(wf.connections['Claude (Comprendre le SMS)'].ai_languageModel[0][0].node, 'Comprendre le SMS (Claude)');
  assert.strictEqual(bloc('Comprendre le SMS (Claude)').onError, 'continueRegularOutput');
  const tw = bloc('SMS (Twilio)');
  assert.strictEqual(!!tw.disabled, !(cfg.smsActifs && cfg.twilioIdentifiant));
});

// ------------------------------------------------------------- Vérifier l'accès
t('accès : mauvaise clé refusée ; chaque adresse mène à sa route', () => {
  assert.strictEqual(verifier('vx-accueil-sms', { query: { cle: 'mauvaise' }, body: { From: VOUS, Body: 'x' } }).sortie, 0);
  assert.strictEqual(verifier('vx-accueil-sms', { body: { From: VOUS, Body: 'x' } }).sortie, 0);
  const a = verifier('vx-accueil-appel-manque', { query: { cle: CLE }, body: { From: VOUS, CallStatus: 'ringing' } });
  assert.deepStrictEqual([a.route, a.sortie, a.from], ['appel', 2, VOUS]);
  assert.strictEqual(verifier('vx-accueil-appel-manque', { query: { cle: CLE }, body: { From: VOUS, CallStatus: 'completed' } }).sortie, 6);
  const s = verifier('vx-accueil-sms', { body: { cle: CLE, From: VOUS, Body: 'Bonjour' } });
  assert.deepStrictEqual([s.route, s.sortie, s.texte], ['sms', 3, 'Bonjour']);
  assert.strictEqual(verifier('vx-accueil-demo', { query: { cle: CLE } }).sortie, 1);
  assert.strictEqual(verifier('vx-accueil-etat', { query: { cle: CLE } }).sortie, 4);
  const act = verifier('vx-accueil-action', { body: { cle: CLE, action: 'horloge', cible: 'veille' } });
  assert.deepStrictEqual([act.sortie, act.action, act.cible], [5, 'horloge', 'veille']);
  // Sans webhookUrl : la route vient du bloc d'entrée exécuté.
  const r = executer('Vérifier l’accès', [{ query: { cle: CLE }, body: { From: VOUS, Body: 'x' } }], { 'Webhook · SMS reçu': [{}] })[0];
  assert.strictEqual(r.route, 'sms');
});
t('page de démo : clé et adresse ajoutées côté serveur', () => {
  const { html } = executer('Page de démo', [{ cle: CLE }])[0];
  assert.ok(html.includes(`const CLE = '${CLE}'`) && html.includes(`const BASE = '${W}'`));
  assert.ok(!html.includes('__CLE__') && !html.includes('__BASE__'));
});

// ------------------------------------------------------------- Décider -> opérations -> envois
const envoyer = (ligne) => expr(bloc('Envoyer ?').parameters.output, ligne);
t('appel manqué : SMS enregistré (simulé pour un numéro de démo), alerte vers ntfy', () => {
  const d = executer('Décider', [{}], { 'Vérifier l’accès': [{ route: 'appel', from: VOUS }], ...tables() })[0];
  assert.strictEqual(d.sortie, 3);
  const ops = executer('Éclater les opérations', [d]);
  assert.ok(ops.every((o) => typeof o.sortie === 'number' && o.sortie >= 0 && o.sortie <= 12));
  const smsOp = ops.find((o) => o.canal === 'sms' && o.sens === 'sortant');
  assert.strictEqual(smsOp.numero, VOUS);
  assert.strictEqual(envoyer(smsOp), 2); // numéro de démo : jamais de vrai SMS
  assert.strictEqual(envoyer(ops.find((o) => o.canal === 'alerte')), 1);
  assert.strictEqual(envoyer(ops.find((o) => o.sens === 'entrant')), 2);
  for (const n of cfg.reel.numeros) assert.strictEqual(envoyer({ ...smsOp, numero: n }), 0); // portable de test : vrai SMS
  assert.strictEqual(envoyer({ ...smsOp, numero: cfg.reel.numeros[0] || '+33600000000', statut: 'differe' }), 2);
});
t('SMS libre : passe par Claude, puis la suite propose des créneaux ; sans Claude, règles de secours', () => {
  const noeuds = { 'Vérifier l’accès': [{ route: 'sms', from: VOUS, texte: 'Bonjour, mon chauffe-eau fuit' }], ...tables() };
  const d = executer('Décider', [{}], noeuds)[0];
  assert.strictEqual(d.sortie, 1);
  assert.ok(d.texteIA.includes('chauffe-eau'));
  const apres = executer('Décider après l’IA', [{ output: { intention: 'besoin', besoin: 'chauffe-eau qui fuit', urgence: false } }], noeuds)[0];
  const ops = executer('Éclater les opérations', [apres]);
  const msg = ops.find((o) => o.canal === 'sms' && o.sens === 'sortant');
  assert.strictEqual(msg.contexte, 'creneaux');
  assert.ok(ops.some((o) => o.op === 'conv-creer' && o.etape === 'choix_creneau'));
  const panne = executer('Décider après l’IA', [{ error: 'Anthropic indisponible' }], noeuds)[0];
  assert.ok(executer('Éclater les opérations', [panne]).some((o) => o.contexte === 'creneaux'));
});
t('état de la démo et boutons (remise à zéro) ; tâche horaire et purge sans « Vérifier l’accès »', () => {
  const e = executer('Décider', [{}], { 'Vérifier l’accès': [{ route: 'etat' }], ...tables() })[0];
  assert.strictEqual(e.sortie, 0);
  assert.strictEqual(e.etat.personnes.length, 3);
  const r = executer('Décider', [{}], { 'Vérifier l’accès': [{ route: 'action', action: 'reinitialiser' }], ...tables() })[0];
  assert.strictEqual(r.sortie, 2);
  assert.ok(r.info.includes('remise à zéro'));
  assert.strictEqual(r.ops.filter((o) => o.op === 'attente-ajouter').length, 2);
  const h = executer('Décider', [{}], { 'Tâche horaire': [{ route: 'horaire' }], ...tables() })[0];
  assert.deepStrictEqual([h.route, h.sortie], ['horaire', 3]);
  const p = executer('Décider', [{}], { 'Purge nocturne': [{ route: 'purge' }], ...tables() })[0];
  assert.deepStrictEqual([p.route, p.sortie], ['purge', 3]);
});
t('SMS refusé par Twilio : le message passe en « echec » et une alerte « SMS non parti » est enregistrée', () => {
  assert.deepStrictEqual(suivants('SMS (Twilio)'), ['SMS refusé ?']);
  assert.deepStrictEqual(suivants('SMS refusé ?').sort(), ['Alerte · SMS refusé', 'Message · mettre à jour']);
  assert.deepStrictEqual(suivants('Alerte · SMS refusé'), ['Message · enregistrer']);
  const envoyes = [
    { id: 28, numero: '+33612345678', date: '2026-11-20 22:43', ref: '', canal: 'sms', sens: 'sortant', statut: 'envoye' },
    { id: 29, numero: '+33612345679', date: '2026-11-20 22:44', ref: 'r1', canal: 'sms', sens: 'sortant', statut: 'envoye' },
  ];
  const sortie = [{ error: 'Bad request - please check your parameters' }, { sid: 'SM123', status: 'queued' }];
  const refus = executer('SMS refusé ?', sortie, { 'Envoyer ?': envoyes });
  assert.strictEqual(refus.length, 1); // le SMS parti n'est pas touché
  assert.deepStrictEqual([refus[0].id, refus[0].statut, refus[0].date], [28, 'echec', '2026-11-20 22:43']);
  const maj = bloc('Message · mettre à jour').parameters;
  assert.strictEqual(expr(maj.columns.value.statut, refus[0]), 'echec');
  assert.strictEqual(expr(maj.filters.conditions[0].keyValue, refus[0]), 28);
  const alerte = executer('Alerte · SMS refusé', refus)[0];
  assert.deepStrictEqual([alerte.canal, alerte.sens, alerte.statut, alerte.titre], ['alerte', 'sortant', 'envoye', 'SMS non parti']);
  assert.ok(alerte.texte.includes('06 12 •• •• 78') && !alerte.texte.includes('06 12 34 56 78'), alerte.texte);
  assert.strictEqual(executer('SMS refusé ?', [{ sid: 'SM1' }], { 'Envoyer ?': envoyes.slice(0, 1) }).length, 0);
});
t('page de démo : un SMS ou un appel de « reel-1 » est traité comme venant du vrai portable', () => {
  const reel = cfg.reel.numeros[0];
  const noeuds = { 'Vérifier l’accès': [{ route: 'appel', from: 'reel-1', texte: '' }], ...tables() };
  const d = executer('Décider', [{}], noeuds)[0];
  if (!reel) { assert.ok(d.resume.includes('invalide') || d.resume.includes('masqué'), d.resume); return; }
  const ops = executer('Éclater les opérations', [d]);
  const entree = ops.find((o) => o.canal === 'appel' && o.sens === 'entrant');
  assert.notStrictEqual(entree.numero, 'reel-1');
  assert.ok(entree.numero.replace(/\D/g, '').endsWith(reel.replace(/\D/g, '').slice(-8)), 'le vrai numéro, retrouvé côté serveur');
  assert.ok(ops.some((o) => o.canal === 'sms' && o.sens === 'sortant'), 'un SMS de réponse est prévu');
});

console.log(`\n${ok} test(s) réussi(s)${process.exitCode ? ', au moins un échec' : ''}.`);
