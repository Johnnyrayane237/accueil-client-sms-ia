# Accueil client IA par SMS : appels manqués, rendez-vous et rappels

**Un projet de Johanne Pamegne** — automatisation et agents IA · [Portfolio](https://johanne.vorchex.tech) · [LinkedIn](https://www.linkedin.com/in/johanne-pamegne-2672b63b4)

Quand personne ne peut décrocher, l'appelant reçoit un SMS dans la minute. La conversation continue par écrit jusqu'au rendez-vous. Ensuite, le système envoie les rappels, gère les annulations, revend la place libérée à la liste d'attente et relance les absents.

**Plus aucun client perdu, plus aucun rendez-vous oublié** : tout se passe par SMS, sans application à installer et sans voix robotisée.

Démonstration réalisée sous ma marque **VorcheX** pour une entreprise **fictive**, *Plomberie Garnier*. Elle a été testée de bout en bout les 20 et 21 novembre 2026 : vrai appel depuis un portable, conversation jusqu'au rendez-vous, rappel de la veille, confirmation, et exécutions réelles du circuit n8n.

Le cas de démonstration est un plombier, mais rien n'est propre à la plomberie. Les textes des SMS, les horaires d'envoi, les délais de rappel et la taille de la liste d'attente se règlent dans [config-client.json](config-client.json). Le même système convient à tout métier qui vit de rendez-vous : cabinet, garage, salon, agence…

## Le problème de départ

Une entreprise qui ne décroche pas perd souvent le client : il appelle le concurrent suivant. Et un rendez-vous oublié, c'est un créneau payé pour rien. Je voulais deux choses :
- répondre **dans la minute** à chaque appel manqué, de jour comme de nuit ;
- faire baisser les absences, avec des rappels auxquels on répond d'un mot.

## Ce que fait le système

| Situation | Ce qui se passe |
|---|---|
| Appel manqué en journée | SMS dans la minute : « Décrivez votre besoin, on vous propose un rendez-vous ». |
| Appel manqué la nuit | Pour un métier d'urgence, réponse immédiate (« nous sommes fermés, mais on vous répond ici ; urgence ? répondez URGENT »). Sinon, SMS programmé pour 8 h. |
| Le client décrit son besoin | Claude comprend la demande (besoin, urgence) et le système propose **3 créneaux vraiment libres**, lus dans l'agenda. |
| Le client choisit | Il répond 1, 2 ou 3, puis donne son nom et l'adresse. Le rendez-vous est réservé, et le responsable est prévenu sur son téléphone. Un créneau pris entre-temps est remplacé par les suivants. |
| Urgence | Réponse URGENT : consignes de sécurité au client, alerte prioritaire au responsable. |
| La veille à 18 h, puis 3 h avant | Rappels. Le client répond **OUI**, **DEPLACER** ou **ANNULER**. |
| Annulation | La place est proposée à la liste d'attente (3 personnes à la fois) : le premier qui répond OUI l'emporte. Les autres restent sur la liste. |
| Absence | Relance polie le jour même : le client répond RDV et reçoit de nouveaux créneaux. |
| Client qui a déjà un rendez-vous | Le SMS lui rappelle son rendez-vous et propose DEPLACER ou ANNULER. |
| Fournisseur, proche | Message court au fournisseur et alerte au responsable. Aucun SMS aux numéros exclus. |
| Numéro masqué ou fixe | Pas de SMS possible : le responsable est prévenu qu'il faut rappeler. |
| STOP | Le client ne reçoit plus rien. Il peut se réinscrire. |
| PAUSE / REPRISE | Envoyés par SMS par le responsable, ces mots suspendent ou relancent l'accueil. |
| Chaque nuit | Effacement automatique des données trop anciennes (RGPD). |

## Architecture

```
Appel manqué / SMS du client ──► Twilio ──► n8n (un seul circuit, 48 blocs)
                                              ├─ logique métier (JavaScript pur, testée)
                                              ├─ compréhension des messages libres : Claude (Anthropic)
                                              ├─ agenda des rendez-vous (table n8n)
                                              ├─ conversations, messages, liste d'attente (tables n8n)
                                              └─ alertes au responsable : ntfy (auto-hébergé)
Chaque heure : rappels, SMS programmés, offres expirées · Chaque nuit : purge RGPD
```

- **Twilio** reçoit les appels et les SMS. Il envoie les SMS quand le compte le permet (voir plus bas).
- **n8n** fait tout le travail. Chaque entrée est protégée par une clé : une requête sans la bonne clé est refusée et n'écrit rien.
- La **logique métier** est dans [logique/logique-sms.js](logique/logique-sms.js) (conversations, rappels, liste d'attente, heures calmes, anti-doublon, purge) et [logique/logique-agenda.js](logique/logique-agenda.js) (heure de Paris, plages d'ouverture, créneaux libres). Elle est testée hors de n8n, puis injectée dans les blocs du circuit.

## La démonstration à deux téléphones

La [page de démo](demo/page-demo.html), servie par le circuit lui-même, montre à gauche le téléphone du client et à droite celui du responsable, avec ses alertes, son agenda et sa liste d'attente.

- On peut écrire comme un client, ou **appeler pour de vrai** depuis son portable : l'appel arrive sur la page avec le numéro masqué, et on continue la conversation depuis la page.
- Des boutons font avancer une **horloge simulée** : la veille à 18 h, le jour J, une absence. Pas besoin d'attendre deux jours pour voir un rappel.
- Des tests de robustesse sont à portée de clic : appel masqué, fournisseur, double appel (anti-doublon), réponse STOP.

## Ce qui rend le projet solide

- **Le circuit n8n est généré par du code** ([construire.js](construire.js)). Tous les réglages tiennent dans deux fichiers : [config-client.json](config-client.json) (l'entreprise, ses horaires, les SMS) et un fichier `.env` privé ([.env.exemple](.env.exemple)). Le projet ne dépend d'aucun autre.
- **69 tests automatiques** :
  - [tests/test-logique-sms.js](tests/test-logique-sms.js) (56) teste la logique : conversations, choix de créneaux, rappels, liste d'attente, heures calmes, anti-doublon, numéros masqués, purge ;
  - [tests/test-circuit.js](tests/test-circuit.js) (13) exécute le code réel des blocs du circuit construit : accès, routes, SMS refusés, page de démo.
- **Ordre des écritures maîtrisé** : chaque décision produit une liste d'opérations (agenda, conversations, messages, envois) appliquées dans un ordre fixe. Un message n'est jamais compté comme envoyé si l'opérateur l'a refusé.
- **Vie privée** : le vrai numéro de test n'est jamais envoyé en entier à la page de démo ; il est masqué dans les alertes. Les données sont effacées après 30 à 90 jours selon leur type.
- **Sécurité** : clés sur toutes les entrées, aucune clé API dans le code (elles restent chiffrées dans n8n), copie publique du circuit sans aucune valeur privée ([exporter-public.js](exporter-public.js)).

## Ce que les essais réels ont appris

- **Le compte d'essai Twilio n'envoie pas de SMS personnalisés** : en essai, Twilio n'accepte que ses propres modèles de messages. Le premier vrai appel a donc reçu une réponse vocale, mais le SMS a été refusé. J'ai fait deux corrections :
  - un SMS refusé passe désormais en « refusé par l'opérateur », avec une alerte au responsable, au lieu d'être compté comme envoyé ;
  - en démo, les SMS s'affichent sur la page, et le vrai appel y arrive quand même.
- **Un refus comptait comme un envoi** et bloquait le rappel suivant pendant 30 minutes (anti-doublon). Corrigé et testé.
- **La page de démo se mettait en veille** après quelques minutes sans clic, et un vrai appel n'y apparaissait plus. Elle jette maintenant un coup d'œil toutes les 20 secondes, et se réveille dès qu'il se passe quelque chose.

## Limites connues

- C'est une démonstration : aucun vrai client ne l'utilise encore.
- **Vrais SMS** : il faut un compte Twilio payant et un numéro acheté. Le passage est décrit dans le [guide de démo](GUIDE-DEMO.md).
- Le numéro de démo répond par un message vocal. Pour un vrai client, on ferait d'abord sonner le portable du responsable, et le message ne passerait que s'il ne décroche pas. C'est la prochaine étape, possible seulement avec un compte payant.

## Fonctionne seul, ou avec un agent vocal

Le système est complet à lui seul. Son agenda suit un format simple : début, fin, nom, téléphone, adresse, motif, origine. Un agent vocal qui écrit dans le même format peut donc partager cet agenda, par exemple [ma standardiste vocale IA](https://github.com/Johnnyrayane237/standardiste-vocal-ia) : les rendez-vous pris au téléphone reçoivent alors les mêmes rappels.

## Compétences mises en œuvre

- **Automatisation** : n8n (webhooks, tables de données, tâches planifiées, gestion d'erreurs, API interne), Twilio (voix et SMS).
- **IA** : compréhension de messages libres avec Claude, avec des règles de secours si l'IA ne répond pas.
- **JavaScript / Node.js** : logique métier sans dépendance, fuseau horaire de Paris, tests automatisés.
- **Produit** : parcours client par SMS, page de démonstration interactive, RGPD.

## Lancer les tests

```bash
node tests/test-logique-sms.js
node tests/test-circuit.js
```

---

**Johanne Pamegne** — automatisation et agents IA (VorcheX)
[Portfolio](https://johanne.vorchex.tech) · [LinkedIn](https://www.linkedin.com/in/johanne-pamegne-2672b63b4) · [GitHub](https://github.com/Johnnyrayane237)

Je cherche une alternance en automatisation et IA. Si ce projet vous parle, écrivez-moi sur LinkedIn.
