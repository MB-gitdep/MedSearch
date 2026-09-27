// src/authConfig.js
//
// Configuration OAuth2 cote client (SSO WordPress / plugin miniOrange).
//
// IMPORTANT (securite) : ce fichier ne contient AUCUN secret. Le
// "client_secret" ne doit jamais figurer dans du code envoye au navigateur
// (n'importe qui peut l'extraire du bundle JS livre). L'echange du code
// d'autorisation contre un access_token est realise cote serveur, voir
// backend/server.js (route POST /auth/token) et src/components/Callback.jsx.
//
// Toutes les valeurs ci-dessous sont donc publiques par nature (identifiant
// client, URLs). Elles sont lues depuis les variables d'environnement Vite
// (prefixees VITE_, voir .env.example) pour eviter de coder en dur une URL
// de dev/prod dans le code source.

export const authConfig = {
  clientId: import.meta.env.VITE_OAUTH_CLIENT_ID,
  authorizationEndpoint: import.meta.env.VITE_OAUTH_AUTHORIZATION_ENDPOINT,
  logoutEndpoint: import.meta.env.VITE_OAUTH_LOGOUT_ENDPOINT,
  redirectUri: import.meta.env.VITE_OAUTH_REDIRECT_URI,
  scopes: ['openid', 'profile', 'email'],
};

// L'echange de token se fait via notre propre backend (jamais directement
// vers le serveur WordPress depuis le navigateur).
export const tokenExchangeUrl = `${import.meta.env.VITE_API_BASE_URL}/auth/token`;
