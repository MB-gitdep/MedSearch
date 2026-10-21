// fhirSearch.js
//
// Recherche de professionnels de sante dans l'API FHIR "Annuaire Sante"
// (esante.gouv.fr, donnees publiques).
//
// Contraintes de l'API (CapabilityStatement officiel AsServerDPCapabilityStatement) :
//  - Practitioner : recherche par nom (family), prenom (given) et qualification
//    (qualification-code : profession, specialite). AUCUNE adresse.
//  - Organization (structures) : recherche par address-city, address-postalcode,
//    address-line. Pas de region ni de departement.
//  - PractitionerRole : relie un Practitioner a une Organization.
// Chercher par lieu oblige donc a passer par les structures. Le departement est
// obtenu par prefixe de code postal ; la region n'est pas filtrable.
//
// Deux strategies selon les criteres (chacune limitee en volume) :
//  - "personne d'abord" (nom/prenom/profession/specialite fournis) : on cherche
//    les professionnels, puis on ne garde ceux travaillant dans une structure
//    du lieu demande. Complet tant que les criteres d'identite sont selectifs.
//  - "lieu d'abord" (uniquement un lieu) : structures du lieu -> leurs
//    professionnels. Peut etre tronque pour un grand etablissement : le
//    resultat l'indique (truncated) pour inviter a affiner.
//
// Le module ne fait aucun appel reseau lui-meme : il recoit une fonction
// fhirGet(chemin, parametres), ce qui permet de le tester avec un faux serveur.

'use strict';

const { sanitizeDeep } = require('./sanitize');

const SYSTEM_PROFESSION = 'https://mos.esante.gouv.fr/NOS/TRE_G15-ProfessionSante/FHIR/TRE-G15-ProfessionSante';
const SYSTEM_SPECIALTY = 'https://mos.esante.gouv.fr/NOS/TRE_R38-SpecialiteOrdinale/FHIR/TRE-R38-SpecialiteOrdinale';

// Limites de volume (protegent l'API nationale, notre cle et nos delais).
const PERSON_FETCH_LIMIT = 100;
const ORG_FETCH_LIMIT = 100;
const ROLE_FETCH_LIMIT = 200;
const ID_CHUNK_SIZE = 40;
const MAX_PARALLEL_REQUESTS = 4;

// Formats acceptes pour chaque critere (lettres Unicode : accents, apostrophes...).
// Ils n'autorisent aucun caractere special FHIR (| , $ ...) : impossible de
// detourner un critere pour modifier la requete envoyee a l'API.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,59}$/u;
const CITY_RE = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9' .-]{0,79}$/u;
const STREET_RE = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9' .-]{0,99}$/u;
const POSTAL_RE = /^[0-9]{2,5}$/;
const DEPARTMENT_RE = /^(2[AB]|[0-9]{2,3})$/i;
const PROFESSION_RE = /^[0-9]{2}$/;
const SPECIALTY_RE = /^[A-Z]{2,3}[0-9]{2}$/;
const ID_RE = /^[A-Za-z0-9.-]{1,64}$/;

// ---------------------------------------------------------------------------
// Validation des criteres
// ---------------------------------------------------------------------------

const FIELD_RULES = [
  { key: 'family', label: 'Nom', regex: NAME_RE },
  { key: 'given', label: 'Prénom', regex: NAME_RE },
  { key: 'profession', label: 'Profession', regex: PROFESSION_RE },
  { key: 'specialty', label: 'Spécialité', regex: SPECIALTY_RE },
  { key: 'city', label: 'Ville', regex: CITY_RE },
  { key: 'postalCode', label: 'Code postal', regex: POSTAL_RE },
  { key: 'department', label: 'Département', regex: DEPARTMENT_RE },
  { key: 'street', label: 'Rue', regex: STREET_RE },
];

function buildCriteria(query) {
  const criteria = {};

  for (const { key, label, regex } of FIELD_RULES) {
    const raw = query[key];
    if (raw === undefined || raw === '') continue;
    if (typeof raw !== 'string') return { ok: false, error: `Le critère « ${label} » est invalide.` };
    const value = raw.trim();
    if (value === '') continue;
    if (!regex.test(value)) return { ok: false, error: `Le critère « ${label} » est invalide.` };
    criteria[key] = key === 'department' || key === 'specialty' ? value.toUpperCase() : value;
  }

  // Un code postal precis rend le departement redondant.
  if (criteria.postalCode) delete criteria.department;

  if (Object.keys(criteria).length === 0) {
    return { ok: false, error: 'Renseignez au moins un critère de recherche.' };
  }

  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
  return { ok: true, criteria: { ...criteria, limit } };
}

// Corse : les codes postaux 200xx-201xx sont en 2A, 202xx-206xx en 2B.
function departmentPrefixes(department) {
  const dep = department.toUpperCase();
  if (dep === '2A') return ['200', '201'];
  if (dep === '2B') return ['202', '203', '204', '205', '206'];
  return [dep];
}

// ---------------------------------------------------------------------------
// Utilitaires sur les Bundles FHIR
// ---------------------------------------------------------------------------

