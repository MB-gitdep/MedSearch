// src/api.js
//
// Client HTTP unique de l'application. Centralise :
//  - l'URL de base du backend ;
//  - la gestion de l'expiration de session (reponse 401) ;
//  - la traduction des erreurs reseau/serveur en messages lisibles.
//
// Authentification : la session repose sur un cookie HttpOnly pose par le
// backend. Le navigateur l'envoie automatiquement (meme origine) mais le
// JavaScript du site ne peut ni le lire ni le copier : il n'existe plus aucun
// token en localStorage, donc rien a voler en cas de faille XSS.

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/MedSearch/api';

// Evenement emis quand le serveur refuse la session (expiree ou revoquee) :
// l'application l'ecoute pour renvoyer l'utilisateur vers l'ecran de connexion.
export const AUTH_EXPIRED_EVENT = 'medsearch:auth-expired';

// Les versions precedentes gardaient le token d'acces dans le localStorage.
// On le supprime au demarrage : il n'a plus d'utilite et ne doit pas trainer.
const LEGACY_TOKEN_KEY = 'accessToken';

export function purgeLegacyToken() {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Stockage indisponible : rien a nettoyer.
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  // Garde anti-CSRF : un site tiers ne peut pas ajouter cet en-tete personnalise
  // sans declencher un controle CORS, que le backend refuse. Le backend l'exige
  // sur les requetes POST.
  headers: { 'X-Requested-With': 'MedSearch' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 sur une requete de donnees : la session a expire ou a ete revoquee.
    // (Les routes /auth/* gerent elles-memes leurs erreurs.)
    const url = error.config?.url ?? '';
    if (error.response?.status === 401 && !url.startsWith('/auth/')) {
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
