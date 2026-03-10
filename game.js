// game.js
import { createDeck } from "./deck.js";

// Crea una nuova partita
export function createGame(gameId, hostId, hostName) {
  const game = {
  gameId,
  deck: createDeck(),
  discardPile: [],
  players: [],
  dealerIndex: 0,
  currentPlayerIndex: 0,

  started: false,
  roundRevealStarted: false,

  pendingDraw: { playerId: null, card: null, source: null },
  reaction: {
    active: false,
    value: null,
    endsAt: null,
    responded: {}
  },
  special: null,
  fullRoundsCompleted: 0,
  stoDeclaredBy: null,
  totals: {}
};

  addPlayer(game, hostId, hostName);
  return game;
}

export function joinGame(game, playerId, playerName) {
  if (game.players.length >= 6) return { success: false, message: "Massimo 6 giocatori" };
  addPlayer(game, playerId, playerName);
  return { success: true };
}
function sumPoints(hand) {
  return (hand || []).reduce((s, c) => s + (c ? Number(c.valore) : 0), 0);
}
function pruneTempSeen(p) {
  if (!p?.tempSeen) return;
  const now = Date.now();
  for (const k of Object.keys(p.tempSeen)) {
    if (p.tempSeen[k] <= now) delete p.tempSeen[k];
  }
}

function ensureDeck(game) {
  if (game.deck.length > 0) return;
  if (game.discardPile.length <= 1) return;

  const top = game.discardPile.pop();
  game.deck = game.discardPile;
  game.discardPile = [top];

  for (let i = game.deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [game.deck[i], game.deck[j]] = [game.deck[j], game.deck[i]];
  }
}

function handCount(p) {
  return (p.hand || []).reduce((s, c) => s + (c ? 1 : 0), 0);
}

function firstEmptySlot(p) {
  for (let i = 0; i < p.hand.length; i++) {
    if (p.hand[i] == null) return i;
  }
  return -1;
}

function addCardToHand(p, card) {
  const i = firstEmptySlot(p);
  if (i >= 0) {
    p.hand[i] = card;
    return i;
  }
  p.hand.push(card);
  return p.hand.length - 1;
}

function removeCardFromHand(p, index) {
  if (index < 0 || index >= p.hand.length) return null;
  const c = p.hand[index];
  if (!c) return null;
  p.hand[index] = null;
  return c;
}
function addPlayer(game, playerId, playerName) {
  game.players.push({
    id: playerId,
    name: playerName,
    hand: [],
    seenCards: [],
    revealEndsAt: 0,
    stoImmune: false,
    tempSeen: {}
  });

  if (!game.totals[playerId]) game.totals[playerId] = 0;
}
export function startGame(game, playerId) {
  if (game.started) {
    return { success: false, message: "La partita è già iniziata" };
  }

  const hostId = game.players[0]?.id;
  if (playerId !== hostId) {
    return { success: false, message: "Solo l'host può avviare la partita" };
  }

  if (game.players.length < 1) {
  return { success: false, message: "Nessun giocatore" };
}
  game.started = true;
  game.roundRevealStarted = false;
  game.deck = createDeck();
  game.discardPile = [];
  game.pendingDraw = { playerId: null, card: null, source: null };
  game.reaction = { active: false, value: null, endsAt: null, responded: {} };
  game.special = null;
  game.fullRoundsCompleted = 0;
  game.stoDeclaredBy = null;

  for (const p of game.players) {
    p.hand = [];
    p.seenCards = [];
    p.revealEndsAt = 0;
    p.tempSeen = {};
    p.stoImmune = false;

    for (let i = 0; i < 4; i++) {
      ensureDeck(game);
      addCardToHand(p, game.deck.pop());
    }
  }

  return { success: true };
}
export function clearInitialReveal(game, playerId) {
  const p = game.players.find(x => x.id === playerId);
  if (p) {
    p.seenCards = [];
    p.revealEndsAt = 0;
  }
}

