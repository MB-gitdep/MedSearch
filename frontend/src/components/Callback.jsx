// components/Callback.jsx
//
// Page de retour du SSO WordPress. Verifie le parametre "state" (anti-CSRF),
// puis envoie le "code" d'autorisation a notre backend (POST /auth/token), qui
// seul connait le client_secret et effectue l'echange final.

import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import api, { getErrorMessage, setAccessToken } from '../api';
import { OAUTH_STATE_KEY } from '../authConfig';

// Lit puis supprime le "state" memorise : il n'est valable qu'une seule fois.
function consumeExpectedState() {
  try {
    const state = sessionStorage.getItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    return state;
  } catch {
    return null;
  }
}

const Callback = ({ setIsAuthenticated }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  // Un code d'autorisation est a usage unique : on garantit qu'il n'est
  // echange qu'une fois, meme si React rejoue l'effet (mode StrictMode).
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const handleCallback = async () => {
      const queryParams = new URLSearchParams(location.search);
      const code = queryParams.get('code');
      const returnedState = queryParams.get('state');
      const expectedState = consumeExpectedState();

      if (queryParams.get('error')) {
        setError('La connexion a été refusée ou a échoué.');
        return;
      }

      if (!expectedState || !returnedState || returnedState !== expectedState) {
        setError('Retour de connexion invalide (état de session non reconnu). Merci de réessayer.');
        return;
      }

      if (!code) {
        setError("Code d'autorisation manquant.");
        return;
      }

      try {
        const response = await api.post('/auth/token', { code });
        const accessToken = response.data?.access_token;

        if (typeof accessToken !== 'string' || accessToken === '') {
          throw new Error('Réponse invalide du serveur.');
        }

        // Le token est conserve cote client pour authentifier les appels API
        // suivants. Le localStorage reste lisible en cas de faille XSS : c'est
        // pourquoi le site est protege par une CSP stricte (voir README).
        if (!setAccessToken(accessToken)) {
          setError("Impossible d'enregistrer la session : le stockage du navigateur est indisponible.");
          return;
        }

        setIsAuthenticated?.(true);
        // replace : le code d'autorisation ne reste pas dans l'historique.
        navigate('/', { replace: true });
      } catch (err) {
        console.error('Erreur lors de la récupération du token:', err);
        setError(getErrorMessage(err, 'La connexion a échoué. Merci de réessayer.'));
      }
    };

    handleCallback();
  }, [location, navigate, setIsAuthenticated]);

  if (error) {
    return (
      <div>
        <p role="alert">{error}</p>
        <button onClick={() => navigate('/login', { replace: true })}>Réessayer</button>
      </div>
    );
  }

  return <div>Traitement de la connexion...</div>;
};

Callback.propTypes = {
  setIsAuthenticated: PropTypes.func,
};

export default Callback;
