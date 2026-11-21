# Guide de démo : accueil client IA par SMS

Ce guide sert à présenter la démo, à la modifier, puis à passer aux vrais SMS. Les identifiants privés (numéro de démo, ids n8n, clé) sont dans `NOTES-PRIVEES.md` et dans `.env`, jamais ici.

## 1. Avant de présenter

1. Dans n8n, vérifie que le circuit **« Accueil client IA »** est actif (interrupteur vert).
2. Ouvre la page de démo : `https://n8n.vorchex.tech/webhook/vx-accueil-demo?cle=` suivi de la valeur `CLE_ACCUEIL` du fichier `.env`.
3. En bas de la colonne du milieu, clique sur **↺ Réinitialiser la démo**, puis sur **🕒 Revenir à l'heure réelle**.
4. Pour filmer :
   - masque la barre d'adresse (elle contient la clé) ;
   - utilise un nom et une adresse inventés ;
   - le vrai numéro de portable n'apparaît jamais en entier sur la page, mais vérifie quand même chaque image avant de publier.

## 2. Le scénario, pas à pas

La page montre trois colonnes : le téléphone du client à gauche, le scénario au milieu, le téléphone du responsable à droite.

| Étape | Ce que tu fais | Ce qu'on voit |
|---|---|---|
| 1. Appel manqué | Clique sur **📞 Appeler Plomberie Garnier**. Ou appelle pour de vrai (voir plus bas). | Le SMS d'accueil arrive chez le client. Une alerte « Appel manqué » arrive chez le responsable. |
| 2. Conversation | Écris dans le téléphone du client, par exemple `Bonjour, mon chauffe-eau fuit`. | Claude comprend le besoin, puis 3 créneaux vraiment libres sont proposés. |
| 3. Choix | Réponds `2`, puis ton nom et l'adresse (inventés). | « C'est réservé ! » Le rendez-vous apparaît dans l'agenda du responsable. |
| 4. Rappel de la veille | Clique sur **⏩ Avancer à la veille, 18 h**, puis réponds `OUI`. | Le rappel arrive, puis la confirmation. Le rendez-vous passe en « confirmé ». |
| 5. Jour J | Clique sur **⏩ Avancer au jour J**. | Dernier rappel, 3 h avant. |
| 6. Annulation | Réponds `ANNULER`. Passe sur l'onglet de Mme Durand ou de M. Petit, et réponds `OUI`. | La place est offerte à la liste d'attente. Le premier OUI l'emporte, l'autre reçoit « la place vient de partir ». |
| 7. Absence | Clique sur **↺ Simuler une absence**, puis réponds `RDV`. | Relance polie, puis de nouveaux créneaux. |

**Tests de robustesse** (colonne du milieu) : appel masqué, appel d'un fournisseur, double appel (l'anti-doublon bloque le 2e SMS), réponse STOP.

**Commandes du responsable** (sous son téléphone) : **⏸ Envoyer PAUSE** suspend tous les SMS automatiques, **▶ Envoyer REPRISE** les relance.

Les alertes arrivent aussi en vrai sur ton téléphone, dans l'appli **ntfy**.

### Le vrai appel

1. Depuis ton portable (le numéro vérifié dans Twilio), appelle le numéro de démo noté dans `NOTES-PRIVEES.md`.
2. Twilio lit d'abord son annonce de compte d'essai (en anglais) : appuie sur une touche quand elle le demande.
3. Une voix française annonce que personne ne peut répondre et qu'un SMS arrive. L'appel se termine.
4. Moins de 20 secondes plus tard, un onglet **« Votre portable »** apparaît sur la page, avec le SMS d'accueil. Continue la conversation depuis la page.

Avec le compte d'essai Twilio, le SMS n'arrive pas sur le vrai portable : Twilio n'accepte que ses propres modèles de messages. La page l'indique dans un bandeau. Voir la partie 4 pour passer aux vrais SMS.

### Avec un agent vocal (option)

L'accueil SMS a son propre agenda, la table n8n « Démo Garnier · Rendez-vous SMS ». Il fonctionne seul.

Pour le combiner avec un agent vocal qui écrit ses rendez-vous dans le même format (par exemple Lucie, fiche 1.2) :
1. Dans `.env`, mets dans `TABLE_RDV` l'id de la table de rendez-vous de l'agent vocal.
2. Reconstruis et redéploie (partie 3).
3. Garde un seul envoi de rappels : coupe les SMS de rappel du lendemain de l'agent vocal, sinon le client en reçoit deux.

