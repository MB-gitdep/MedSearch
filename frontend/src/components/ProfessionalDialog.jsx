// components/ProfessionalDialog.jsx
//
// Fiche detaillee d'un professionnel de sante, affichee dans une pop-in
// MODALE basee sur l'element HTML natif <dialog> (showModal()).
//
// Pourquoi ce choix, le plus sur des options :
//  - pas de bibliotheque tierce (aucune dependance de plus = pas de risque de
//    chaine d'approvisionnement) ;
//  - le navigateur gere nativement le piege du focus clavier, la touche Echap
//    et l'inertie du reste de la page (accessibilite et robustesse que les
//    modales faites maison ratent souvent) ;
//  - ce n'est PAS un window.open() : pas de blocage par les anti-popups, pas de
//    fenetre tierce, pas de risque de "tabnabbing" (window.opener) ;
//  - toutes les donnees sont rendues comme du TEXTE par React (jamais
//    dangerouslySetInnerHTML) et aucun lien n'est construit a partir des
//    donnees : une valeur malveillante ne peut ni injecter de HTML/JS ni
//    creer un lien "javascript:".

import React, { Fragment, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { labelFor } from './detailLabels';

// Garde-fou : la profondeur est deja bornee cote backend, on la rebornne ici.
const MAX_RENDER_DEPTH = 6;

// Les cles viennent de l'API : on les compare a une liste d'ordre, mais on ne
// s'en sert jamais comme code ou comme HTML.
function sortKeys(keys, order) {
  const rank = (key) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b));
}

function isCoordinates(value) {
  const keys = Object.keys(value);
  return keys.length === 2 && typeof value.lat === 'number' && typeof value.lon === 'number';
}

function ValueView({ value, labels, depth }) {
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
    return <DetailsList data={value} labels={labels} order={[]} hidden={[]} depth={depth + 1} />;
  }

  return null;
}

function DetailsList({ data, labels, order, hidden, depth = 0 }) {
  const keys = sortKeys(Object.keys(data).filter((key) => !hidden.includes(key)), order);
  return (
    <dl className="detail-grid">
      {keys.map((key) => (
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

const ProfessionalDialog = ({ title, data, labels, order, hidden, onClose }) => {
  const dialogRef = useRef(null);

  // Ouverture en mode modal (le test .open evite une erreur si React rejoue
  // l'effet en developpement).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const requestClose = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      className="pro-dialog"
      aria-labelledby="pro-dialog-title"
      // Declenche aussi bien par la touche Echap que par close() : le parent
      // retire alors la fiche de l'ecran.
      onClose={onClose}
      // Un clic sur le fond (le <dialog> lui-meme, pas son contenu) ferme la fiche.
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      <div className="pro-dialog__panel">
        <div className="pro-dialog__header">
          <h2 id="pro-dialog-title">{title}</h2>
          <button type="button" className="pro-dialog__close" onClick={requestClose} aria-label="Fermer la fiche">
            ×
          </button>
        </div>
        <div className="pro-dialog__body">
          <DetailsList data={data} labels={labels} order={order} hidden={hidden} />
        </div>
      </div>
    </dialog>
  );
};

ValueView.propTypes = {
  value: PropTypes.any,
  labels: PropTypes.object.isRequired,
  depth: PropTypes.number.isRequired,
};

DetailsList.propTypes = {
  data: PropTypes.object.isRequired,
  labels: PropTypes.object.isRequired,
  order: PropTypes.arrayOf(PropTypes.string).isRequired,
  hidden: PropTypes.arrayOf(PropTypes.string).isRequired,
  depth: PropTypes.number,
};

ProfessionalDialog.propTypes = {
  title: PropTypes.string.isRequired,
  data: PropTypes.object.isRequired,
  labels: PropTypes.object.isRequired,
  order: PropTypes.arrayOf(PropTypes.string).isRequired,
  hidden: PropTypes.arrayOf(PropTypes.string).isRequired,
  onClose: PropTypes.func.isRequired,
};

export default ProfessionalDialog;
