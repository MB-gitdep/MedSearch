// components/detailLabels.js
//
// Libelles francais, ordre d'affichage et champs masques pour la fiche
// detaillee d'un professionnel. Tout est regroupe ici pour pouvoir ajuster un
// libelle sans toucher aux composants.
//
// Les champs "column_N" du jeu de donnees OpenDataSoft n'ont pas de nom
// officiel : les libelles ci-dessous sont deduits de leur contenu et peuvent
// etre corriges ici. Un champ sans libelle connu est affiche sous son nom brut.

export const MEDECIN_LABELS = {
  civilite: 'Civilité',
  nom: 'Nom',
  libelle_profession: 'Profession',
  adresse: 'Adresse',
  commune: 'Commune',
  code_insee: 'Code INSEE',
  dep_code: 'Code département',
  dep_name: 'Département',
  reg_code: 'Code région',
  reg_name: 'Région',
  epci_code: 'Code EPCI',
  epci_name: 'Intercommunalité (EPCI)',
  coordonnees: 'Coordonnées GPS (latitude, longitude)',
  column_13: "Mode d'exercice",
  column_14: 'Conventionnement',
  column_16: 'Équipement',
  type_dacte_realise: "Type d'acte réalisé",
  libelle_acte_clinique: 'Actes cliniques',
  activite_principale: 'Activité principale',
  nom_acte: "Nom de l'acte",
  code: 'Code',
  phase: 'Phase',
  libelle_phase: 'Phase (libellé)',
  libelle_regroupement: 'Regroupement (libellé)',
  regroupement: 'Regroupement',
  accord_prealable: 'Accord préalable',
  code_ccam_activite_phase: 'Code CCAM (activité/phase)',
  libelle_activite: 'Activité (libellé)',
  libelle: 'Libellé',
  tarif_1: 'Tarif 1',
  tarif_2: 'Tarif 2',
  remboursement: 'Remboursement',
  exoneration_tm: 'Exonération du ticket modérateur',
  tarif_base_de_remboursement_securite_sociale: 'Tarif de base de remboursement (Sécurité sociale)',
};

// "concat" n'est qu'une concatenation technique de "nom" et "adresse".
export const MEDECIN_HIDDEN = ['concat'];

export const FHIR_LABELS = {
  practitioner: 'Professionnel',
  roles: "Situations d'exercice",
  organizations: 'Structures',
  placesUnavailable: "Lieux d'exercice indisponibles",
  resourceType: 'Type de ressource',
  id: 'Identifiant',
  identifier: 'Identifiants',
  active: 'Actif',
  name: 'Nom',
  family: 'Nom de famille',
  given: 'Prénoms',
  prefix: 'Civilité / titre',
  suffix: 'Suffixe',
  text: 'Texte',
  use: 'Usage',
  telecom: 'Contacts',
  system: 'Système',
  value: 'Valeur',
  address: 'Adresse',
  line: 'Ligne',
  city: 'Ville',
  postalCode: 'Code postal',
  country: 'Pays',
  gender: 'Genre',
  birthDate: 'Date de naissance',
  qualification: 'Qualifications',
  code: 'Code',
  coding: 'Codage',
  display: 'Libellé',
  period: 'Période',
  start: 'Début',
  end: 'Fin',
  issuer: 'Émetteur',
  type: 'Type',
  communication: 'Langues',
  meta: 'Métadonnées',
  versionId: 'Version',
  lastUpdated: 'Dernière mise à jour',
  profile: 'Profil',
};

// Libelle d'une cle : libelle connu, sinon nom brut mis en forme.
export function labelFor(key, labels) {
  if (labels[key]) return labels[key];
  if (/^column_\d+$/.test(key)) return `Information complémentaire (${key})`;
  const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