export function getPublicStateForViewer(game, viewerId) {
 const viewer = game.players.find(p => p.id === viewerId);
  if (viewer) pruneTempSeen(viewer);


  return {
    gameId: game.gameId,
    dealerIndex: game.dealerIndex,
    currentPlayerIndex: game.currentPlayerIndex,
    fullRoundsCompleted: game.fullRoundsCompleted,
    stoDeclaredBy: game.stoDeclaredBy,
    started: game.started,
    roundRevealStarted: game.roundRevealStarted,
    deckCount: game.deck.length,
    discardTop: game.discardPile.length ? game.discardPile[game.discardPile.length - 1] : null,

    reaction: game.reaction.active
      ? { active: true, value: game.reaction.value, endsAt: game.reaction.endsAt }
      : { active: false },

    pendingDraw:
      game.pendingDraw.playerId === viewerId
        ? { active: true, card: game.pendingDraw.card, source: game.pendingDraw.source }
        : { active: false, card: null, source: null },

    // ✅ speciale: visibile a tutti (ma lo usa solo chi lo ha)
    special: game.special
      ? { active: true, type: game.special.type, playerId: game.special.playerId }
      : { active: false },

    players: game.players.map(p => ({
     id: p.id,
     name: p.name,
     handCount: handCount(p),          // ✅ quante carte reali
     handSlots: (p.hand || []).map(c => (c ? 1 : 0)), // ✅ ordine + buchi
     stoImmune: p.stoImmune,
     totalScore: game.totals[p.id] ?? 0
    })),

    me: viewer
      ? {
          id: viewer.id,
          hand: viewer.hand,
          seenCards: viewer.seenCards,
          revealEndsAt: viewer.revealEndsAt || 0,
          tempSeen: viewer.tempSeen || {}
        }
      : null
  };
}

/* ---------------- TURNO ---------------- */

// fase A: requestDraw
export function requestDraw(game, playerId, source) {
  if (!game.started) return { success: false, message: "La partita non è ancora iniziata" };
  if (game.special) return { success: false, message: "Devi prima usare il potere speciale" };
  if (game.reaction.active) return { success: false, message: "Aspetta la fine della reazione" };

  const current = game.players[game.currentPlayerIndex]?.id;
  if (current !== playerId) return { success: false, message: "Non è il tuo turno" };

  if (game.pendingDraw.playerId) return { success: false, message: "Hai già pescato" };

  if (source === "deck") {
    ensureDeck(game);
    if (game.deck.length === 0) return { success: false, message: "Mazzo vuoto" };
    game.pendingDraw = { playerId, card: game.deck.pop(), source };
    return { success: true };
  }

  if (source === "discard") {
    if (game.discardPile.length === 0) return { success: false, message: "Scarti vuoti" };
    game.pendingDraw = { playerId, card: game.discardPile.pop(), source };
    return { success: true };
  }

  return { success: false, message: "Fonte non valida" };
}

// fase B: playDrawn (swap oppure scarta)
export function playDrawn(game, playerId, { keep, swapIndex }) {
  if (!game.started) return { success: false, message: "La partita non è ancora iniziata" };
  if (game.pendingDraw.playerId !== playerId) return { success: false, message: "Nessuna carta pescata" };

  const player = game.players.find(p => p.id === playerId);
  if (!player) return { success: false, message: "Giocatore non trovato" };

  const drawn = game.pendingDraw.card;
  let discarded;

  if (keep) {
    if (swapIndex == null || swapIndex < 0 || swapIndex >= player.hand.length) {
      return { success: false, message: "Indice scambio non valido" };
    }
    if (!player.hand[swapIndex]) {
     return { success: false, message: "Non puoi fare swap su uno slot vuoto" };
    }
    discarded = player.hand[swapIndex];
    player.hand[swapIndex] = drawn;
  } else {
    discarded = drawn;
  }

  game.discardPile.push(discarded);

  // reset pending
  game.pendingDraw = { playerId: null, card: null, source: null };

  // ✅ attiva poteri se scarti 8/9/10 (prima della reaction)
  if (discarded.valore === 8) {
    game.special = { type: "LOOK", playerId };
    return { success: true, discardedValue: discarded.valore, specialStarted: true };
  }
  if (discarded.valore === 9) {
    game.special = { type: "HORSE", playerId };
    return { success: true, discardedValue: discarded.valore, specialStarted: true };
  }
  if (discarded.valore === 10) {
    game.special = { type: "KING", playerId };
    return { success: true, discardedValue: discarded.valore, specialStarted: true };
  }

  // altrimenti reazione normale
  startReaction(game, discarded.valore);
  return { success: true, discardedValue: discarded.valore, specialStarted: false };
}

