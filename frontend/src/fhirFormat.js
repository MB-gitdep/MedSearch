// src/fhirFormat.js
//
// Transforme les ressources FHIR brutes (Practitioner, PractitionerRole,
// Organization) en une "fiche" lisible : identite, profession, specialites,
// diplomes, lieux d'exercice... Fonctions pures, sans React : faciles a tester.
//
// Les terminologies sont reperees par un fragment de leur URL (ex. TRE_G15 =
// professions, TRE_R38 = specialites ordinales). Seuls les libelles fournis
// par l'API (display) ou connus avec certitude sont affiches ; un code brut
// incomprehensible n'est jamais presente comme une information.

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
};
const unique = (items) => [...new Set(items.filter(Boolean))];
const hasSystem = (coding, key) => typeof coding?.system === 'string' && coding.system.includes(key);

const PREFIX_LABELS = { M: 'Monsieur', MME: 'Madame', MLLE: 'Mademoiselle' };
const SUFFIX_LABELS = { DR: 'Docteur', PR: 'Professeur' };
const IDENTIFIER_LABELS = {
  RPPS: 'Numéro RPPS',
  IDNPS: 'Identifiant national de professionnel de santé (ID NPS)',
  ADELI: 'Numéro ADELI',
};
// Modes d'exercice (TRE_R23) observes dans la documentation de l'annuaire.
const EXERCISE_MODES = { L: 'Libéral', S: 'Salarié' };

// "Médecine du travail (SM)" -> "Médecine du travail"
const cleanSpecialty = (label) => String(label).replace(/\s*\((SM|SI|SCD|SP)\)\s*$/, '');

export function formatDate(value, withTime = false) {
  if (!value) return null;
  const text = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  if (withTime && !dateOnly) {
    return date.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  }
  // Une date sans heure est affichee telle quelle, sans decalage de fuseau.
  return date.toLocaleDateString('fr-FR', { dateStyle: 'long', ...(dateOnly ? { timeZone: 'UTC' } : {}) });
}

function idFromReference(reference) {
  const match = /(?:^|\/)([A-Za-z0-9.-]{1,64})$/.exec(String(reference?.reference ?? ''));
  return match ? match[1] : null;
}

export function formatAddress(address) {
  if (!address) return null;
  const lines = toArray(address.line);
  const town = [address.postalCode, address.city].filter(Boolean).join(' ');
  const text = [...lines, town].filter(Boolean).join(', ');
  return text || address.text || null;
}

// Profession, specialites, diplomes et categorie, extraits des "qualifications".
function readQualifications(practitioner) {
  const result = { professions: [], categories: [], specialties: [], diplomas: [] };

  for (const qualification of toArray(practitioner?.qualification)) {
    const codings = toArray(qualification?.code?.coding);
    const find = (key) => codings.find((coding) => hasSystem(coding, key))?.display;

    const profession = find('TRE_G15');
    const category = find('TRE_R09');
    const specialty = find('TRE_R38');
    if (profession) result.professions.push(profession);
    if (category) result.categories.push(category);
    if (specialty) result.specialties.push(cleanSpecialty(specialty));

    // Diplome : type (DES, DE...) + intitule precis, ex. "Diplôme d'État — DE Docteur en médecine".
    const diplomaParts = unique([find('TRE_R14'), find('TRE_R48'), find('TRE_R49')]);
    if (diplomaParts.length > 0) result.diplomas.push(diplomaParts.join(' — '));
  }

  return {
    professions: unique(result.professions),
    categories: unique(result.categories),
    specialties: unique(result.specialties),
    diplomas: unique(result.diplomas),
  };
}

// Resume pour la liste de resultats.
export function summarizePractitioner(practitioner) {
  const name = toArray(practitioner?.name)[0] ?? {};
  const given = toArray(name.given).join(' ');
  const title = name.text || [name.family, given].filter(Boolean).join(' ') || 'Professionnel de santé (nom non renseigné)';
  const { professions, specialties } = readQualifications(practitioner);
  return { title, profession: professions.join(', '), specialties };
}

