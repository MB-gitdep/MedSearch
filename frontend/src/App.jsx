// App.jsx
//
// Composant racine : gere le routage et l'etat global d'authentification
// (simple verification de la presence d'un token dans le localStorage).

import './styles.css';
import React, { useState, useEffect } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import SearchForm from './components/SearchForm';
import Auth from './components/Auth';
import Callback from './components/Callback';
import { authConfig } from './authConfig';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Distingue "on ne sait pas encore" de "non authentifie", pour ne pas
  // afficher un flash de l'ecran de connexion avant que le token ait ete lu.
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    setIsAuthenticated(Boolean(token));
    setIsCheckingAuth(false);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    setIsAuthenticated(false);

    // Redirige vers l'endpoint de deconnexion du serveur SSO WordPress.
    window.location.href = authConfig.logoutEndpoint;
  };

  if (isCheckingAuth) {
    return null;
  }

  return (
    <div className="App">
      <Routes>
        <Route
          path="/"
          element={
            isAuthenticated ? (
              <>
                <SearchForm />
                <button onClick={handleLogout}>Se deconnecter</button>
              </>
            ) : (
              <div>
                <h1>Bienvenue sur MedSearch</h1>
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
