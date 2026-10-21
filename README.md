# MedSearch

Application de recherche de professionnels de sante :

- **Medecins** via l'annuaire public [OpenDataSoft](https://public.opendatasoft.com/) ;
- **Practitioners** via l'API [FHIR](https://esante.gouv.fr/) de la plateforme esante.gouv.fr.

L'acces a l'application est protege par une authentification unique (SSO)
adossee a WordPress via le plugin miniOrange (OAuth2 / OpenID Connect).

## Architecture

```
medecins_app/
├── backend/    Serveur Express (Node.js) : proxy vers les API externes,
│               echange securise du token OAuth2, cles d'API cote serveur.
└── frontend/   Application React (Vite) : formulaire de recherche,
                ecrans de connexion / callback SSO.
```

Le frontend n'appelle jamais directement les API externes ni le serveur SSO
pour l'echange final de token : tout passe par le backend, seul depositaire
des secrets (cle d'API esante.gouv.fr, client secret OAuth2).

## Prerequis

- Node.js 18 ou superieur
- npm

## Installation

Le projet est organise en workspaces npm (`backend/` et `frontend/`), une
seule commande a la racine installe les deux :

```bash
npm install
```

## Configuration

Deux fichiers d'environnement sont necessaires, a partir des modeles fournis :

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Completez ensuite chaque `.env` avec vos propres valeurs (voir les
commentaires dans les fichiers `.env.example`). **Ces fichiers `.env` ne
doivent jamais etre commites dans Git** (ils sont ignores par `.gitignore`).

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `PORT` | Port d'ecoute du serveur Express (defaut : 3000) |
| `CORS_ORIGIN` | URL du frontend autorisee a appeler l'API |
| `ESANTE_API_KEY` | Cle d'API de la plateforme esante.gouv.fr |
| `HOST` | Interface d'ecoute (defaut : `127.0.0.1`, ne pas exposer le backend au reseau) |
| `WP_TOKEN_ENDPOINT` | Endpoint OAuth2 "token" du SSO WordPress |
| `WP_USERINFO_ENDPOINT` | Endpoint "userinfo" du SSO, utilise pour revalider le token de chaque session |
| `COOKIE_SECURE` | Cookie de session envoye en HTTPS uniquement (defaut : `true` ; `false` seulement pour un test local en http) |
| `COOKIE_PATH` | Chemin public de l'API vu par le navigateur (defaut : `/MedSearch/api`) |
| `SESSION_MAX_AGE_HOURS` | Duree maximale d'une session (defaut : 8) |
| `SESSION_IDLE_MINUTES` | Delai d'inactivite avant expiration (defaut : 60) |
| `SESSION_REVALIDATE_SECONDS` | Frequence de revalidation du token aupres du SSO (defaut : 60) |
| `WP_CLIENT_ID` | Client ID du plugin miniOrange |
| `WP_CLIENT_SECRET` | Client secret du plugin miniOrange (**secret**) |
| `WP_REDIRECT_URI` | URI de redirection post-connexion |

### Frontend (`frontend/.env`)

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Base des appels vers le backend (ex : `/MedSearch/api`) |
| `VITE_OAUTH_CLIENT_ID` | Client ID public du SSO |
| `VITE_OAUTH_AUTHORIZATION_ENDPOINT` | Endpoint OAuth2 "authorize" |
| `VITE_OAUTH_LOGOUT_ENDPOINT` | Endpoint de deconnexion |
| `VITE_OAUTH_REDIRECT_URI` | URI de redirection post-connexion |

Ces variables frontend sont publiques par nature (elles finissent dans le
bundle JavaScript livre au navigateur) : n'y placez jamais de secret.

## Lancer en developpement

```bash
# Terminal 1
npm run dev:backend

# Terminal 2
npm run dev:frontend
```

## Build de production (frontend)

```bash
npm run build:frontend
```

Le resultat est genere dans `frontend/dist/`.

## Recherche dans l'Annuaire Sante (FHIR)

Criteres combinables (ils se cumulent) : **nom, prenom, profession, specialite**
et **lieu** (ville, code postal, departement, rue). Les listes de professions et
de specialites viennent des terminologies officielles de l'ANS
(`frontend/src/fhirOptions.js`, codes actifs uniquement).

Limites de l'API publique (CapabilityStatement officiel de l'Annuaire Sante) :

- Un professionnel (`Practitioner`) n'a **ni adresse ni telephone** dans les donnees
  publiques : le lieu est porte par ses structures (`Organization`), reliees par ses
  situations d'exercice (`PractitionerRole`). La recherche par lieu passe donc par
  les structures (`backend/fhirSearch.js`).
- Le **departement** est obtenu par prefixe de code postal (Corse : 2A = 200xx-201xx,
  2B = 202xx-206xx). La **region** n'est pas filtrable par l'API.
