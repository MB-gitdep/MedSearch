// App.jsx
//
// Composant racine : gere le routage et l'etat global d'authentification.
// La session est portee par un cookie HttpOnly que le JavaScript ne peut pas
// lire : au demarrage, on demande donc au backend si on est connecte.

import './styles.css';
import React, { useState, useEffect } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import SearchForm from './components/SearchForm';
import Auth from './components/Auth';
import Callback from './components/Callback';
import { authConfig } from './authConfig';
import api, { AUTH_EXPIRED_EVENT, purgeLegacyToken } from './api';

function App() {
  // null = verification en cours, true/false = resultat.
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    // Supprime l'ancien token des versions precedentes (voir api.js).
    purgeLegacyToken();

    let ignore = false;
    api
      .get('/auth/session')
      .then((response) => {
        if (!ignore) setIsAuthenticated(response.data?.authenticated === true);
      })
      .catch((error) => {
        console.error('Verification de session impossible:', error);
        if (!ignore) setIsAuthenticated(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Le backend a refuse la session (expiree/revoquee) : on repasse en
  // deconnecte et on previent l'utilisateur au lieu de le laisser devant des erreurs.
  useEffect(() => {
    const handleExpired = () => {
      setIsAuthenticated(false);
      setSessionExpired(true);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, []);

  const handleLogout = async () => {
    try {
      // Detruit la session cote serveur et supprime le cookie.
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Erreur lors de la deconnexion:', error);
    }
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
            isAuthenticated === null ? (
              <p>Chargement...</p>
            ) : isAuthenticated ? (
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
