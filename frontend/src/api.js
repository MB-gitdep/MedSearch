// src/api.js
//
// Client HTTP unique de l'application. Centralise :
//  - l'URL de base du backend ;
//  - l'ajout automatique du token d'acces (en-tete Authorization) ;
//  - la gestion de l'expiration de session (reponse 401) ;
//  - la traduction des erreurs reseau/serveur en messages lisibles.

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/MedSearch/api';

const ACCESS_TOKEN_KEY = 'accessToken';

// Evenement emis quand le serveur refuse le token (expire ou invalide) :
// l'application l'ecoute pour renvoyer l'utilisateur vers l'ecran de connexion.
export const AUTH_EXPIRED_EVENT = 'medsearch:auth-expired';

// L'acces au stockage peut lever une exception (navigation privee stricte,
// stockage desactive...) : on l'encapsule pour ne jamais faire planter l'app.
export function getAccessToken() {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token) {
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    return true;
  } catch {
    return false;
  }
}

export function clearAccessToken() {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // Rien a faire : le token n'est de toute facon pas lisible.
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 alors qu'on avait un token : la session a expire ou a ete revoquee.
    if (error.response?.status === 401 && getAccessToken()) {
      clearAccessToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  }
);

// Transforme une erreur axios en message affichable a l'utilisateur.
// Renvoie null si la requete a simplement ete annulee (rien a afficher).
export function getErrorMessage(error, fallback = 'Une erreur est survenue. Merci de réessayer.') {
  if (axios.isCancel(error)) return null;

  if (!error.response) {
    return error.code === 'ECONNABORTED'
      ? 'Le serveur met trop de temps à répondre. Merci de réessayer.'
      : 'Impossible de joindre le serveur. Vérifiez votre connexion.';
  }

  switch (error.response.status) {
    case 401:
      return 'Votre session a expiré, veuillez vous reconnecter.';
    case 429:
      return 'Trop de requêtes, veuillez patienter quelques minutes.';
    default: {
      const message = error.response.data?.error;
      return typeof message === 'string' ? message : fallback;
    }
  }
}

export default api;
