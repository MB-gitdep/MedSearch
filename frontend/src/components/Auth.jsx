// components/Auth.jsx
//
// Page de connexion : redirige l'utilisateur vers le serveur SSO WordPress
// (plugin miniOrange) pour s'authentifier. Aucun secret n'est manipule ici :
// seul le client_id (public) et l'URL de redirection sont utilises.

import React from 'react';
import { authConfig, OAUTH_STATE_KEY } from '../authConfig';

// Valeur aleatoire cryptographiquement sure pour le parametre "state".
function generateState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const Auth = () => {
  const handleLogin = () => {
    // Protection CSRF du flux OAuth2 : on memorise un "state" aleatoire, le SSO
    // nous le renvoie au retour, et Callback.jsx refuse tout retour dont le
    // "state" ne correspond pas (empeche d'injecter le code d'un attaquant).
    const state = generateState();
    try {
      sessionStorage.setItem(OAUTH_STATE_KEY, state);
    } catch {
      window.alert("Impossible de démarrer la connexion : le stockage du navigateur est indisponible.");
      return;
    }

    const authorizationUri =
      `${authConfig.authorizationEndpoint}` +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(authConfig.clientId)}` +
      `&redirect_uri=${encodeURIComponent(authConfig.redirectUri)}` +
      `&scope=${encodeURIComponent(authConfig.scopes.join(' '))}` +
      `&state=${encodeURIComponent(state)}`;

    window.location.href = authorizationUri;
  };

  return (
    <div>
      <h1>Connexion</h1>
      <button onClick={handleLogin}>Se connecter avec WordPress SSO</button>
    </div>
  );
};

export default Auth;
