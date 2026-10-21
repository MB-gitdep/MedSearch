// components/ProfessionalDialog.jsx
//
// Coque de la fiche d'un professionnel de sante : pop-in MODALE basee sur
// l'element HTML natif <dialog> (showModal()).
//
// Pourquoi ce choix, le plus sur des options :
//  - pas de bibliotheque tierce (aucune dependance de plus = pas de risque de
//    chaine d'approvisionnement) ;
//  - le navigateur gere nativement le piege du focus clavier, la touche Echap
//    et l'inertie du reste de la page (accessibilite et robustesse que les
//    modales faites maison ratent souvent) ;
//  - ce n'est PAS un window.open() : pas de blocage par les anti-popups, pas de
//    fenetre tierce, pas de risque de "tabnabbing" (window.opener).
// Le contenu (children) est fourni par MedecinFiche / PractitionerFiche.

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const ProfessionalDialog = ({ title, subtitle, onClose, children }) => {
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
          <div>
            <h2 id="pro-dialog-title">{title}</h2>
            {subtitle && <p className="fiche-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="pro-dialog__close" onClick={requestClose} aria-label="Fermer la fiche">
            ×
          </button>
        </div>
        <div className="pro-dialog__body">{children}</div>
        <div className="pro-dialog__footer">
          <button type="button" onClick={requestClose}>Fermer</button>
        </div>
      </div>
    </dialog>
  );
};

ProfessionalDialog.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  children: PropTypes.node,
};

export default ProfessionalDialog;