function readSmartCard(practitioner) {
  const extension = toArray(practitioner?.extension).find((ext) => String(ext?.url).endsWith('as-ext-smartcard'));
  if (!extension) return null;
  const sub = (url) => toArray(extension.extension).find((ext) => ext?.url === url);

  const number = sub('number')?.valueString;
  if (!number) return null;
  const type = sub('type');
  const typeLabel =
    type?.valueCoding?.display ||
    type?.valueCodeableConcept?.text ||
    toArray(type?.valueCodeableConcept?.coding)[0]?.display ||
    null;
  const period = sub('period')?.valuePeriod;
  return {
    type: typeLabel,
    number,
    start: formatDate(period?.start),
    end: formatDate(period?.end),
  };
}

// Lieux d'exercice : une entree par structure, avec adresse, contacts et
// modalites d'exercice deduites des situations (PractitionerRole).
function readPlaces(roles, organizations) {
  const orgById = new Map(toArray(organizations).map((org) => [org.id, org]));
  const places = new Map();

  for (const role of toArray(roles)) {
    const orgId = idFromReference(role?.organization);
    if (!orgId) continue;

    if (!places.has(orgId)) {
      const org = orgById.get(orgId);
      const telecom = toArray(org?.telecom);
      const valuesOf = (system) => unique(telecom.filter((t) => t?.system === system).map((t) => t.value));
      places.set(orgId, {
        id: orgId,
        name: org?.name ?? 'Structure non renseignée',
        address: formatAddress(toArray(org?.address)[0]),
        phones: valuesOf('phone'),
        faxes: valuesOf('fax'),
        emails: valuesOf('email'),
        types: unique(toArray(org?.type).flatMap((type) => toArray(type?.coding).map((c) => c?.display))),
        modes: [],
      });
    }

    const place = places.get(orgId);
    for (const coding of toArray(role?.code).flatMap((code) => toArray(code?.coding))) {
      if (hasSystem(coding, 'TRE_R23')) {
        place.modes.push(coding.display || EXERCISE_MODES[coding.code]);
      }
    }
  }

  return [...places.values()].map((place) => ({ ...place, modes: unique(place.modes) }));
}

export function buildPractitionerView({ practitioner, roles = [], organizations = [] }) {
  const name = toArray(practitioner?.name)[0] ?? {};
  const given = toArray(name.given).join(' ');
  const { title } = summarizePractitioner(practitioner);
  const qualifications = readQualifications(practitioner);

  const prefix = toArray(name.prefix)[0];
  const suffix = toArray(name.suffix)[0];
  const identity = [
    { label: 'Civilité', value: prefix ? PREFIX_LABELS[String(prefix).toUpperCase()] ?? prefix : null },
    { label: 'Titre', value: suffix ? SUFFIX_LABELS[String(suffix).toUpperCase()] ?? suffix : null },
    { label: 'Nom', value: name.family },
    { label: 'Prénom(s)', value: given },
    { label: 'Référencé comme actif', value: typeof practitioner?.active === 'boolean' ? (practitioner.active ? 'Oui' : 'Non') : null },
  ].filter((field) => field.value);

  const identifiers = toArray(practitioner?.identifier)
    .map((identifier) => {
      const code = toArray(identifier?.type?.coding)[0]?.code;
      return { label: IDENTIFIER_LABELS[code] ?? code ?? 'Identifiant', value: identifier?.value };
    })
    .filter((field) => field.value);

  const subtitleParts = [qualifications.professions.join(', '), qualifications.specialties.join(', ')].filter(Boolean);

  return {
    title,
    subtitle: subtitleParts.join(' · '),
    identity,
    identifiers,
    ...qualifications,
    places: readPlaces(roles, organizations),
    card: readSmartCard(practitioner),
    updatedAt: formatDate(practitioner?.meta?.lastUpdated, true),
    source: practitioner?.meta?.source ?? null,
  };
}