function startReaction(game, value) {
  game.reaction = {
    active: true,
    value,
    endsAt: Date.now() + 5000,
    responded: {}
  };
}

/* ---------------- REAZIONE ---------------- */
export function respondReaction(game, responderId, handIndex, targetId = null) {
  if (!game.started) return { success: false, message: "La partita non è ancora iniziata" };
  if (!game.reaction.active) return { success: false, message: "Nessuna reazione attiva" };

  if (game.reaction.endsAt && Date.now() > game.reaction.endsAt) {
    return { success: false, message: "Tempo reazione scaduto" };
  }

  if (game.reaction.responded[responderId]) {
    return { success: false, message: "Hai già reagito" };
  }

  const responder = game.players.find(p => p.id === responderId);
  if (!responder) return { success: false, message: "Giocatore non trovato" };

  if (handIndex < 0 || handIndex >= responder.hand.length) {
    return { success: false, message: "Indice non valido" };
  }

  const chosen = responder.hand[handIndex];
  if (!chosen) return { success: false, message: "Slot vuoto" };

  game.reaction.responded[responderId] = true;

  removeCardFromHand(responder, handIndex);
  game.discardPile.push(chosen);

  if (chosen.valore === game.reaction.value) {
    if (targetId) {
      const target = game.players.find(p => p.id === targetId);
      if (target) {
        const idx = drawPenalty(game, target, 2);
        return { success: true, correct: true, drew: { playerId: targetId, indices: idx } };
      }
    }
    return { success: true, correct: true };
  }

  const idx = drawPenalty(game, responder, 2);
  return { success: true, correct: false, drew: { playerId: responderId, indices: idx } };
}
export function startRoundReveal(game, playerId) {
  if (!game.started) {
    return { success: false, message: "La partita non è ancora iniziata" };
  }

  const hostId = game.players[0]?.id;
  if (playerId !== hostId) {
    return { success: false, message: "Solo l'host può avviare il reveal" };
  }

  if (game.roundRevealStarted) {
    return { success: false, message: "Reveal già avviato" };
  }

  game.roundRevealStarted = true;

  for (const p of game.players) {
    p.seenCards = [0, 1];
    p.revealEndsAt = Date.now() + 5000;
  }

  return { success: true };
}
export function tryMatchDiscard(game, playerId, handIndex, targetId = null) {
  if (!game.started) return { success: false, message: "La partita non è ancora iniziata" };
  const top = game.discardPile.length ? game.discardPile[game.discardPile.length - 1] : null;
  if (!top) return { success: false, message: "Scarti vuoti" };

  const p = game.players.find(x => x.id === playerId);
  if (!p) return { success: false, message: "Giocatore non trovato" };
  if (handIndex < 0 || handIndex >= p.hand.length) return { success: false, message: "Indice non valido" };

  const chosen = p.hand[handIndex];
  if (!chosen) return { success:false, message:"Slot vuoto" };

  removeCardFromHand(p, handIndex);
  game.discardPile.push(chosen);

  // ✅ se è giusta
  if (chosen.valore === top.valore) {
    if (targetId) {
      const target = game.players.find(t => t.id === targetId);
      if (target) {
        const idx = drawPenalty(game, target, 2);
        return { success: true, correct: true, drew: { playerId: targetId, indices: idx } };
      }
    }
    return { success: true, correct: true };
  }

  // ❌ se è sbagliata: penalità a te
  const idx = drawPenalty(game, p, 2);
  return { success: true, correct: false, drew: { playerId, indices: idx } };
}
export function tryMatchOtherDiscard(game, attackerId, targetId, handIndex) {
  if (!game.started) return { success: false, message: "La partita non è ancora iniziata" };
  const top = game.discardPile.length ? game.discardPile[game.discardPile.length - 1] : null;
  if (!top) return { success: false, message: "Scarti vuoti" };

  if (game.special) return { success: false, message: "Prima risolvi il potere speciale" };
  if (game.reaction.active) return { success: false, message: "Aspetta la fine della reazione" };
  if (game.pendingDraw.playerId) return { success: false, message: "C'è una pesca in corso" };

  const current = game.players[game.currentPlayerIndex]?.id;
  if (current !== attackerId) return { success: false, message: "Non è il tuo turno" };

  const attacker = game.players.find(p => p.id === attackerId);
  const target = game.players.find(p => p.id === targetId);
  if (!attacker || !target) return { success: false, message: "Giocatori non trovati" };

  if (handIndex < 0 || handIndex >= target.hand.length) {
    return { success: false, message: "Indice non valido" };
  }

  const chosen = target.hand[handIndex];
  if (!chosen) return { success: false, message: "Slot vuoto" };

  // scarta sempre la carta del target e lascia il buco
  removeCardFromHand(target, handIndex);
  game.discardPile.push(chosen);

  // ✅ se hai indovinato, il target pesca 2 carte
  if (chosen.valore === top.valore) {
    const idx = drawPenalty(game, target, 2);
    return { success: true, correct: true, drew: { playerId: targetId, indices: idx } };
  }

  // ❌ se hai sbagliato, peschi tu 2 carte
  const idx = drawPenalty(game, attacker, 2);
  return { success: true, correct: false, drew: { playerId: attackerId, indices: idx } };
}
function drawPenalty(game, player, n) {
  const addedIdx = [];
  for (let i = 0; i < n; i++) {
    ensureDeck(game);
    if (game.deck.length === 0) break;
    const idx = addCardToHand(player, game.deck.pop());
    addedIdx.push(idx);
  }
  return addedIdx;
}

