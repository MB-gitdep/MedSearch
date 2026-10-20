// App.jsx
//
// Composant racine : gere le routage et l'etat global d'authentification
// (presence d'un token ; sa validite reelle est verifiee par le backend a
// chaque requete).

import './styles.css';
import React, { useState, useEffect } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import SearchForm from './components/SearchForm';
import Auth from './components/Auth';
import Callback from './components/Callback';
import { authConfig } from './authConfig';
import { AUTH_EXPIRED_EVENT, clearAccessToken, getAccessToken } from './api';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getAccessToken()));
  const [sessionExpired, setSessionExpired] = useState(false);

  // Le backend a refuse le token (expire/revoque) : on repasse en deconnecte
  // et on previent l'utilisateur au lieu de le laisser devant des erreurs.
  useEffect(() => {
    const handleExpired = () => {
      setIsAuthenticated(false);
      setSessionExpired(true);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, []);

  const handleLogout = () => {
    clearAccessToken();
    setIsAuthenticated(false);

    // Redirige vers l'endpoint de deconnexion du serveur SSO WordPress.
    window.location.href = authConfig.logoutEndpoint;
  };

  return (
    <div className="App">
      <Routes>
        <Route
          path="/"
          element={
            isAuthenticated ? (
              <>
                <SearchForm />
                <button onClick={handleLogout}>Se déconnecter</button>
              </>
            ) : (
              <div>
                <h1>Bienvenue sur MedSearch</h1>
                {sessionExpired && (
                  <p role="alert" className="form-error">
                    Votre session a expiré. Veuillez vous reconnecter.
                  </p>
                )}
                <Link to="/login">
                  <button>Se connecter</button>
                </Link>
              </div>
            )
          }
        />
        <Route path="/login" element={<Auth />} />
        <Route path="/auth/callback" element={<Callback setIsAuthenticated={setIsAuthenticated} />} />
      </Routes>
    </div>
  );
}

export default App;
