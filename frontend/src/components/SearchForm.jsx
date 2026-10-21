// components/SearchForm.jsx
//
// Recherche de professionnels de sante :
//  - annuaire des medecins (OpenDataSoft) : par departement ;
//  - Annuaire Sante FHIR (esante.gouv.fr) : par nom, prenom, profession,
//    specialite et/ou lieu (ville, code postal, departement, rue). Les criteres
//    renseignes se cumulent (ET).
// Les appels passent par notre backend, qui seul detient les cles d'API et
// verifie la session. Un clic sur un nom ouvre la fiche complete (pop-in).

import React, { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '../api';
import MedecinFiche from './MedecinFiche';
import PractitionerFiche from './PractitionerFiche';
import { medecinTitle } from './medecinFormat';
import { summarizePractitioner } from '../fhirFormat';
import { PROFESSIONS, SPECIALTY_GROUPS } from '../fhirOptions';

// Code departement francais : 2 chiffres, 2A/2B (Corse) ou 3 chiffres (DOM-TOM).
// Verifie aussi cote backend ; ici il evite un aller-retour reseau inutile.
const DEP_CODE_REGEX = /^(2[AB]|[0-9]{2,3})$/i;
const POSTAL_CODE_REGEX = /^[0-9]{2,5}$/;

const EMPTY_FHIR_CRITERIA = {
  family: '', given: '', profession: '', specialty: '',
  city: '', postalCode: '', department: '', street: '',
};

const SearchForm = () => {
  const [searchType, setSearchType] = useState('medecins'); // 'medecins' ou 'practitioners'

  // Medecins (OpenDataSoft)
  const [depCode, setDepCode] = useState('');
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [medecins, setMedecins] = useState([]);

  // Practitioners (FHIR)
  const [fhir, setFhir] = useState(EMPTY_FHIR_CRITERIA);
  const [fhirResult, setFhirResult] = useState(null); // { items, total, truncated }

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  // Professionnel dont la fiche est ouverte : { kind, data | item } ou null.
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

  const searchPractitioners = () => {
    const params = {};
    for (const [key, value] of Object.entries(fhir)) {
      const text = value.trim();
      if (text) params[key] = text;
    }
    if (Object.keys(params).length === 0) {
      setErrorMessage('Renseignez au moins un critère de recherche.');
      return;
    }
    if (params.postalCode && !POSTAL_CODE_REGEX.test(params.postalCode)) {
      setErrorMessage('Code postal invalide (2 à 5 chiffres).');
      return;
    }
    if (params.department && !DEP_CODE_REGEX.test(params.department)) {
      setErrorMessage('Code département invalide (ex : 37, 2A, 971).');
      return;
    }
    runSearch(
      '/fhir/practitioners',
      params,
      (data) => setFhirResult({
        items: Array.isArray(data?.practitioners) ? data.practitioners : [],
        total: Number(data?.total) || 0,
        truncated: Boolean(data?.truncated),
      }),
      () => setFhirResult(null)
    );
  };

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

  const setFhirField = (field) => (event) => setFhir((current) => ({ ...current, [field]: event.target.value }));

  const fhirItems = fhirResult?.items ?? [];

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
          Annuaire Santé (FHIR)
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

        {searchType === 'practitioners' && (
          <div className="fhir-form">
            <p className="fhir-hint">
              Renseignez un ou plusieurs critères : ils se cumulent. La région n'est pas
              disponible (l'annuaire ne permet pas de la filtrer) : utilisez le département.
            </p>

            <fieldset>
              <legend>Qui ?</legend>
              <label htmlFor="f_family">Nom</label>
              <input id="f_family" type="text" maxLength={60} value={fhir.family} onChange={setFhirField('family')} />
              <label htmlFor="f_given">Prénom</label>
              <input id="f_given" type="text" maxLength={60} value={fhir.given} onChange={setFhirField('given')} />
              <label htmlFor="f_profession">Profession</label>
              <select id="f_profession" value={fhir.profession} onChange={setFhirField('profession')}>
                <option value="">Toutes</option>
                {PROFESSIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
              <label htmlFor="f_specialty">Spécialité</label>
              <select id="f_specialty" value={fhir.specialty} onChange={setFhirField('specialty')}>
                <option value="">Toutes</option>
                {SPECIALTY_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </optgroup>
                ))}
              </select>
            </fieldset>

            <fieldset>
              <legend>Où ?</legend>
              <label htmlFor="f_city">Ville</label>
              <input id="f_city" type="text" maxLength={80} value={fhir.city} onChange={setFhirField('city')} />
              <label htmlFor="f_postal">Code postal</label>
              <input id="f_postal" type="text" inputMode="numeric" maxLength={5} value={fhir.postalCode} onChange={setFhirField('postalCode')} />
              <label htmlFor="f_department">Département</label>
              <input id="f_department" type="text" maxLength={3} placeholder="ex : 41, 2A, 971" value={fhir.department} onChange={setFhirField('department')} />
              <label htmlFor="f_street">Rue / adresse</label>
              <input id="f_street" type="text" maxLength={100} value={fhir.street} onChange={setFhirField('street')} />
            </fieldset>
          </div>
        )}

        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Recherche en cours...' : 'Rechercher'}
        </button>
        {searchType === 'practitioners' && (
          <button
            type="button"
            className="secondary-button"
            disabled={isLoading}
            onClick={() => { setFhir(EMPTY_FHIR_CRITERIA); setErrorMessage(null); }}
          >
            Effacer les critères
          </button>
        )}
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

      {/* Resultats : Annuaire Sante FHIR */}
      {searchType === 'practitioners' && !isLoading && hasSearched && fhirItems.length === 0 && !errorMessage && (
        <p>Aucun professionnel ne correspond à ces critères.</p>
      )}
      {searchType === 'practitioners' && fhirItems.length > 0 && (
        <div>
          <h2>Résultats (Annuaire Santé)</h2>
          <p>
            {fhirResult.total > fhirItems.length
              ? `${fhirResult.total} professionnels trouvés, les ${fhirItems.length} premiers sont affichés.`
              : `${fhirItems.length} professionnel${fhirItems.length > 1 ? 's' : ''} trouvé${fhirItems.length > 1 ? 's' : ''}.`}
            {' '}Cliquez sur un nom pour afficher la fiche complète.
          </p>
          {fhirResult.truncated && (
            <p className="fhir-hint">
              Il y a beaucoup de correspondances : la liste peut être incomplète.
              Ajoutez des critères (nom, profession, ville…) pour affiner.
            </p>
          )}
          {fhirItems.map((item, index) => {
            const summary = summarizePractitioner(item.resource);
            const description = [summary.profession, ...summary.specialties].filter(Boolean).join(' · ');
            return (
              <div key={`${item.resource.id ?? 'p'}-${index}`} className="result-card">
                <p>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setSelected({ kind: 'practitioner', item })}
                  >
                    {summary.title}
                  </button>
                  {description && <><br />{description}</>}
                  {item.lieux?.slice(0, 2).map((lieu, i) => (
                    <React.Fragment key={i}><br />{[lieu.nom, lieu.adresse].filter(Boolean).join(' — ')}</React.Fragment>
                  ))}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Fiche detaillee (pop-in modale native) */}
      {selected?.kind === 'medecin' && (
        <MedecinFiche data={selected.data} onClose={() => setSelected(null)} />
      )}
      {selected?.kind === 'practitioner' && (
        <PractitionerFiche
          key={selected.item.resource.id}
          item={selected.item}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};

export default SearchForm;
