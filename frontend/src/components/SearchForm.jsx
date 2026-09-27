// components/SearchForm.jsx
//
// Formulaire de recherche de professionnels de sante : soit dans l'annuaire
// des medecins (OpenDataSoft), soit dans le registre FHIR des Practitioners
// (esante.gouv.fr). Les deux appels passent par notre backend, qui seul
// detient les cles d'API necessaires.

import React, { useState } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/MedSearch/api';

// Un code departement francais valide : 2 chiffres, 2A/2B (Corse) ou 3
// chiffres pour les DOM-TOM. Verifie aussi cote backend, mais valider ici
// evite un aller-retour reseau inutile et guide l'utilisateur plus vite.
const DEP_CODE_REGEX = /^(2[AB]|[0-9]{2,3})$/i;

const SearchForm = () => {
  // Etats pour la recherche de medecins (OpenDataSoft)
  const [depCode, setDepCode] = useState('');
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [medecins, setMedecins] = useState([]);
  // Etats pour la recherche de Practitioners (FHIR)
  const [practitioners, setPractitioners] = useState([]);
  const [searchType, setSearchType] = useState('medecins'); // 'medecins' ou 'practitioners'

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Recherche de medecins (OpenDataSoft)
  const searchMedecins = async () => {
    if (!DEP_CODE_REGEX.test(depCode.trim())) {
      setErrorMessage('Code departement invalide (ex : 37, 2A, 971).');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await axios.get(`${API_BASE_URL}/medecins`, {
        params: {
          dep_code: depCode.trim(),
          limit: Math.min(Math.max(Number(limit) || 1, 1), 100),
          offset: Math.max(Number(offset) || 0, 0),
        },
      });
      setMedecins(response.data);
    } catch (error) {
      console.error('Error:', error);
      setErrorMessage(
        error.response?.data?.error || 'La recherche a echoue. Merci de reessayer.'
      );
      setMedecins([]);
    } finally {
      setIsLoading(false);
      setHasSearched(true);
    }
  };

  // Recherche de Practitioners (FHIR)
  const searchPractitioners = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await axios.get(`${API_BASE_URL}/fhir/practitioners`);
      setPractitioners(response.data.entry || []);
    } catch (error) {
      console.error('Error FHIR:', error);
      setErrorMessage(
        error.response?.data?.error || 'La recherche a echoue. Merci de reessayer.'
      );
      setPractitioners([]);
    } finally {
      setIsLoading(false);
      setHasSearched(true);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (searchType === 'medecins') {
      searchMedecins();
    } else {
      searchPractitioners();
    }
  };

  return (
    <div>
      <h1>Recherche de Professionnels de Sante</h1>
      <div>
        <label>
          <input
            type="radio"
            value="medecins"
            checked={searchType === 'medecins'}
            onChange={() => setSearchType('medecins')}
          />
          Medecins (OpenDataSoft)
        </label>
        <label>
          <input
            type="radio"
            value="practitioners"
            checked={searchType === 'practitioners'}
            onChange={() => setSearchType('practitioners')}
          />
          Practitioners (FHIR)
        </label>
      </div>
      <br />

      <form onSubmit={handleSubmit}>
        {searchType === 'medecins' && (
          <>
            <label htmlFor="dep_code">Code Departement:</label>
            <input
              type="text"
              id="dep_code"
              value={depCode}
              onChange={(e) => setDepCode(e.target.value)}
              required
            /><br /><br />
            <label htmlFor="limit">Limite (1-100):</label>
            <input
              type="number"
              id="limit"
              min="1"
              max="100"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            /><br /><br />
            <label htmlFor="offset">Offset:</label>
            <input
              type="number"
              id="offset"
              min="0"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            /><br /><br />
          </>
        )}
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Recherche en cours...' : 'Rechercher'}
        </button>
      </form>

      {errorMessage && (
        <p role="alert" style={{ color: 'red' }}>{errorMessage}</p>
      )}

      {/* Affichage des resultats */}
      {searchType === 'medecins' && !isLoading && hasSearched && medecins.length === 0 && !errorMessage && (
        <p>Aucun medecin trouve pour ce departement.</p>
      )}
      {searchType === 'medecins' && medecins.length > 0 && (
        <div>
          <h2>Resultats (Medecins)</h2>
          {medecins.map((medecin, index) => (
            <div
              key={`${medecin.nom}-${medecin.adresse ?? index}`}
              style={{ marginBottom: '10px', padding: '10px', border: '1px solid #ccc' }}
            >
              <p>
                <strong>{medecin.nom}</strong><br />
                {medecin.profession}<br />
                {medecin.adresse}<br />
                {medecin.commune}
              </p>
            </div>
          ))}
        </div>
      )}

      {searchType === 'practitioners' && !isLoading && hasSearched && practitioners.length === 0 && !errorMessage && (
        <p>Aucun Practitioner trouve.</p>
      )}
      {searchType === 'practitioners' && practitioners.length > 0 && (
        <div>
          <h2>Resultats (Practitioners FHIR)</h2>
          {practitioners.map((entry) => {
            const practitioner = entry.resource;
            return (
              <div
                key={practitioner?.id ?? entry.fullUrl}
                style={{ marginBottom: '10px', padding: '10px', border: '1px solid #ccc' }}
              >
                <p>
                  <strong>
                    {practitioner?.name?.[0]?.family} {practitioner?.name?.[0]?.given?.join(' ')}
                  </strong><br />
                  {practitioner?.qualification?.[0]?.code?.text}<br />
                  {practitioner?.telecom?.[0]?.value}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SearchForm;
