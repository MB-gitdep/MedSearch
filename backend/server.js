// server.js
// Backend Express de l'application MedSearch.
// Ce serveur expose 3 endpoints :
//  - GET  /medecins            -> proxy vers l'API OpenDataSoft (annuaire des medecins)
//  - GET  /fhir/practitioners  -> proxy vers l'API FHIR d'esante.gouv.fr (Practitioners)
//  - POST /auth/token          -> echange securise du "code" OAuth2 contre un access_token
//                                 (le client_secret WordPress reste ici, jamais cote frontend)
//
// Toutes les valeurs sensibles (cles d'API, secrets OAuth) sont lues depuis
// des variables d'environnement (voir .env.example) et ne doivent jamais
// etre codees en dur ni committees dans le depot Git.

// On charge explicitement le .env situe a cote de ce fichier plutot que de
// se fier au repertoire de travail du process (process.cwd()) : certains
// gestionnaires de process (PM2, systemd...) demarrent avec un cwd different
// du dossier du script, ce qui ferait chercher le .env au mauvais endroit.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// ---------------------------------------------------------------------------
// Configuration (variables d'environnement, avec valeurs par defaut sures)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://cv-mb.hd.free.fr';
const ESANTE_API_URL = 'https://gateway.api.esante.gouv.fr/fhir';
const ESANTE_API_KEY = process.env.ESANTE_API_KEY;
const WP_TOKEN_ENDPOINT = process.env.WP_TOKEN_ENDPOINT;
const WP_CLIENT_ID = process.env.WP_CLIENT_ID;
const WP_CLIENT_SECRET = process.env.WP_CLIENT_SECRET;
const WP_REDIRECT_URI = process.env.WP_REDIRECT_URI;

// On verifie au demarrage que les secrets requis sont bien presents, plutot
// que d'echouer silencieusement (ou pire, d'utiliser une valeur vide) plus tard.
const requiredEnvVars = {
  ESANTE_API_KEY,
  WP_TOKEN_ENDPOINT,
  WP_CLIENT_ID,
  WP_CLIENT_SECRET,
  WP_REDIRECT_URI,
};
const missingEnvVars = Object.entries(requiredEnvVars)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingEnvVars.length > 0) {
  console.warn(
    `Attention : variables d'environnement manquantes (${missingEnvVars.join(', ')}). ` +
    'Copiez backend/.env.example vers backend/.env et renseignez ces valeurs. ' +
    "Les endpoints concernes repondront une erreur 500 tant qu'elles ne sont pas definies."
  );
}

// ---------------------------------------------------------------------------
// Middlewares globaux
// ---------------------------------------------------------------------------

// En-tetes de securite HTTP standards (protection XSS, sniffing MIME, etc.)
app.use(helmet());

// CORS restreint a l'origine du frontend, seule autorisee a appeler l'API
app.use(cors({
  origin: CORS_ORIGIN,
}));

app.use(express.json());

// Limite le nombre de requetes par IP pour limiter les abus / le brute-force
// (notamment utile sur /auth/token, cible potentielle d'attaques automatisees).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requetes, veuillez reessayer plus tard.' },
});
app.use(apiLimiter);

// Petit utilitaire pour eviter de repeter des try/catch dans chaque route
// async : capture l'erreur et la transmet au middleware d'erreurs central.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------------------
// Validation des entrees
// ---------------------------------------------------------------------------

// Un code departement francais valide : 2 chiffres (01-95), 2A/2B (Corse)
// ou 3 chiffres pour les DOM-TOM (971, 972, ...).
const DEP_CODE_REGEX = /^(2[AB]|[0-9]{2,3})$/i;

function parsePagination(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 100);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