// chiude reaction e passa turno
export function endReactionAndAdvanceTurn(game) {
  game.reaction = { active: false, value: null, endsAt: null, responded: {} };

  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;

  if (game.currentPlayerIndex === game.dealerIndex) {
    game.fullRoundsCompleted += 1;
  }

  if (game.stoDeclaredBy && game.players[game.currentPlayerIndex].id === game.stoDeclaredBy) {
  const payload = endRound(game);
  return { roundEnded: true, payload };
}

return { roundEnded: false };
}

/* ---------------- STO ---------------- */

export function declareSto(game, playerId) {
  if (!game.started) return { success: false, message: "La partita non è ancora iniziata" };
  if (game.fullRoundsCompleted < 2) return { success: false, message: "STÒ disponibile dopo 2 giri completi" };
  if (game.stoDeclaredBy) return { success: false, message: "STÒ già dichiarato" };

  const current = game.players[game.currentPlayerIndex]?.id;
  if (current !== playerId) return { success: false, message: "Puoi dire STÒ solo nel tuo turno" };

  game.stoDeclaredBy = playerId;
  const p = game.players.find(x => x.id === playerId);
  if (p) p.stoImmune = true;

  return { success: true };
}

/* ---------------- POTERI 8/9/10 ---------------- */

// Opzionale: puoi permettere di skippare il potere
export function skipSpecial(game, playerId) {
  if (!game.special) return { success: false, message: "Nessun potere attivo" };
  if (game.special.playerId !== playerId) return { success: false, message: "Non è il tuo potere" };

  const top = game.discardPile[game.discardPile.length - 1];
  game.special = null;
  startReaction(game, top.valore);
  return { success: true };
}

// 8 (Fante): guarda una tua carta (visibile a tempo)
export function useLook(game, playerId, handIndex) {
  if (!game.special || game.special.type !== "LOOK") return { success: false, message: "Nessun fante attivo" };
  if (game.special.playerId !== playerId) return { success: false, message: "Non è il tuo fante" };

  const p = game.players.find(x => x.id === playerId);
  if (!p) return { success: false, message: "Giocatore non trovato" };
  if (handIndex < 0 || handIndex >= p.hand.length) return { success: false, message: "Indice non valido" };

  // ✅ visibile SOLO 5 secondi
  if (!p.tempSeen) p.tempSeen = {};
  p.tempSeen[String(handIndex)] = Date.now() + 5000;

  const top = game.discardPile[game.discardPile.length - 1];
  game.special = null;
  startReaction(game, top.valore);
  return { success: true };
}


