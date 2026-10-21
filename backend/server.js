// server.js
// Backend Express de l'application MedSearch.
//
// Endpoints exposes :
//  - POST /auth/token          -> echange securise du "code" OAuth2 ; ouvre une session
//                                 (cookie HttpOnly), le token SSO reste cote serveur
//  - GET  /auth/session        -> indique si le navigateur a une session ouverte
//  - POST /auth/logout         -> ferme la session
//  - GET  /medecins            -> annuaire des medecins (OpenDataSoft)         [session]
//  - GET  /fhir/practitioners      -> recherche FHIR (nom, prenom, lieu, profession...) [session]
//  - GET  /fhir/practitioners/:id  -> fiche detaillee d'un professionnel FHIR           [session]
//  - GET  /test                -> verification que le serveur repond
//
// Authentification : apres la connexion SSO, le navigateur ne recoit qu'un
// identifiant de session opaque dans un cookie HttpOnly (illisible par
// JavaScript, donc non volable par une faille XSS). Le token d'acces du SSO est
// garde dans la session, cote serveur, et revalide regulierement aupres de
// WordPress (une revocation cote SSO coupe l'acces).
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
const { sanitizeDeep } = require('./sanitize');
const { SessionStore } = require('./sessions');
const { buildCriteria, searchPractitioners, getPractitionerDetail, NotFoundError } = require('./fhirSearch');

const app = express();

// ---------------------------------------------------------------------------
// Configuration (variables d'environnement, avec valeurs par defaut sures)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
// Par defaut le serveur n'ecoute que sur la boucle locale : seul Apache (reverse
// proxy sur la meme machine) doit pouvoir l'atteindre. Ecouter sur 0.0.0.0
// exposerait le port 3000 au reseau local en contournant Apache (HTTPS, CSP...).
const HOST = process.env.HOST || '127.0.0.1';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://cv-mb.hd.free.fr';
const ESANTE_API_URL = 'https://gateway.api.esante.gouv.fr/fhir';
const ESANTE_API_KEY = process.env.ESANTE_API_KEY;
const WP_TOKEN_ENDPOINT = process.env.WP_TOKEN_ENDPOINT;
const WP_USERINFO_ENDPOINT = process.env.WP_USERINFO_ENDPOINT;
const WP_CLIENT_ID = process.env.WP_CLIENT_ID;
const WP_CLIENT_SECRET = process.env.WP_CLIENT_SECRET;
const WP_REDIRECT_URI = process.env.WP_REDIRECT_URI;

// Session et cookie
//  - COOKIE_SECURE : le cookie n'est envoye qu'en HTTPS (laisser a true en production ;
//    mettre "false" uniquement pour un test local en http).
//  - COOKIE_PATH : chemin PUBLIC de l'API (celui vu par le navigateur, derriere Apache).
//    Le cookie n'est ainsi envoye ni a WordPress ni aux autres applications du site.
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';
const COOKIE_PATH = process.env.COOKIE_PATH || '/MedSearch/api';
const COOKIE_NAME = COOKIE_SECURE ? '__Secure-medsearch_session' : 'medsearch_session';
const SESSION_MAX_AGE_MS = (Number(process.env.SESSION_MAX_AGE_HOURS) || 8) * 60 * 60 * 1000;
const SESSION_IDLE_MS = (Number(process.env.SESSION_IDLE_MINUTES) || 60) * 60 * 1000;
const SESSION_REVALIDATE_MS = (Number(process.env.SESSION_REVALIDATE_SECONDS) || 60) * 1000;

// On previent au demarrage si des variables requises manquent, plutot que
// d'echouer de facon obscure plus tard.
const requiredEnvVars = {
  ESANTE_API_KEY,
  WP_TOKEN_ENDPOINT,
  WP_USERINFO_ENDPOINT,
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

// Le serveur est derriere Apache (meme machine) : on fait confiance a l'en-tete
// X-Forwarded-For uniquement s'il vient de la boucle locale. Sans cela, le
// limiteur de debit verrait toutes les requetes comme venant de 127.0.0.1
// (un seul compteur partage par tous les visiteurs).
app.set('trust proxy', 'loopback');

// En-tetes de securite HTTP standards (protection XSS, sniffing MIME, etc.)
app.use(helmet());

// CORS restreint a l'origine du frontend, seule autorisee a appeler l'API
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Requested-With'],
}));

