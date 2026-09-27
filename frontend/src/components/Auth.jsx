// components/Auth.jsx
//
// Page de connexion : redirige l'utilisateur vers le serveur SSO WordPress
// (plugin miniOrange) pour s'authentifier. Aucun secret n'est manipule ici :
// seul le client_id (public) et l'URL de redirection sont utilises.

import React from 'react';
import { authConfig } from '../authConfig';

const Auth = () => {
  const handleLogin = () => {
    const authorizationUri =
      `${authConfig.authorizationEndpoint}` +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(authConfig.clientId)}` +
      `&redirect_uri=${encodeURIComponent(authConfig.redirectUri)}` +
      `&scope=${encodeURIComponent(authConfig.scopes.join(' '))}`;

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
