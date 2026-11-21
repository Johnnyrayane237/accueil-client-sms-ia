// Réunit la configuration de l'accueil client IA par SMS :
//   1. config-client.json : l'entreprise, ses horaires, les règles des rendez-vous, les SMS, les modèles, la démo ;
//   2. .env de ce dossier : clé d'accès des webhooks, numéros, ids des tables et des identifiants n8n.
// Les clés API ne sont jamais lues ici : elles vivent, chiffrées, dans les identifiants n8n.
// Le projet est autonome. Pour partager l'agenda avec un agent vocal qui lit le même format de rendez-vous
// (Lucie, fiche 1.2), il suffit de mettre l'id de sa table de rendez-vous dans TABLE_RDV.
const fs = require('fs');
const path = require('path');

const CORRESPONDANCE = {
  CLE_ACCUEIL: 'cleAccueil',
  NUMERO_DIRIGEANT: 'numeroDirigeant',
  NUMERO_SMS_TWILIO: 'numeroSms',
  NTFY_URL: 'ntfyUrl',
  NTFY_IDENTIFIANT: 'ntfyIdentifiant',
  ANTHROPIC_IDENTIFIANT: 'anthropicIdentifiant',
  TWILIO_IDENTIFIANT: 'twilioIdentifiant',
  TABLE_RDV: 'tableRdv',
  TABLE_MESSAGES: 'tableMessages',
  TABLE_CONVERSATIONS: 'tableConversations',
  TABLE_ATTENTE: 'tableAttente',
  SMS_ACTIFS: 'smsActifs',
};

function lireEnv(fichier) {
  const res = {};
  if (!fs.existsSync(fichier)) return res;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(ligne);
    if (m) res[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return res;
}

function chargerConfig(dossier = __dirname) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dossier, 'config-client.json'), 'utf8'));
  delete cfg._note;
  const env = lireEnv(path.join(dossier, '.env'));
  for (const [cle, champ] of Object.entries(CORRESPONDANCE)) {
    if (env[cle] !== undefined && env[cle] !== '') cfg[champ] = env[cle];
  }
  // Vrais portables de test : les seuls à recevoir de vrais SMS (les numéros de démo restent simulés).
  cfg.reel = { numeros: String(env.NUMEROS_REELS || '').split(',').map((n) => n.trim()).filter(Boolean) };
  cfg.smsActifs = cfg.smsActifs === true || String(cfg.smsActifs || 'non').toLowerCase() === 'oui';
  if (!cfg.cleAccueil) throw new Error('CLE_ACCUEIL manquante dans .env');
  return cfg;
}

// Ce qui reste à remplir, en français, pour prévenir avant de construire.
function aRemplir(cfg) {
  const manque = [];
  const tel = /^\+\d{8,15}$/;
  if (!cfg.tableRdv) manque.push('TABLE_RDV (table n8n des rendez-vous, ou celle de l’agent vocal pour partager l’agenda)');
  if (!cfg.tableMessages) manque.push('TABLE_MESSAGES (table n8n « Démo Garnier · Messages »)');
  if (!cfg.tableConversations) manque.push('TABLE_CONVERSATIONS (table n8n « Démo Garnier · Conversations SMS »)');
  if (!cfg.tableAttente) manque.push("TABLE_ATTENTE (table n8n « Démo Garnier · Liste d'attente »)");
  if (!tel.test(cfg.numeroDirigeant || '')) manque.push('NUMERO_DIRIGEANT (portable du responsable, format +33…)');
  if (!cfg.anthropicIdentifiant) manque.push('ANTHROPIC_IDENTIFIANT (identifiant n8n « Anthropic account »)');
  if (!cfg.ntfyIdentifiant) manque.push('NTFY_IDENTIFIANT (identifiant n8n de ntfy, pour les alertes)');
  if (cfg.smsActifs && !tel.test(cfg.numeroSms || '')) manque.push('NUMERO_SMS_TWILIO (SMS_ACTIFS=oui mais pas de numéro)');
  if (cfg.smsActifs && !cfg.twilioIdentifiant) manque.push('TWILIO_IDENTIFIANT (identifiant Twilio créé dans n8n)');
  return manque;
}

// Champs qui servent à construire le circuit mais ne doivent pas être recopiés dans le code des blocs.
const HORS_CODE = ['cleAccueil', 'tableRdv', 'tableMessages', 'tableConversations', 'tableAttente', 'ntfyIdentifiant', 'anthropicIdentifiant', 'twilioIdentifiant'];

module.exports = { chargerConfig, aRemplir, HORS_CODE, lireEnv };