// ---------------------------------------------------------------------------
// Endpoint existant : recherche de medecins (OpenDataSoft)
// ---------------------------------------------------------------------------
app.get('/medecins', asyncHandler(async (req, res) => {
  const { dep_code: depCode } = req.query;
  const { limit, offset } = parsePagination(req.query);

  if (!depCode || !DEP_CODE_REGEX.test(String(depCode).trim())) {
    return res.status(400).json({ error: 'Le parametre dep_code est invalide (ex: 37, 2A, 971).' });
  }

  try {
    const response = await axios.get(
      'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/medecins/records',
      {
        // On utilise l'objet "params" d'axios plutot qu'une concatenation de
        // chaine : axios encode correctement chaque valeur et evite toute
        // injection dans l'URL envoyee a l'API distante.
        params: {
          where: `dep_code="${depCode}"`,
          limit,
          offset,
        },
        timeout: 10000,
      }
    );

    const medecins = (response.data.results || []).map((record) => ({
      // Le jeu de donnees "medecins" d'OpenDataSoft ne fournit pas de
      // prenom separe (le nom complet est deja dans "nom"), ni de numero
      // de telephone. "libelle_profession" est l'equivalent le plus proche
      // d'une specialite pour ce jeu de donnees.
      nom: record.nom ?? null,
      adresse: record.adresse ?? null,
      commune: record.commune ?? null,
      profession: record.libelle_profession ?? null,
    }));

    res.json(medecins);
  } catch (error) {
    console.error('Erreur OpenDataSoft:', error.response?.data || error.message);
    // On ne renvoie jamais error.message brut au client : il pourrait
    // exposer des details internes (URL, cles, stack). Message generique ici,
    // detail complet uniquement dans les logs serveur.
    res.status(502).json({ error: "Impossible de recuperer les donnees de l'annuaire des medecins." });
  }
}));

// ---------------------------------------------------------------------------
// Endpoint FHIR : recherche des Practitioners (esante.gouv.fr)
// ---------------------------------------------------------------------------
app.get('/fhir/practitioners', asyncHandler(async (req, res) => {
  if (!ESANTE_API_KEY) {
    return res.status(500).json({ error: "Configuration serveur incomplete (ESANTE_API_KEY manquante)." });
  }

  const { limit } = parsePagination(req.query);

  try {
    const practitionersResponse = await axios.get(`${ESANTE_API_URL}/v2/Practitioner`, {
      headers: {
        'ESANTE-API-KEY': ESANTE_API_KEY,
        'Content-Type': 'application/json',
      },
      params: {
        _total: 'accurate',
        _count: limit,
        'qualification-code': '10',
      },
      timeout: 10000,
    });

    res.json(practitionersResponse.data);
  } catch (error) {
    console.error('Erreur FHIR:', error.response?.data || error.message);
    res.status(502).json({ error: "Impossible de recuperer les donnees de l'API FHIR." });
  }
}));

// ---------------------------------------------------------------------------
// Endpoint OAuth2 : echange du code d'autorisation contre un access_token.
//
// C'est la correction de la faille la plus importante du projet : le
// "client_secret" du SSO WordPress ne doit jamais partir dans le bundle
// JavaScript envoye au navigateur (n'importe qui pouvait auparavant
// l'extraire du code source du frontend). Le frontend envoie uniquement le
// "code" recu de WordPress ; c'est ce backend, seul depositaire du secret,
// qui effectue l'echange final.
// ---------------------------------------------------------------------------
app.post('/auth/token', asyncHandler(async (req, res) => {
  if (!WP_TOKEN_ENDPOINT || !WP_CLIENT_ID || !WP_CLIENT_SECRET || !WP_REDIRECT_URI) {
    return res.status(500).json({ error: 'Configuration OAuth2 incomplete cote serveur.' });
  }

  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: "Le parametre 'code' est requis." });
  }

  try {
    const tokenResponse = await axios.post(
      WP_TOKEN_ENDPOINT,
      new URLSearchParams({
        code,
        client_id: WP_CLIENT_ID,
        client_secret: WP_CLIENT_SECRET,
        redirect_uri: WP_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );

    // On ne renvoie au frontend que ce qui lui est necessaire.
    res.json({ access_token: tokenResponse.data.access_token });
  } catch (error) {
    console.error('Erreur echange token OAuth2:', error.response?.data || error.message);
    res.status(502).json({ error: "Echec de l'authentification aupres du serveur SSO." });
  }
}));

// ---------------------------------------------------------------------------
// Endpoint de sante / verification que le serveur repond
// ---------------------------------------------------------------------------
app.get('/test', (req, res) => {
  res.send('Hello, the backend is working!');
});

// ---------------------------------------------------------------------------
// Gestion des exceptions
// ---------------------------------------------------------------------------

// Route inconnue -> 404 propre plutot que le HTML par defaut d'Express
app.use((req, res) => {
  res.status(404).json({ error: 'Route introuvable.' });
});

// Middleware d'erreur central : capture tout ce qui remonte via next(err)
// (y compris depuis asyncHandler) et repond de facon uniforme sans jamais
// exposer la stack trace au client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Erreur non geree:', err);
  res.status(500).json({ error: 'Une erreur interne est survenue.' });
});

// Filets de securite au niveau du process : on logue et on arrete proprement
// plutot que de laisser le serveur dans un etat indetermine.
process.on('unhandledRejection', (reason) => {
  console.error('Promise rejetee non geree:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Exception non capturee:', err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Demarrage du serveur
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
