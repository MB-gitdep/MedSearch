// components/SearchForm.jsx
//
// Recherche de professionnels de sante : annuaire des medecins (OpenDataSoft)
// ou registre FHIR des Practitioners (esante.gouv.fr). Les appels passent par
// notre backend, qui seul detient les cles d'API et verifie la session.
// Un clic sur le nom d'un professionnel ouvre sa fiche complete (pop-in).

import React, { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '../api';
import ProfessionalDialog from './ProfessionalDialog';
import {
  FHIR_HIDDEN, FHIR_LABELS, FHIR_ORDER,
  MEDECIN_HIDDEN, MEDECIN_LABELS, MEDECIN_ORDER,
} from './detailLabels';

// Code departement francais : 2 chiffres, 2A/2B (Corse) ou 3 chiffres (DOM-TOM).
// Verifie aussi cote backend ; ici il evite un aller-retour reseau inutile.
const DEP_CODE_REGEX = /^(2[AB]|[0-9]{2,3})$/i;

const first = (value) => (Array.isArray(value) ? value[0] : value);

function medecinTitle(medecin) {
  return [medecin.civilite, medecin.nom].filter(Boolean).join(' ') || 'Médecin (nom non renseigné)';
}

function practitionerTitle(practitioner) {
  const name = first(practitioner?.name);
  const given = Array.isArray(name?.given) ? name.given.join(' ') : name?.given;
  return [name?.family, given].filter(Boolean).join(' ') || 'Praticien (nom non renseigné)';
}

const SearchForm = () => {
  const [searchType, setSearchType] = useState('medecins'); // 'medecins' ou 'practitioners'
  const [depCode, setDepCode] = useState('');
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [medecins, setMedecins] = useState([]);
  const [practitioners, setPractitioners] = useState([]);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  // Professionnel dont la fiche est ouverte : { kind, data } ou null.
  const [selected, setSelected] = useState(null);

  // Permet d'annuler une recherche en cours si on en lance une autre (ou si
  // on quitte la page) : evite qu'une reponse tardive ecrase la plus recente.
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const runSearch = async (path, params, onSuccess, onFailure) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setErrorMessage(null);
    setSelected(null);
    try {
      const response = await api.get(path, { params, signal: controller.signal });
      onSuccess(response.data);
    } catch (error) {
      const message = getErrorMessage(error, 'La recherche a échoué. Merci de réessayer.');
      if (message === null) return; // requete annulee volontairement
      console.error('Erreur de recherche:', error);
      setErrorMessage(message);
      onFailure();
    } finally {
      if (abortRef.current === controller) {
        setIsLoading(false);
        setHasSearched(true);
      }
    }
  };

  const searchMedecins = () => {
    const code = depCode.trim().toUpperCase();
    if (!DEP_CODE_REGEX.test(code)) {
      setErrorMessage('Code département invalide (ex : 37, 2A, 971).');
      return;
    }
    runSearch(
      '/medecins',
      {
        dep_code: code,
        limit: Math.min(Math.max(Number(limit) || 1, 1), 100),
        offset: Math.max(Number(offset) || 0, 0),
      },
      (data) => setMedecins(Array.isArray(data?.medecins) ? data.medecins : []),
      () => setMedecins([])
    );
  };

  const searchPractitioners = () =>
    runSearch(
      '/fhir/practitioners',
      {},
      (data) => setPractitioners(Array.isArray(data?.practitioners) ? data.practitioners : []),
      () => setPractitioners([])
    );

  const handleSubmit = (event) => {
    event.preventDefault();
    if (searchType === 'medecins') searchMedecins();
    else searchPractitioners();
  };

  const handleTypeChange = (type) => {
    setSearchType(type);
    setErrorMessage(null);
    setSelected(null);
    setHasSearched(false);
  };

  return (
    <div>
      <h1>Recherche de Professionnels de Santé</h1>
      <div>
        <label>
          <input
            type="radio"
            value="medecins"
            checked={searchType === 'medecins'}
            onChange={() => handleTypeChange('medecins')}
          />
          Médecins (OpenDataSoft)
        </label>
        <label>
          <input
            type="radio"
            value="practitioners"
            checked={searchType === 'practitioners'}
            onChange={() => handleTypeChange('practitioners')}
          />
          Practitioners (FHIR)
        </label>
      </div>
      <br />

      <form onSubmit={handleSubmit}>
        {searchType === 'medecins' && (
          <>
            <label htmlFor="dep_code">Code département :</label>
            <input
              type="text"
              id="dep_code"
              value={depCode}
              maxLength={3}
              onChange={(e) => setDepCode(e.target.value)}
              required
            /><br /><br />
            <label htmlFor="limit">Limite (1-100) :</label>
            <input
              type="number"
              id="limit"
              min="1"
              max="100"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            /><br /><br />
            <label htmlFor="offset">Offset :</label>
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

      {errorMessage && <p role="alert" className="form-error">{errorMessage}</p>}

      {/* Resultats : medecins */}
      {searchType === 'medecins' && !isLoading && hasSearched && medecins.length === 0 && !errorMessage && (
        <p>Aucun médecin trouvé pour ce département.</p>
      )}
      {searchType === 'medecins' && medecins.length > 0 && (
        <div>
          <h2>Résultats (Médecins)</h2>
          <p>Cliquez sur un nom pour afficher la fiche complète.</p>
          {medecins.map((medecin, index) => (
            <div key={`${index}-${medecin.nom ?? ''}`} className="result-card">
              <p>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setSelected({ kind: 'medecin', data: medecin })}
                >
                  {medecinTitle(medecin)}
                </button><br />
                {medecin.libelle_profession}<br />
                {medecin.adresse}<br />
                {medecin.commune}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Resultats : practitioners FHIR */}
      {searchType === 'practitioners' && !isLoading && hasSearched && practitioners.length === 0 && !errorMessage && (
        <p>Aucun Practitioner trouvé.</p>
      )}
      {searchType === 'practitioners' && practitioners.length > 0 && (
        <div>
          <h2>Résultats (Practitioners FHIR)</h2>
          <p>Cliquez sur un nom pour afficher la fiche complète.</p>
          {practitioners.map((practitioner, index) => (
            <div key={`${practitioner.id ?? 'p'}-${index}`} className="result-card">
              <p>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setSelected({ kind: 'practitioner', data: practitioner })}
                >
                  {practitionerTitle(practitioner)}
                </button><br />
                {first(practitioner.qualification)?.code?.text}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Fiche detaillee (pop-in modale native) */}
      {selected?.kind === 'medecin' && (
        <ProfessionalDialog
          title={medecinTitle(selected.data)}
          data={selected.data}
          labels={MEDECIN_LABELS}
          order={MEDECIN_ORDER}
          hidden={MEDECIN_HIDDEN}
          onClose={() => setSelected(null)}
        />
      )}
      {selected?.kind === 'practitioner' && (
        <ProfessionalDialog
          title={practitionerTitle(selected.data)}
          data={selected.data}
          labels={FHIR_LABELS}
          order={FHIR_ORDER}
          hidden={FHIR_HIDDEN}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};

export default SearchForm;
