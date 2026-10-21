// components/medecinFormat.js
// Titre d'affichage d'un medecin de l'annuaire OpenDataSoft.
export function medecinTitle(medecin) {
  return [medecin.civilite, medecin.nom].filter(Boolean).join(' ') || 'Médecin (nom non renseigné)';
}
