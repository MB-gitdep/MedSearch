import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router } from 'react-router-dom';
import './styles.css';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// Desactive le menu contextuel (clic droit), comportement d'origine du site.
// Ce code vivait dans un <script> inline de index.html ; il est ici pour
// pouvoir interdire les scripts inline dans la politique CSP (voir README).
document.addEventListener('contextmenu', (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Router basename="/MedSearch">
        <App />
      </Router>
    </ErrorBoundary>
  </React.StrictMode>
);