// Corps JSON limite : les seuls corps attendus sont minuscules ({ code }).
app.use(express.json({ limit: '10kb' }));

// Limite globale du nombre de requetes par IP (anti-abus).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requetes, veuillez reessayer plus tard.' },
});
app.use(apiLimiter);

// Limite plus stricte sur l'echange de token (cible privilegiee du brute-force).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, veuillez reessayer plus tard.' },
});

// Les reponses contiennent des donnees reservees aux utilisateurs connectes :
// on interdit leur mise en cache (navigateur, proxys intermediaires).
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Utilitaire : transmet les erreurs des handlers async au middleware d'erreurs.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------------------
// Sessions et authentification des routes de donnees
// ---------------------------------------------------------------------------

const sessions = new SessionStore({
  maxAgeMs: SESSION_MAX_AGE_MS,
  idleMs: SESSION_IDLE_MS,
  maxSessions: 1000,
});
// Nettoyage periodique des sessions expirees (ne bloque pas l'arret du process).
setInterval(() => sessions.prune(), 10 * 60 * 1000).unref();

const cookieOptions = {
  httpOnly: true,          // illisible par JavaScript : protege contre le vol par XSS
  secure: COOKIE_SECURE,   // jamais envoye en clair
  sameSite: 'strict',      // jamais envoye lors d'une requete venant d'un autre site (anti-CSRF)
  path: COOKIE_PATH,
};

