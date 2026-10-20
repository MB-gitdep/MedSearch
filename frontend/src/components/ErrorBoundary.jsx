// components/ErrorBoundary.jsx
//
// Filet de securite React : si un composant plante a l'affichage (donnee
// inattendue, bug...), on affiche un message clair au lieu d'une page blanche.
// Le detail technique n'est ecrit que dans la console, jamais affiche.

import React from 'react';
import PropTypes from 'prop-types';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Erreur d'affichage:", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert">
          <h1>Une erreur inattendue est survenue</h1>
          <p>Merci de recharger la page. Si le problème persiste, contactez l'administrateur.</p>
          <button onClick={() => window.location.reload()}>Recharger la page</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node,
};

export default ErrorBoundary;
