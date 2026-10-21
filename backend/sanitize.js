// sanitize.js
//
// Nettoyage des donnees venant d'API tierces avant de les renvoyer au
// navigateur : on ne laisse passer que des types simples (texte, nombre,
// booleen, tableaux, objets), avec des tailles et une profondeur bornees, et
// on retire les valeurs vides. Le frontend n'affiche ces valeurs que comme du
// texte (jamais en HTML), mais borner les donnees en amont reste une
// defense en profondeur.

'use strict';

const MAX_DEPTH = 8;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 60;
const MAX_OBJECT_KEYS = 60;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeDeep(value, depth = 0) {
  if (value === null || value === undefined || depth > MAX_DEPTH) return undefined;

  if (typeof value === 'string') {
    const text = value.trim().slice(0, MAX_STRING_LENGTH);
    return text === '' ? undefined : text;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeDeep(item, depth + 1))
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'object') {
    const clean = Object.create(null);
    for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      if (FORBIDDEN_KEYS.has(key) || key.length > 64) continue;
      const cleanItem = sanitizeDeep(item, depth + 1);
      if (cleanItem !== undefined) clean[key] = cleanItem;
    }
    return Object.keys(clean).length > 0 ? clean : undefined;
  }

  return undefined;
}

module.exports = { sanitizeDeep };