function setSessionCookie(res, sessionId) {
  res.cookie(COOKIE_NAME, sessionId, { ...cookieOptions, maxAge: SESSION_MAX_AGE_MS });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

// Express ne lit pas les cookies seul : lecture minimale, par nom exact.
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

// Garde anti-CSRF supplementaire pour les requetes POST : un site tiers ne peut
// pas ajouter cet en-tete personnalise sans declencher un controle CORS, que
// notre configuration refuse. Le frontend l'ajoute a toutes ses requetes.
const requireCsrfHeader = (req, res, next) => {
  if (req.get('X-Requested-With') !== 'MedSearch') {
    return res.status(403).json({ error: 'Requete refusee.' });
  }
  next();
};

// Exige une session valide. Le token SSO de la session est revalide aupres de
// WordPress toutes les SESSION_REVALIDATE_SECONDS : s'il a ete revoque ou a
// expire, la session est detruite.
const requireAuth = asyncHandler(async (req, res, next) => {
  if (!WP_USERINFO_ENDPOINT) {
    return res.status(500).json({ error: 'Configuration serveur incomplete (authentification).' });
  }

  const sessionId = readCookie(req, COOKIE_NAME);
  const session = sessions.get(sessionId);
  if (!session) {
    if (sessionId) clearSessionCookie(res); // cookie perime ou invente : on le supprime
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  if (session.validatedUntil <= Date.now()) {
    try {
      // Le serveur SSO est seul juge de la validite du token.
      await axios.get(WP_USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        timeout: 8000,
      });
      session.validatedUntil = Date.now() + SESSION_REVALIDATE_MS;
    } catch (error) {
      const status = error.response?.status;
      if (status === 400 || status === 401 || status === 403) {
        sessions.destroy(sessionId);
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Session invalide ou expiree, veuillez vous reconnecter.' });
      }
      // Panne reseau/serveur SSO : ce n'est pas la faute de l'utilisateur.
      console.error('Erreur verification token SSO:', error.response?.data || error.message);
      return res.status(503).json({ error: "Service d'authentification momentanement indisponible." });
    }
  }

  next();
});

// ---------------------------------------------------------------------------
// Validation et nettoyage des donnees
// ---------------------------------------------------------------------------

// Un code departement francais valide : 2 chiffres, 2A/2B (Corse) ou 3
// chiffres pour les DOM-TOM (971, 972, ...). Ce format strict ne contient
// aucun guillemet : impossible d'injecter du ODSQL dans la clause "where".
const DEP_CODE_REGEX = /^(2[AB]|[0-9]{2,3})$/i;

function parsePagination(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 100);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

// ---------------------------------------------------------------------------
// Recherche de medecins (OpenDataSoft)
// ---------------------------------------------------------------------------
app.get('/medecins', requireAuth, asyncHandler(async (req, res) => {
  const depCode = String(req.query.dep_code ?? '').trim().toUpperCase();
  const { limit, offset } = parsePagination(req.query);

  if (!DEP_CODE_REGEX.test(depCode)) {
    return res.status(400).json({ error: 'Le parametre dep_code est invalide (ex: 37, 2A, 971).' });
  }

  try {
    const response = await axios.get(
      'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/medecins/records',
      {
        // L'objet "params" d'axios encode chaque valeur correctement.
        params: {
          where: `dep_code="${depCode}"`,
          limit,
          offset,
        },
        timeout: 10000,
        maxContentLength: 5 * 1024 * 1024,
      }
    );

    // L'API v2.1 renvoie les champs a plat. Le jeu de donnees ne contient ni
    // prenom separe (le nom complet est dans "nom") ni telephone. On renvoie
    // tous les champs renseignes, nettoyes : la fiche detaillee du frontend
    // les affiche tous.
    const medecins = (response.data.results || [])
      .map((record) => sanitizeDeep(record))
      .filter(Boolean);

    res.json({ total: Number(response.data.total_count) || medecins.length, medecins });
  } catch (error) {
    console.error('Erreur OpenDataSoft:', error.response?.data || error.message);
    // On ne renvoie jamais error.message brut au client (details internes).
    res.status(502).json({ error: "Impossible de recuperer les donnees de l'annuaire des medecins." });
  }
}));

// ---------------------------------------------------------------------------
// Practitioners FHIR (esante.gouv.fr)
// ---------------------------------------------------------------------------

// Appel unique vers l'API FHIR : ajoute la cle d'API (qui ne quitte jamais le
// serveur), borne le delai et la taille de la reponse.
async function fhirGet(path, params) {
  const response = await axios.get(`${ESANTE_API_URL}/v2/${path}`, {
    headers: {
      'ESANTE-API-KEY': ESANTE_API_KEY,
      'Content-Type': 'application/json',
    },
    params,
    timeout: 10000,
    maxContentLength: 5 * 1024 * 1024,
  });
  return response.data;
}

// Repond au client pour une erreur venue de l'API FHIR. Le detail complet (y
// compris le message d'erreur renvoye par l'API, utile pour diagnostiquer un
// critere non supporte) n'est ecrit que dans les logs serveur.
function respondFhirError(res, error, context, notFoundMessage) {
  if (error instanceof NotFoundError || error.response?.status === 404) {
    return res.status(404).json({ error: notFoundMessage });
  }
  console.error(`Erreur FHIR (${context}):`, error.response?.status, error.response?.data || error.message);
  if (error.response?.status === 429) {
    return res.status(503).json({ error: 'Le service national est momentanement sature, reessayez dans quelques instants.' });
  }
  return res.status(502).json({ error: "Impossible de recuperer les donnees de l'API FHIR." });
}

// Recherche par nom, prenom, profession, specialite et/ou lieu (ville, code
// postal, departement, rue). Voir fhirSearch.js pour la strategie employee.
app.get('/fhir/practitioners', requireAuth, asyncHandler(async (req, res) => {
  if (!ESANTE_API_KEY) {
    return res.status(500).json({ error: 'Configuration serveur incomplete (ESANTE_API_KEY manquante).' });
  }

  const parsed = buildCriteria(req.query);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    res.json(await searchPractitioners(parsed.criteria, fhirGet));
  } catch (error) {
    respondFhirError(res, error, 'recherche', 'Aucun resultat.');
  }
}));

// Fiche detaillee d'un professionnel (identite + lieux d'exercice).
app.get('/fhir/practitioners/:id', requireAuth, asyncHandler(async (req, res) => {
  if (!ESANTE_API_KEY) {
    return res.status(500).json({ error: 'Configuration serveur incomplete (ESANTE_API_KEY manquante).' });
  }

  try {
    res.json(await getPractitionerDetail(req.params.id, fhirGet));
  } catch (error) {
    respondFhirError(res, error, 'fiche', 'Professionnel introuvable.');
  }
}));