Les rendez-vous pris au téléphone apparaissent alors chez le responsable, avec l'origine « Appel (agent vocal) », et reçoivent les mêmes rappels.

## 3. Modifier puis reconstruire

Tout se règle dans deux fichiers :
- `config-client.json` : l'entreprise, ses horaires, la durée des rendez-vous, les textes des SMS, les rappels, la liste d'attente et la démo ;
- `.env` : la clé d'accès, les numéros, les ids des tables et des identifiants n8n (modèle : `.env.exemple`).

Après chaque modification :

```bash
node tests/test-logique-sms.js
node tests/test-circuit.js
node construire.js
node exporter-public.js
```

- `construire.js` produit `n8n/famille-1-accueil-client-ia.n8n.json` (privé, jamais publié).
- `exporter-public.js` produit `n8n/modele-public.n8n.json`, sans aucune valeur privée. À lancer avant chaque publication.
- Pendant des essais, `TRACES=oui node construire.js` garde le détail de toutes les exécutions dans n8n. Pour la version finale, reconstruis sans `TRACES` : seules les erreurs restent enregistrées.

**Déploiement** : on met toujours à jour **le même circuit** (même id, voir `NOTES-PRIVEES.md`), jamais une copie. Demande à Claude : il envoie le nouveau fichier à n8n puis réactive le circuit.

## 4. Passer aux vrais SMS

C'est toi qui fais les achats et les paiements.

1. **Twilio** : passe le compte d'essai en compte payant.
2. Achète un numéro qui envoie des SMS vers la France. Pour un numéro français, Twilio demande des justificatifs (identité, adresse).
3. Dans `.env` :
   - `NUMERO_SMS_TWILIO` : ce nouveau numéro ;
   - `SMS_ACTIFS=oui` ;
   - `TWILIO_IDENTIFIANT` : déjà rempli (identifiant « Twilio » créé dans n8n).
4. Si un agent vocal envoie déjà ses propres SMS avec un autre numéro, vérifie qu'un seul des deux envoie les rappels.
5. Reconstruis et redéploie (partie 3).
6. Dans Twilio, sur la page du numéro :
   - **Voice**, « A call comes in » : Webhook, méthode POST, adresse `https://n8n.vorchex.tech/webhook/vx-accueil-appel-manque?cle=` + `CLE_ACCUEIL` ;
   - **Messaging**, « A message comes in » : Webhook, méthode POST, adresse `https://n8n.vorchex.tech/webhook/vx-accueil-sms?cle=` + `CLE_ACCUEIL`.
7. Fais un essai : appelle le numéro depuis ton portable. Le SMS doit arriver en moins d'une minute.

Tant que la démo est active (`demo.actif: true` dans `config-client.json`), seuls les portables listés dans `NUMEROS_REELS` reçoivent de vrais SMS. Les téléphones de démo (Mme Durand, M. Petit) restent simulés.

**Pour un vrai client** :
- mets `demo.actif: false` ;
- remplace l'entreprise, les horaires et les numéros (dans `config-client.json` et `.env`) ;
- relis tous les textes de `config-client.json` avec lui.

### Prochaine étape possible (non construite)

Aujourd'hui, le numéro répond directement par un message vocal. Pour un vrai client, il faudrait d'abord faire sonner son portable, puis ne passer au message et au SMS que s'il ne décroche pas. C'est faisable avec Twilio, mais seulement avec un compte payant : le compte d'essai interdit de transférer un appel.

## 5. En cas de problème

| Symptôme | Cause probable |
|---|---|
| La page affiche « Accès refusé. » | La clé dans l'adresse est fausse ou incomplète, ou la démo est désactivée (`demo.actif: false`). |
| Rien ne se passe après un vrai appel | Le circuit est inactif, ou l'adresse « A call comes in » du numéro n'a pas la bonne clé. |
| Alerte « SMS non parti » chez le responsable | Twilio a refusé le SMS (compte d'essai, numéro non vérifié, crédit épuisé). Le client n'a rien reçu : il faut le rappeler. |
| Pas de nouveau SMS après un 2e appel rapproché | Normal : l'anti-doublon attend 30 minutes entre deux SMS d'appel manqué. |
| Les rappels n'arrivent pas | Entre 21 h et 8 h, aucun SMS n'est envoyé (heures calmes). En démo, utilise les boutons d'horloge. |