const isInclude = (entry) => entry?.search?.mode === 'include';

// Ressources demandees par la recherche (hors ressources "incluses").
const matchesOf = (bundle, type) =>
  (bundle?.entry || []).filter((e) => !isInclude(e)).map((e) => e.resource).filter((r) => r?.resourceType === type);

// Toutes les ressources du type, qu'elles soient demandees ou incluses.
const entriesOf = (bundle, type) =>
  (bundle?.entry || []).map((e) => e.resource).filter((r) => r?.resourceType === type);

// "Practitioner/123" ou URL complete -> "123"
function idFromReference(reference) {
  const match = /(?:^|\/)([A-Za-z0-9.-]{1,64})$/.exec(String(reference?.reference ?? ''));
  return match ? match[1] : null;
}

function isTruncated(bundle, fetchedCount) {
  const hasNext = (bundle?.link || []).some((link) => link.relation === 'next');
  const total = Number(bundle?.total);
  return hasNext || (Number.isFinite(total) && total > fetchedCount);
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Execute fn sur chaque element, avec au plus "limit" appels simultanes.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function formatAddress(address) {
  if (!address) return null;
  const lines = Array.isArray(address.line) ? address.line : [];
  const town = [address.postalCode, address.city].filter(Boolean).join(' ');
  const text = [...lines, town].filter(Boolean).join(', ');
  return text || address.text || null;
}

const hasPlace = (c) => Boolean(c.city || c.postalCode || c.department || c.street);
const hasPerson = (c) => Boolean(c.family || c.given || c.profession || c.specialty);

function personParams(c) {
  const params = new URLSearchParams();
  if (c.family) params.append('family', c.family);
  if (c.given) params.append('given', c.given);
  // Deux parametres qualification-code identiques = les deux conditions (ET).
  if (c.profession) params.append('qualification-code', `${SYSTEM_PROFESSION}|${c.profession}`);
  if (c.specialty) params.append('qualification-code', `${SYSTEM_SPECIALTY}|${c.specialty}`);
  return params;
}

function placeParams(c, postalPrefix) {
  const params = new URLSearchParams();
  if (c.city) params.append('address-city', c.city);
  if (postalPrefix) params.append('address-postalcode', postalPrefix);
  if (c.street) params.append('address-line', c.street);
  return params;
}

function postalPrefixes(c) {
  if (c.postalCode) return [c.postalCode];
  if (c.department) return departmentPrefixes(c.department);
  return [null];
}

function sortKey(practitioner) {
  const name = Array.isArray(practitioner.name) ? practitioner.name[0] : practitioner.name;
  const given = Array.isArray(name?.given) ? name.given.join(' ') : name?.given;
  return `${name?.family ?? ''} ${given ?? ''}`.toLocaleLowerCase('fr');
}

function finalize(items, limit, truncated, total) {
  const sorted = items.sort((a, b) => sortKey(a.resource).localeCompare(sortKey(b.resource), 'fr'));
  return {
    total: Number.isFinite(total) ? total : sorted.length,
    truncated: Boolean(truncated),
    practitioners: sorted.slice(0, limit).map((item) => ({
      resource: sanitizeDeep(item.resource),
      lieux: item.lieux.map((lieu) => sanitizeDeep(lieu)).filter(Boolean),
    })).filter((item) => item.resource),
  };
}

// ---------------------------------------------------------------------------
// Strategie 1 : personne d'abord (+ filtre par lieu si demande)
// ---------------------------------------------------------------------------
async function searchPersonFirst(c, fhirGet) {
  const params = personParams(c);
  params.append('_count', String(PERSON_FETCH_LIMIT));
  params.append('_total', 'accurate');
  if (hasPlace(c)) params.append('_revinclude', 'PractitionerRole:practitioner');

  const bundle = await fhirGet('Practitioner', params);
  const practitioners = matchesOf(bundle, 'Practitioner');
  const truncated = isTruncated(bundle, practitioners.length);

  if (!hasPlace(c)) {
    return finalize(
      practitioners.map((resource) => ({ resource, lieux: [] })),
      c.limit,
      truncated,
      Number(bundle?.total)
    );
  }

  // Filtre par lieu : on retient les structures de ces professionnels qui
  // correspondent au lieu demande.
  const roles = entriesOf(bundle, 'PractitionerRole');
  const orgIds = [...new Set(roles.map((role) => idFromReference(role.organization)).filter(Boolean))];
  const matchedOrgs = await findMatchingOrganizations(c, orgIds, fhirGet);

  const items = [];
  for (const resource of practitioners) {
    const lieux = new Map();
    for (const role of roles) {
      if (idFromReference(role.practitioner) !== resource.id) continue;
      const org = matchedOrgs.get(idFromReference(role.organization));
      if (org) lieux.set(org.id, { nom: org.name, adresse: formatAddress(org.address?.[0]) });
    }
    if (lieux.size > 0) items.push({ resource, lieux: [...lieux.values()] });
  }
  return finalize(items, c.limit, truncated);
}

// Parmi des structures connues (par id), garde celles qui correspondent au lieu.
async function findMatchingOrganizations(c, orgIds, fhirGet) {
  const matched = new Map();
  const jobs = [];
  for (const ids of chunk(orgIds, ID_CHUNK_SIZE)) {
    for (const prefix of postalPrefixes(c)) jobs.push({ ids, prefix });
  }
  await mapLimit(jobs, MAX_PARALLEL_REQUESTS, async ({ ids, prefix }) => {
    const params = placeParams(c, prefix);
    params.append('_id', ids.join(','));
    params.append('_count', String(ORG_FETCH_LIMIT));
    const bundle = await fhirGet('Organization', params);
    for (const org of matchesOf(bundle, 'Organization')) matched.set(org.id, org);
  });
  return matched;
}

// ---------------------------------------------------------------------------
// Strategie 2 : lieu d'abord (aucun critere d'identite)
// ---------------------------------------------------------------------------
async function searchPlaceFirst(c, fhirGet) {
  let truncated = false;
  const orgs = new Map();

  await mapLimit(postalPrefixes(c), MAX_PARALLEL_REQUESTS, async (prefix) => {
    const params = placeParams(c, prefix);
    params.append('_count', String(ORG_FETCH_LIMIT));
    params.append('_total', 'accurate');
    const bundle = await fhirGet('Organization', params);
    const found = matchesOf(bundle, 'Organization');
    if (isTruncated(bundle, found.length)) truncated = true;
    for (const org of found) orgs.set(org.id, org);
  });

  if (orgs.size === 0) return finalize([], c.limit, false);

  const practitioners = new Map();
  const placesByPractitioner = new Map();

  await mapLimit(chunk([...orgs.keys()], ID_CHUNK_SIZE), MAX_PARALLEL_REQUESTS, async (ids) => {
    const params = new URLSearchParams();
    params.append('organization', ids.map((id) => `Organization/${id}`).join(','));
    params.append('_include', 'PractitionerRole:practitioner');
    params.append('_count', String(ROLE_FETCH_LIMIT));
    params.append('_total', 'accurate');
    const bundle = await fhirGet('PractitionerRole', params);
    const roles = matchesOf(bundle, 'PractitionerRole');
    if (isTruncated(bundle, roles.length)) truncated = true;

    for (const practitioner of entriesOf(bundle, 'Practitioner')) practitioners.set(practitioner.id, practitioner);
    for (const role of roles) {
      const practitionerId = idFromReference(role.practitioner);
      const org = orgs.get(idFromReference(role.organization));
      if (!practitionerId || !org) continue;
      if (!placesByPractitioner.has(practitionerId)) placesByPractitioner.set(practitionerId, new Map());
      placesByPractitioner.get(practitionerId).set(org.id, { nom: org.name, adresse: formatAddress(org.address?.[0]) });
    }
  });

  const items = [];
  for (const [id, resource] of practitioners) {
    const lieux = placesByPractitioner.get(id);
    items.push({ resource, lieux: lieux ? [...lieux.values()] : [] });
  }
  return finalize(items, c.limit, truncated);
}

async function searchPractitioners(criteria, fhirGet) {
  return hasPerson(criteria) ? searchPersonFirst(criteria, fhirGet) : searchPlaceFirst(criteria, fhirGet);
}

// ---------------------------------------------------------------------------
// Fiche detaillee : professionnel + ses situations d'exercice + ses structures
// ---------------------------------------------------------------------------
class NotFoundError extends Error {}

async function getPractitionerDetail(id, fhirGet) {
  if (!ID_RE.test(id)) throw new NotFoundError('Identifiant invalide.');

  const practitioner = await fhirGet(`Practitioner/${id}`);
  if (practitioner?.resourceType !== 'Practitioner') throw new NotFoundError('Professionnel introuvable.');

  // Les lieux d'exercice sont un plus : si cette seconde requete echoue, on
  // renvoie quand meme la fiche, en signalant que les lieux sont indisponibles.
  let roles = [];
  let organizations = [];
  let placesUnavailable = false;
  try {
    const params = new URLSearchParams();
    params.append('practitioner', `Practitioner/${id}`);
    params.append('_include', 'PractitionerRole:organization');
    params.append('_count', '50');
    const bundle = await fhirGet('PractitionerRole', params);
    roles = entriesOf(bundle, 'PractitionerRole');
    organizations = entriesOf(bundle, 'Organization');
  } catch (error) {
    placesUnavailable = true;
    console.error('Lieux d\'exercice indisponibles:', error.response?.data || error.message);
  }

  return {
    practitioner: sanitizeDeep(practitioner),
    roles: sanitizeDeep(roles) ?? [],
    organizations: sanitizeDeep(organizations) ?? [],
    placesUnavailable,
  };
}

module.exports = {
  buildCriteria,
  departmentPrefixes,
  searchPractitioners,
  getPractitionerDetail,
  NotFoundError,
  // exportes pour les tests
  idFromReference,
  formatAddress,
};
