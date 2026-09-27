import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './styles.css'; // Importez votre fichier CSS
import './index.css'
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router basename="/MedSearch">
      <App />
    </Router>
  </React.StrictMode>
);