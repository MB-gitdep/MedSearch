// components/DetailParts.jsx
//
// Briques d'affichage des fiches : sections titrees, listes "libelle : valeur",
// et visionneuse generique des donnees brutes.
//
// Securite : toutes les valeurs sont rendues comme du TEXTE par React (jamais
// dangerouslySetInnerHTML) et aucun lien n'est construit a partir des donnees
// (pas de href issu de l'API) : une valeur malveillante ne peut ni injecter de
// HTML/JS ni creer un lien "javascript:".

import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { labelFor } from './detailLabels';

// Garde-fou : la profondeur est deja bornee cote backend, on la rebornne ici.
const MAX_RENDER_DEPTH = 8;

function isCoordinates(value) {
  const keys = Object.keys(value);
  return keys.length === 2 && typeof value.lat === 'number' && typeof value.lon === 'number';
}

export function ValueView({ value, labels = {}, depth = 0 }) {
  if (depth > MAX_RENDER_DEPTH) return null;

  if (typeof value === 'boolean') return <>{value ? 'Oui' : 'Non'}</>;
  if (typeof value === 'string' || typeof value === 'number') return <>{String(value)}</>;

  if (Array.isArray(value)) {
    if (value.length === 1 && typeof value[0] !== 'object') {
      return <ValueView value={value[0]} labels={labels} depth={depth + 1} />;
    }
    return (
      <ul className="detail-list">
        {value.map((item, index) => (
          <li key={index}>
            <ValueView value={item} labels={labels} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  if (value && typeof value === 'object') {
    if (isCoordinates(value)) return <>{`${value.lat}, ${value.lon}`}</>;
    return <RawList data={value} labels={labels} depth={depth + 1} />;
  }

  return null;
}

// Arbre de donnees brutes : une ligne par cle, libelles francais quand connus.
function RawList({ data, labels, depth }) {
  return (
    <dl className="detail-grid">
      {Object.keys(data).map((key) => (
        <Fragment key={key}>
          <dt>{labelFor(key, labels)}</dt>
          <dd>
            <ValueView value={data[key]} labels={labels} depth={depth} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

// Section titree d'une fiche.
export function Section({ title, children }) {
  return (
    <section className="fiche-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

// Liste "libelle : valeur". Les champs sans valeur ne sont pas affiches.
export function FieldList({ fields, labels }) {
  const shown = fields.filter((field) => field.value !== undefined && field.value !== null && field.value !== '');
  if (shown.length === 0) return <p className="fiche-empty">Information non renseignée.</p>;
  return (
    <dl className="detail-grid">
      {shown.map((field, index) => (
        <Fragment key={`${field.label}-${index}`}>
          <dt>{field.label}</dt>
          <dd>
            <ValueView value={field.value} labels={labels} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

// Donnees brutes completes, repliees par defaut : la fiche reste lisible, et
// "toutes" les informations de l'API restent accessibles en un clic.
export function RawData({ data, labels }) {
  return (
    <details className="fiche-raw">
      <summary>Voir toutes les données brutes (technique)</summary>
      <RawList data={data} labels={labels} depth={0} />
    </details>
  );
}

ValueView.propTypes = {
  value: PropTypes.any,
  labels: PropTypes.object,
  depth: PropTypes.number,
};
RawList.propTypes = {
  data: PropTypes.object.isRequired,
  labels: PropTypes.object.isRequired,
  depth: PropTypes.number.isRequired,
};
Section.propTypes = { title: PropTypes.string.isRequired, children: PropTypes.node };
FieldList.propTypes = {
  fields: PropTypes.arrayOf(PropTypes.shape({ label: PropTypes.string.isRequired, value: PropTypes.any })).isRequired,
  labels: PropTypes.object,
};
RawData.propTypes = { data: PropTypes.object.isRequired, labels: PropTypes.object.isRequired };
