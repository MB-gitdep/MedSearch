// sessions.js
//
// Magasin de sessions en memoire. Le navigateur ne recoit qu'un identifiant de
// session aleatoire et opaque (dans un cookie HttpOnly) ; le token d'acces du
// SSO reste ici, cote serveur, et n'est jamais envoye au JavaScript du site.
// Ainsi, meme une faille XSS ne permet plus de voler le token.
//
//  - identifiant : 32 octets aleatoires (256 bits), nouveau a chaque connexion
//    (pas de fixation de session) ;
//  - on ne conserve que l'empreinte SHA-256 de l'identifiant comme cle ;
//  - duree de vie maximale ET delai d'inactivite ;
//  - nombre de sessions borne (un attaquant ne peut pas saturer la memoire).
//
// Limite assumee : les sessions sont en memoire, un redemarrage du serveur
// deconnecte les utilisateurs (ils se reconnectent via le SSO).

'use strict';

const crypto = require('crypto');

const SESSION_ID_RE = /^[A-Za-z0-9_-]{43}$/; // 32 octets en base64url

const hashId = (id) => crypto.createHash('sha256').update(id).digest('hex');

class SessionStore {
  constructor({ maxAgeMs, idleMs, maxSessions }) {
    this.maxAgeMs = maxAgeMs;
    this.idleMs = idleMs;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
  }

  get size() {
    return this.sessions.size;
  }

  // Cree une session et renvoie son identifiant (a poser dans le cookie).
  create(accessToken, { validatedUntil = 0, now = Date.now() } = {}) {
    this.prune(now);
    // Magasin plein : on retire les plus anciennes (Map conserve l'ordre d'insertion).
    while (this.sessions.size >= this.maxSessions) {
      this.sessions.delete(this.sessions.keys().next().value);
    }
    const id = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(hashId(id), { accessToken, createdAt: now, lastSeen: now, validatedUntil });
    return id;
  }

  // Renvoie la session si l'identifiant est valide et non expire, sinon undefined.
  get(id, now = Date.now()) {
    if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) return undefined;
    const key = hashId(id);
    const session = this.sessions.get(key);
    if (!session) return undefined;
    if (now - session.createdAt > this.maxAgeMs || now - session.lastSeen > this.idleMs) {
      this.sessions.delete(key);
      return undefined;
    }
    session.lastSeen = now;
    return session;
  }

  destroy(id) {
    if (typeof id === 'string' && SESSION_ID_RE.test(id)) this.sessions.delete(hashId(id));
  }

  prune(now = Date.now()) {
    for (const [key, session] of this.sessions) {
      if (now - session.createdAt > this.maxAgeMs || now - session.lastSeen > this.idleMs) {
        this.sessions.delete(key);
      }
    }
  }
}

module.exports = { SessionStore };
