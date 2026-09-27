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
| `WP_TOKEN_ENDPOINT` | Endpoint OAuth2 "token" du SSO WordPress |
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

## Securite

Ce projet a fait l'objet d'une revue de securite. Points notables corriges :

- Le **client secret OAuth2** n'est plus present dans le code frontend :
  l'echange du code d'autorisation contre un token se fait desormais cote
  backend (route `POST /auth/token`).
- La **cle d'API esante.gouv.fr** n'est plus codee en dur dans le code
  source : elle est lue depuis une variable d'environnement.
- Validation des parametres d'entree (code departement, pagination) cote
  backend et cote frontend.
- Ajout d'en-tetes de securite HTTP ([Helmet](https://helmetjs.github.io/))
  et d'une limitation de debit ([express-rate-limit](https://www.npmjs.com/package/express-rate-limit)).
- Gestion centralisee des exceptions (middleware d'erreur, routes non
  trouvees, erreurs de promesses non gerees) : le detail des erreurs internes
  n'est jamais renvoye au client.
- Mise a jour des dependances presentant des vulnerabilites connues, et
  suppression des dependances non utilisees (`fhir-kit-client`,
  `simple-oauth2` cote frontend).

**Important — a faire avant toute mise en production** : les valeurs de cle
d'API et de client secret presentes dans une version anterieure du code
source doivent etre considerees comme compromises et **regenerees** aupres
d'esante.gouv.fr et du plugin miniOrange, meme apres application de ce
correctif.

Piste d'amelioration future : stocker le token de session dans un cookie
`httpOnly` pose par le backend plutot que dans le `localStorage` du
navigateur, afin de reduire l'impact d'une eventuelle faille XSS.

## Licence

Distribue sous licence MIT, voir [LICENSE](./LICENSE).
# MedSearch
