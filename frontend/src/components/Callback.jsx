// components/Callback.jsx
//
// Page de retour du SSO WordPress. Recupere le "code" d'autorisation dans
// l'URL et l'envoie a notre backend (POST /auth/token), qui seul connait le
// client_secret et effectue l'echange final aupres du serveur WordPress.
// Le frontend ne manipule jamais le secret : voir authConfig.js.

import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { tokenExchangeUrl } from '../authConfig';

const Callback = ({ setIsAuthenticated }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const handleCallback = async () => {
      const queryParams = new URLSearchParams(location.search);
      const code = queryParams.get('code');
      const oauthError = queryParams.get('error');

      if (oauthError) {
        setError("La connexion a ete refusee ou a echoue.");
        return;
      }

      if (!code) {
        setError("Code d'autorisation manquant.");
        return;
      }

      try {
        const response = await axios.post(tokenExchangeUrl, { code });
        const accessToken = response.data.access_token;

        if (!accessToken) {
          throw new Error('Reponse invalide du serveur.');
        }

        if (cancelled) return;

        // Le token est conserve cote client pour authentifier les appels API
        // suivants. A noter : le localStorage reste accessible en cas de
        // faille XSS sur le site ; pour un durcissement supplementaire, une
        // evolution possible est de faire porter la session par un cookie
        // httpOnly pose par le backend plutot que par le frontend.
        localStorage.setItem('accessToken', accessToken);

        if (setIsAuthenticated) {
          setIsAuthenticated(true);
        }

        navigate('/');
      } catch (err) {
        console.error('Erreur lors de la recuperation du token:', err);
        if (!cancelled) {
          setError("La connexion a echoue. Merci de reessayer.");
        }
      }
    };

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [location, navigate, setIsAuthenticated]);

  if (error) {
    return (
      <div>
        <p>{error}</p>
        <button onClick={() => navigate('/login')}>Reessayer</button>
      </div>
    );
  }

  return <div>Traitement de la connexion...</div>;
};

Callback.propTypes = {
  setIsAuthenticated: PropTypes.func,
};

export default Callback;