// ---------------------------------------------------------------------------
// Echange du code d'autorisation OAuth2 et ouverture de session.
//
// Le "client_secret" du SSO WordPress ne doit jamais partir dans le bundle
// JavaScript envoye au navigateur : le frontend envoie uniquement le "code" ;
// ce backend, seul depositaire du secret, effectue l'echange final.
// Le token obtenu n'est PAS renvoye au navigateur : il est range dans une
// session serveur, et le navigateur recoit seulement un cookie HttpOnly.
// ---------------------------------------------------------------------------
app.post('/auth/token', authLimiter, requireCsrfHeader, asyncHandler(async (req, res) => {
  if (!WP_TOKEN_ENDPOINT || !WP_CLIENT_ID || !WP_CLIENT_SECRET || !WP_REDIRECT_URI) {
    return res.status(500).json({ error: 'Configuration OAuth2 incomplete cote serveur.' });
  }

  const { code } = req.body ?? {};
  // Un code d'autorisation est une courte chaine opaque : on borne format et taille.
  if (typeof code !== 'string' || !/^[A-Za-z0-9._~-]{8,512}$/.test(code)) {
    return res.status(400).json({ error: "Le parametre 'code' est requis et doit etre valide." });
  }

  let accessToken;
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

    accessToken = tokenResponse.data?.access_token;
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new Error('Reponse du serveur SSO sans access_token.');
    }
  } catch (error) {
    console.error('Erreur echange token OAuth2:', error.response?.data || error.message);
    return res.status(502).json({ error: "Echec de l'authentification aupres du serveur SSO." });
  }

  // Nouvelle session a chaque connexion (jamais de reutilisation d'un ancien
  // identifiant) ; l'eventuelle session precedente de ce navigateur est detruite.
  sessions.destroy(readCookie(req, COOKIE_NAME));
  const sessionId = sessions.create(accessToken, { validatedUntil: Date.now() + SESSION_REVALIDATE_MS });
  setSessionCookie(res, sessionId);
  res.json({ authenticated: true });
}));

// Le navigateur ne pouvant pas lire le cookie HttpOnly, il demande au serveur
// s'il est connecte. Repond toujours 200 : "non connecte" n'est pas une erreur.
app.get('/auth/session', (req, res) => {
  const sessionId = readCookie(req, COOKIE_NAME);
  const authenticated = Boolean(sessions.get(sessionId));
  if (sessionId && !authenticated) clearSessionCookie(res);
  res.json({ authenticated });
});

// Deconnexion : detruit la session cote serveur et supprime le cookie.
app.post('/auth/logout', requireCsrfHeader, (req, res) => {
  sessions.destroy(readCookie(req, COOKIE_NAME));
  clearSessionCookie(res);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Verification que le serveur repond
// ---------------------------------------------------------------------------
app.get('/test', (req, res) => {
  res.send('Hello, the backend is working!');
});

// ---------------------------------------------------------------------------
// Gestion des exceptions
// ---------------------------------------------------------------------------

// Route inconnue -> 404 JSON propre plutot que la page HTML par defaut d'Express
app.use((req, res) => {
  res.status(404).json({ error: 'Route introuvable.' });
});

// Middleware d'erreur central : capture tout ce qui remonte via next(err).
// Les erreurs "client" (JSON mal forme, corps trop gros) donnent un 4xx
// explicite ; tout le reste devient un 500 generique, sans jamais exposer la
// stack trace ni le message interne.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    console.error('Erreur non geree:', err);
    return res.status(500).json({ error: 'Une erreur interne est survenue.' });
  }
  res.status(status).json({ error: status === 413 ? 'Requete trop volumineuse.' : 'Requete invalide.' });
});

// Filets de securite au niveau du process.
process.on('unhandledRejection', (reason) => {
  console.error('Promise rejetee non geree:', reason);
});
process.on('uncaughtException', (err) => {
  // L'etat du process est indetermine : on s'arrete, PM2 relancera proprement.
  console.error('Exception non capturee:', err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Demarrage et arret propre du serveur
// ---------------------------------------------------------------------------
const server = app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Le port ${PORT} est deja utilise par un autre processus (verifier avec : lsof -i :${PORT}).`);
  } else {
    console.error('Erreur du serveur HTTP:', err);
  }
  process.exit(1);
});

// A l'arret (pm2 stop/restart, systemd...), on termine les requetes en cours
// avant de quitter ; arret force au bout de 10 s si elles trainent.
function shutdown(signal) {
  console.log(`${signal} recu, arret du serveur...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