- Pour un lieu seul dans une grande ville, les resultats peuvent etre **tronques**
  (volumes limites pour proteger l'API et la cle) : l'application l'indique et invite
  a ajouter des criteres (nom, profession...). Avec un nom ou une profession, la
  recherche part des personnes et le filtre par lieu est applique ensuite.
- Aucun critere = refus (evite de telecharger l'annuaire entier).

Si un critere ne donne jamais de resultat alors qu'il devrait, consulter
`pm2 logs medSearch` : la ligne `Erreur FHIR (...)` contient la reponse de l'API
(cle d'API jamais journalisee).

## Fiches detaillees

Un clic sur un nom ouvre une fiche dans une pop-in basee sur l'element HTML natif
`<dialog>` en mode modal, choisi parce que c'est l'option la plus sure : aucune
bibliotheque tierce, focus clavier et touche Echap geres par le navigateur, pas de
`window.open()` (donc pas de "tabnabbing"). Les donnees sont toujours rendues comme
du texte, jamais comme du HTML, et aucun lien n'est construit a partir des donnees.

- **Fiche Annuaire Sante** : sections lisibles (profession et specialites, lieux
  d'exercice avec adresse et contacts, identite, identifiants RPPS / ID NPS,
  diplomes, carte CPS, derniere mise a jour). Les lieux sont charges a l'ouverture ;
  s'ils sont indisponibles, la fiche reste affichee. Toutes les donnees brutes
  restent accessibles dans un bloc replie en bas de fiche.
- **Fiche medecin (OpenDataSoft)** : identite, activite, localisation, autres informations.

Les champs `column_N` du jeu de donnees OpenDataSoft n'ont pas de nom officiel ;
leurs libelles sont deduits de leur contenu et se corrigent dans
`frontend/src/components/detailLabels.js`.

## Securite

Points traites :

- **Secrets** : le client secret OAuth2 et la cle d'API esante.gouv.fr ne sont
  plus dans le code ; ils sont lus depuis `backend/.env` (ignore par Git).
- **Routes protegees** : `/medecins` et `/fhir/practitioners` exigent une session
  ouverte. Avant, l'ecran de connexion n'etait qu'un decor cote navigateur : l'API
  etait interrogeable directement.
- **Session par cookie HttpOnly** : apres la connexion SSO, le token d'acces reste
  **cote serveur** (jamais envoye au navigateur) ; le navigateur recoit seulement un
  identifiant de session aleatoire de 256 bits dans un cookie `HttpOnly` (illisible par
  JavaScript : une faille XSS ne peut plus voler la session), `Secure` (HTTPS
  uniquement), `SameSite=Strict` (jamais envoye depuis un autre site) et limite au
  chemin de l'API (ni WordPress ni les autres applications ne le recoivent).
  Nouvelle session a chaque connexion, expiration par duree maximale et par
  inactivite, deconnexion qui detruit la session cote serveur, et revalidation
  reguliere du token aupres du SSO : un acces revoque dans WordPress est coupe
  au plus tard apres `SESSION_REVALIDATE_SECONDS`. Les requetes POST exigent en
  plus l'en-tete `X-Requested-With` (garde anti-CSRF).
- **OAuth2** : echange du code cote backend uniquement, parametre `state`
  anti-CSRF verifie au retour, code a usage unique protege contre le double envoi.
- **Entrees** : validation stricte (code departement, pagination, code OAuth),
  corps JSON limite a 10 Ko, donnees tierces nettoyees (types, tailles et
  profondeur bornes) avant d'etre renvoyees au navigateur.
- **Exceptions** : middleware d'erreur central, 404 JSON, erreurs 4xx explicites,
  erreurs internes jamais detaillees au client, arret propre (SIGTERM), message
  clair si le port est deja pris, `ErrorBoundary` et messages d'erreur lisibles
  cote React, expiration de session geree (retour a l'ecran de connexion).
- **Reseau** : en-tetes Helmet, `Cache-Control: no-store`, limitation de debit
  (globale + stricte sur `/auth/token`), `trust proxy` limite a la boucle locale
  (sinon tous les visiteurs partageraient un seul compteur derriere Apache),
  ecoute sur `127.0.0.1` uniquement.
- **Dependances** : vulnerabilites connues corrigees (`npm audit` : 0), dependances
  inutilisees retirees. Relancer `npm audit` regulierement.

**A faire avant toute mise en production** : les valeurs de cle d'API et de client
secret qui ont figure dans une version anterieure du code (ou dans des fichiers
de configuration partages) doivent etre considerees comme compromises et
**regenerees**. Cela vaut aussi pour tout secret laisse en commentaire dans la
configuration Apache (`OIDCClientSecret`, `OIDCCryptoPassphrase`...) : supprimer
ces lignes plutot que les commenter.

## Durcissement du deploiement (Apache / serveur)

**1. Ne pas faire tourner le backend en root.** Le creer sous un compte sans
privileges (ex. `www-data`, ou un compte dedie), avec un `.env` lisible par lui seul :

```bash
sudo chown www-data:www-data backend/.env && sudo chmod 600 backend/.env
sudo -u www-data pm2 start backend/server.js --name medSearch
sudo -u www-data pm2 save
```

**2. Cibler l'IPv4 explicitement** dans Apache (le backend n'ecoute que sur 127.0.0.1) :

```apache
ProxyPass /MedSearch/api http://127.0.0.1:3000
ProxyPassReverse /MedSearch/api http://127.0.0.1:3000
```

**3. CSP stricte pour MedSearch uniquement.** La politique globale du vhost
autorise `'unsafe-inline'` et `'unsafe-eval'` (necessaire a WordPress, pas a
MedSearch). Cette politique, limitee a `/MedSearch`, remplace la globale pour
cette application ; la tester dans la console du navigateur (aucune violation
CSP ne doit apparaitre) avant de la garder :

```apache
<Location /MedSearch>
    Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
</Location>
```

Limite assumee : les sessions sont gardees en memoire. Un redemarrage du backend
(deploiement, `pm2 restart`) deconnecte les utilisateurs, qui se reconnectent via le SSO.
Si le backend devait tourner en plusieurs instances, il faudrait un magasin de sessions
partage (base de donnees, Redis).

**Migration** : les anciennes versions gardaient le token dans le `localStorage`. Le
frontend supprime automatiquement cette ancienne valeur au demarrage ; chaque utilisateur
doit se reconnecter une fois apres la mise a jour.

## Licence

Distribue sous licence MIT, voir [LICENSE](./LICENSE).
