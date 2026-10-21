// components/MedecinFiche.jsx
//
// Fiche d'un medecin de l'annuaire OpenDataSoft : les champs renseignes sont
// regroupes par theme (identite, activite, localisation) ; tout champ non prevu
// est affiche dans "Autres informations", donc rien n'est perdu.

import React from 'react';
import PropTypes from 'prop-types';
import ProfessionalDialog from './ProfessionalDialog';
import { FieldList, Section } from './DetailParts';
import { MEDECIN_HIDDEN, MEDECIN_LABELS, labelFor } from './detailLabels';
import { medecinTitle } from './medecinFormat';

const SECTIONS = [
  ['Identité', ['civilite', 'nom']],
  ['Activité', ['libelle_profession', 'column_13', 'column_14', 'column_16', 'type_dacte_realise', 'libelle_acte_clinique', 'activite_principale']],
  ['Localisation', ['adresse', 'commune', 'code_insee', 'dep_name', 'dep_code', 'reg_name', 'reg_code', 'epci_name', 'epci_code', 'coordonnees']],
];

const MedecinFiche = ({ data, onClose }) => {
  const toFields = (keys) => keys
    .filter((key) => data[key] !== undefined)
    .map((key) => ({ label: labelFor(key, MEDECIN_LABELS), value: data[key] }));

  const placed = new Set(SECTIONS.flatMap(([, keys]) => keys));
  const others = Object.keys(data).filter((key) => !placed.has(key) && !MEDECIN_HIDDEN.includes(key));

  return (
    <ProfessionalDialog title={medecinTitle(data)} subtitle={data.libelle_profession} onClose={onClose}>
      {SECTIONS.map(([title, keys]) => {
        const fields = toFields(keys);
        return fields.length > 0 && (
          <Section key={title} title={title}>
            <FieldList fields={fields} />
          </Section>
        );
      })}
      {others.length > 0 && (
        <Section title="Autres informations">
          <FieldList fields={toFields(others)} />
        </Section>
      )}
    </ProfessionalDialog>
  );
};

MedecinFiche.propTypes = {
  data: PropTypes.object.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default MedecinFiche;