// 10 (Re): dai una carta dal mazzo a un target (non immune)
export function useKing(game, playerId, targetId) {
  if (!game.special || game.special.type !== "KING") return { success: false, message: "Nessun re attivo" };
  if (game.special.playerId !== playerId) return { success: false, message: "Non è il tuo re" };

  const target = game.players.find(p => p.id === targetId);
  if (!target) return { success: false, message: "Target non trovato" };
  if (target.stoImmune) return { success: false, message: "Target immune (STÒ)" };

  ensureDeck(game);
  if (game.deck.length === 0) return { success: false, message: "Mazzo vuoto" };

  target.hand.push(game.deck.pop());
  const addedIndex = target.hand.length - 1;

  const top = game.discardPile[game.discardPile.length - 1];
  game.special = null;
  startReaction(game, top.valore);
  return { success: true, drew: { playerId: targetId, indices: [addedIndex] } };
}

// 9 (Cavallo): scambia una tua carta con una carta di un altro (non immune)
export function useHorse(game, playerId, { myIndex, otherId, otherIndex }) {
  if (!game.special || game.special.type !== "HORSE") return { success: false, message: "Nessun cavallo attivo" };
  if (game.special.playerId !== playerId) return { success: false, message: "Non è il tuo cavallo" };

  const me = game.players.find(p => p.id === playerId);
  const other = game.players.find(p => p.id === otherId);
  if (!me || !other) return { success: false, message: "Giocatori non trovati" };
  if (other.stoImmune) return { success: false, message: "Target immune (STÒ)" };

  if (myIndex < 0 || myIndex >= me.hand.length) return { success: false, message: "Indice tuo non valido" };
  if (otherIndex < 0 || otherIndex >= other.hand.length) return { success: false, message: "Indice target non valido" };

  [me.hand[myIndex], other.hand[otherIndex]] = [other.hand[otherIndex], me.hand[myIndex]];

  const top = game.discardPile[game.discardPile.length - 1];
  game.special = null;
  startReaction(game, top.valore);
  return { success: true };
}

/* ---------------- FINE GIRO ---------------- */

function endRound(game) {
  // ✅ snapshot prima di resettare
  const snapshot = game.players.map(p => ({
  id: p.id,
  name: p.name,
  hand: p.hand.filter(c => c != null).map(c => ({ ...c })),
  roundPts: sumPoints(p.hand),
  totalBefore: game.totals[p.id] ?? 0
}));

  // aggiorna totals
  for (const r of snapshot) {
    game.totals[r.id] = (game.totals[r.id] ?? 0) + r.roundPts;
  }

  // prepara payload ordinato per classifica crescente (meno punti = meglio)
  const leaderboard = snapshot
    .map(r => ({
      id: r.id,
      name: r.name,
      hand: r.hand,
      roundPts: r.roundPts,
      totalPts: game.totals[r.id]
    }))
    .sort((a, b) => a.roundPts - b.roundPts);

  const payload = {
    gameId: game.gameId,
    endedAt: Date.now(),
    leaderboard
  };

  // --- reset round (come facevi prima) ---
  game.deck = createDeck();
  game.discardPile = [];
  game.pendingDraw = { playerId: null, card: null, source: null };
  game.reaction = { active: false, value: null, endsAt: null, responded: {} };
  game.special = null;

  for (const p of game.players) p.stoImmune = false;
  game.stoDeclaredBy = null;

  for (const p of game.players) {
  p.hand = [];
  p.seenCards = [];
  p.revealEndsAt = 0;
  p.tempSeen = {};
  for (let i = 0; i < 4; i++) {
    ensureDeck(game);
    addCardToHand(p, game.deck.pop());
  }
}

  game.dealerIndex = (game.dealerIndex + 1) % game.players.length;
  game.currentPlayerIndex = (game.dealerIndex + 1) % game.players.length;
  game.fullRoundsCompleted = 0;
  game.roundRevealStarted = false;
  return payload; // ✅ IMPORTANTISSIMO
}
