// components/PractitionerFiche.jsx
//
// Fiche lisible d'un professionnel de l'Annuaire Sante (FHIR). La liste de
// resultats contient deja son identite ; a l'ouverture, on charge en plus ses
// lieux d'exercice (structures) via le backend. Si ce chargement echoue, la
// fiche reste affichee sans les lieux.

import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import api from '../api';
import ProfessionalDialog from './ProfessionalDialog';
import { FieldList, RawData, Section } from './DetailParts';
import { FHIR_LABELS } from './detailLabels';
import { buildPractitionerView } from '../fhirFormat';

function Place({ place }) {
  const lines = [
    place.types.length > 0 && place.types.join(', '),
    place.address,
    place.phones.length > 0 && `Téléphone : ${place.phones.join(', ')}`,
    place.faxes.length > 0 && `Fax : ${place.faxes.join(', ')}`,
    place.emails.length > 0 && `Courriel : ${place.emails.join(', ')}`,
    place.modes.length > 0 && `Mode d'exercice : ${place.modes.join(', ')}`,
  ].filter(Boolean);

  return (
    <div className="fiche-lieu">
      <strong>{place.name}</strong>
      {lines.map((line, index) => <span key={index}>{line}</span>)}
    </div>
  );
}

Place.propTypes = { place: PropTypes.object.isRequired };

const PractitionerFiche = ({ item, onClose }) => {
  const practitionerId = item.resource?.id;
  const [detail, setDetail] = useState({ status: practitionerId ? 'loading' : 'error' });

  useEffect(() => {
    if (!practitionerId) return undefined;
    const controller = new AbortController();
    api
      .get(`/fhir/practitioners/${encodeURIComponent(practitionerId)}`, { signal: controller.signal })
      .then((response) => setDetail({ status: 'ready', data: response.data }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error('Erreur chargement de la fiche:', error);
        setDetail({ status: 'error' });
      });
    return () => controller.abort();
  }, [practitionerId]);

  const data = detail.status === 'ready' ? detail.data : null;
  const view = useMemo(
    () => buildPractitionerView({
      practitioner: data?.practitioner ?? item.resource,
      roles: data?.roles,
      organizations: data?.organizations,
    }),
    [data, item.resource]
  );

  const professionFields = [
    { label: 'Profession', value: view.professions.join(', ') },
    { label: view.specialties.length > 1 ? 'Spécialités' : 'Spécialité', value: view.specialties.length > 1 ? view.specialties : view.specialties[0] },
    { label: 'Catégorie professionnelle', value: view.categories.join(', ') },
  ];

  const cardFields = view.card && [
    { label: 'Type de carte', value: view.card.type },
    { label: 'Numéro de carte', value: view.card.number },
    { label: 'Valable du', value: view.card.start },
    { label: "jusqu'au", value: view.card.end },
  ];

  const updateFields = [
    { label: 'Dernière mise à jour', value: view.updatedAt },
    { label: 'Source', value: view.source },
  ];

  const rawData = data
    ? { practitioner: data.practitioner, roles: data.roles, organizations: data.organizations }
    : { practitioner: item.resource };

  return (
    <ProfessionalDialog title={view.title} subtitle={view.subtitle} onClose={onClose}>
      <Section title="Profession et spécialités">
        <FieldList fields={professionFields} />
      </Section>

      <Section title="Lieux d'exercice">
        {detail.status === 'loading' && <p className="fiche-empty">Chargement des lieux d'exercice…</p>}
        {detail.status === 'error' && (
          <>
            <p className="fiche-empty">Les lieux d'exercice n'ont pas pu être chargés.</p>
            {item.lieux?.map((lieu, index) => (
              <div className="fiche-lieu" key={index}>
                <strong>{lieu.nom}</strong>
                {lieu.adresse && <span>{lieu.adresse}</span>}
              </div>
            ))}
          </>
        )}
        {detail.status === 'ready' && data.placesUnavailable && (
          <p className="fiche-empty">Les lieux d'exercice sont momentanément indisponibles.</p>
        )}
        {detail.status === 'ready' && !data.placesUnavailable && view.places.length === 0 && (
          <p className="fiche-empty">Aucun lieu d'exercice public n'est renseigné pour ce professionnel.</p>
        )}
        {view.places.map((place) => <Place key={place.id} place={place} />)}
      </Section>

      <Section title="Identité">
        <FieldList fields={view.identity} />
      </Section>

      {view.identifiers.length > 0 && (
        <Section title="Identifiants">
          <FieldList fields={view.identifiers} />
        </Section>
      )}

      {view.diplomas.length > 0 && (
        <Section title="Diplômes">
          <ul className="detail-list">
            {view.diplomas.map((diploma) => <li key={diploma}>{diploma}</li>)}
          </ul>
        </Section>
      )}

      {cardFields && (
        <Section title="Carte professionnelle (CPS)">
          <FieldList fields={cardFields} />
        </Section>
      )}

      <Section title="Informations de l'annuaire">
        <FieldList fields={updateFields} />
      </Section>

      <RawData data={rawData} labels={FHIR_LABELS} />
    </ProfessionalDialog>
  );
};

PractitionerFiche.propTypes = {
  item: PropTypes.shape({
    resource: PropTypes.object.isRequired,
    lieux: PropTypes.array,
  }).isRequired,
  onClose: PropTypes.func.isRequired,
};

export default PractitionerFiche;
