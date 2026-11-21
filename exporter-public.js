// Fabrique une copie publiable du circuit n8n : chaque valeur privée (clé d'accès, numéros, ids de tables
// et d'identifiants) est remplacée par un repère {{NOM_DE_LA_VARIABLE}}. À lancer après `node construire.js`.
// Le fichier construit (n8n/famille-1-accueil-client-ia.n8n.json) reste privé : il est dans .gitignore.
const fs = require('fs');
const path = require('path');
const { lireEnv } = require('./charger-config');

const ici = __dirname;
const source = path.join(ici, 'n8n', 'famille-1-accueil-client-ia.n8n.json');
const cible = path.join(ici, 'n8n', 'modele-public.n8n.json');

// Valeurs privées du .env.
const PRIVEES = ['CLE_ACCUEIL', 'TABLE_RDV', 'TABLE_MESSAGES', 'TABLE_CONVERSATIONS', 'TABLE_ATTENTE', 'TWILIO_IDENTIFIANT',
  'NUMERO_DIRIGEANT', 'NUMERO_SMS_TWILIO', 'NTFY_IDENTIFIANT', 'ANTHROPIC_IDENTIFIANT'];

const env = lireEnv(path.join(ici, '.env'));
const paires = [
  ...PRIVEES.map((cle) => [cle, env[cle]]),
  // Vrais portables de test : chacun devient {{NUMERO_REEL_1}}, {{NUMERO_REEL_2}}…
  ...String(env.NUMEROS_REELS || '').split(',').map((n) => n.trim()).filter(Boolean)
    .map((n, i) => [`NUMERO_REEL_${i + 1}`, n]),
];

// Les plus longues d'abord, pour qu'une valeur courte ne coupe pas une valeur plus longue.
const valeurs = paires
  .filter(([, v]) => v && v.length >= 6)
  .sort((a, b) => b[1].length - a[1].length);

let texte = fs.readFileSync(source, 'utf8');
for (const [cle, valeur] of valeurs) {
  texte = texte.split(valeur).join(`{{${cle}}}`);
  // Les numéros apparaissent aussi sans le « + » dans certains messages.
  if (/^\+\d+$/.test(valeur)) texte = texte.split(valeur.slice(1)).join(`{{${cle}}}`);
}

const restes = valeurs.filter(([, v]) => texte.includes(v)).map(([cle]) => cle);
if (restes.length) {
  console.error('Arrêt : valeurs privées encore présentes :', restes.join(', '));
  process.exit(1);
}

JSON.parse(texte); // le résultat doit rester un JSON valide
fs.writeFileSync(cible, texte);
console.log(`${valeurs.length} valeurs privées masquées dans ${path.relative(ici, cible)}`);
