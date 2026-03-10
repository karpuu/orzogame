// game.js
import { createDeck } from "./deck.js";

/**
 * Stato partita (schema principale):
 * game = {
 *   gameId,
 *   deck: [...],
 *   discardPile: [...],
 *   players: [{ id, name, hand:[], points, seenCards:[], stoImmune }],
 *   currentPlayerIndex,
 *   stoDeclared,
 *   round,
 *   pendingDraws: { playerId: card }, // carta pescata e non ancora giocata
 *   reaction: { active, value, initiatorId, responses: { playerId: { correct:bool, targetId? } } }
 * }
 */

/* ---------- helper ---------- */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function reshuffleDiscardIntoDeck(game) {
  if (game.discardPile.length <= 1) return;
  const top = game.discardPile.pop();
  game.deck = shuffle(game.discardPile.slice());
  game.discardPile = [top];
}

/* ---------- API pubblica ---------- */

export function createGame(gameId, hostId, hostName) {
  const deck = createDeck();
  const discardPile = [];
  const players = [];

  const host = {
    id: hostId,
    name: hostName,
    hand: [],
    points: 0,
    seenCards: [0, 1], // server deve rimuovere dopo 10s con setTimeout e invio update
    stoImmune: false
  };
  // distribuisci 4 al host
  for (let i = 0; i < 4; i++) host.hand.push(deck.pop());
  players.push(host);

  return {
    gameId,
    deck,
    discardPile,
    players,
    currentPlayerIndex: 0,
    stoDeclared: null,
    round: 1,
    pendingDraws: {},
    reaction: { active: false, value: null, initiatorId: null, responses: {} }
  };
}

export function joinGame(game, playerId, playerName) {
  if (game.players.length >= 6) return { success: false, message: "Room piena" };
  const player = {
    id: playerId,
    name: playerName,
    hand: [],
    points: 0,
    seenCards: [0, 1],
    stoImmune: false
  };
  for (let i = 0; i < 4; i++) player.hand.push(game.deck.pop());
  game.players.push(player);
  return { success: true };
}

/**
 * Richiesta di pescare (il server NON modifica la mano fino al playDrawn)
 * ritorna { success, card?, message? }
 */
export function requestDraw(game, playerId, source) {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return { success: false, message: "Giocatore non in partita" };
  if (game.players[game.currentPlayerIndex].id !== playerId) return { success: false, message: "Non è il tuo turno" };
  if (game.pendingDraws[playerId]) return { success: false, message: "Hai già pescato" };

  if (source === "deck") {
    if (game.deck.length === 0) reshuffleDiscardIntoDeck(game);
    if (game.deck.length === 0) return { success: false, message: "Il mazzo è vuoto" };
    const c = game.deck.pop();
    game.pendingDraws[playerId] = c;
    return { success: true, card: c };
  } else if (source === "discard") {
    if (game.discardPile.length === 0) return { success: false, message: "Pila scarti vuota" };
    const c = game.discardPile.pop();
    game.pendingDraws[playerId] = c;
    return { success: true, card: c };
  } else {
    return { success: false, message: "Fonte non valida" };
  }
}

/**
 * Finale della giocata dopo la pescata:
 * { keep: bool, swapIndex: number } 
 * - se keep true => scambia drawn con hand[swapIndex]
 * - se keep false => la drawn va direttamente negli scarti
 *
 * Ritorna { success, discarded?, reactionStarted?, value?, message? }
 */
export function playDrawn(game, playerId, { keep, swapIndex }) {
  const drawn = game.pendingDraws[playerId];
  if (!drawn) return { success: false, message: "Nessuna carta pescata" };

  const player = game.players.find(p => p.id === playerId);
  if (!player) return { success: false, message: "Giocatore non trovato" };

  let discarded;
  if (keep) {
    if (swapIndex == null || swapIndex < 0 || swapIndex >= player.hand.length) {
      return { success: false, message: "Indice scambio non valido" };
    }
    discarded = player.hand[swapIndex];
    player.hand[swapIndex] = drawn;
    game.discardPile.push(discarded);
  } else {
    discarded = drawn;
    game.discardPile.push(discarded);
  }
  delete game.pendingDraws[playerId];

  // gestisci potere speciale (fante/cavallo/re) lato server può attivare azioni extra
  // (qui lasciamo il trigger; dettagli di interazione verranno esposti via eventi server)
  // start reaction per lo scarto appena avvenuto
  startReaction(game, playerId, discarded.valore);

  return { success: true, discarded, reactionStarted: true, value: discarded.valore };
}

/* Reaction: quando qualcuno scarta una carta X,
   si apre una finestra in cui chiunque può rispondere usando una propria carta:
   - se la carta usata has valore == X => la carta viene scartata (vantaggio per il risponditore)
       - se rispondente ha specificato un target => il target pesca 2 carte di penalità
       - se no target => il risponditore semplicemente scarta la sua carta (riduce punti)
   - se la carta non corrisponde => il risponditore pesca 2 carte di penalità
*/
function startReaction(game, initiatorId, value) {
  game.reaction = {
    active: true,
    value,
    initiatorId,
    responses: {} // map playerId -> { correct: bool, targetId? }
  };
}

/**
 * responder gioca la propria carta indicata da handIndex; targetId opzionale:
 * - se correct => rimuove la carta dalla sua mano e viene scartata; se targetId presente => target pesca 2
 * - se incorrect => il responder pesca 2 carte
 */
export function respondToReaction(game, responderId, handIndex, targetId = null) {
  if (!game.reaction || !game.reaction.active) return { success: false, message: "Nessuna reazione attiva" };
  if (game.reaction.responses[responderId]) return { success: false, message: "Hai già risposto" };

  const responder = game.players.find(p => p.id === responderId);
  if (!responder) return { success: false, message: "Giocatore non trovato" };
  if (handIndex < 0 || handIndex >= responder.hand.length) return { success: false, message: "Indice carta non valido" };

  const card = responder.hand[handIndex];
  if (card.valore === game.reaction.value) {
    // corretto
    responder.hand.splice(handIndex, 1);
    game.discardPile.push(card);
    game.reaction.responses[responderId] = { correct: true, targetId: targetId || null };

    if (targetId) {
      const target = game.players.find(p => p.id === targetId);
      if (target) {
        drawPenalty(game, target, 2);
      }
    }
    return { success: true, correct: true };
  } else {
    // sbagliato -> pesca 2 carte
    game.reaction.responses[responderId] = { correct: false };
    drawPenalty(game, responder, 2);
    return { success: true, correct: false };
  }
}

function drawPenalty(game, player, n) {
  for (let i = 0; i < n; i++) {
    if (game.deck.length === 0) reshuffleDiscardIntoDeck(game);
    if (game.deck.length === 0) break;
    player.hand.push(game.deck.pop());
  }
}

/* Termina la reaction window: pulisce e avanza il turno */
export function endReaction(game) {
  game.reaction = { active: false, value: null, initiatorId: null, responses: {} };
  // passiamo al prossimo giocatore
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
}

/* STÒ */
export function declareSto(game, playerId) {
  game.stoDeclared = playerId;
  const p = game.players.find(x => x.id === playerId);
  if (p) p.stoImmune = true;
}

/* Punteggio (ogni carta vale il suo valore numerico: 1..10) */
export function calculatePoints(player) {
  return player.hand.reduce((s, c) => s + Number(c.valore), 0);
}

/* Restituisce uno "stato pubblico" PERSONALIZZATO per chi guarda (viewerId).
   - mostra la mano completa solo se viewerId === player.id
   - mostra per gli altri giocatori solo il numero di carte (o placeholders)
   - non espone il contenuto del mazzo, solo deckCount
   - espone l'ultimo scarto
   - espone se c'è reaction attiva (value) così i client sanno su cosa reagire
*/
export function getPublicState(game, viewerId) {
  const players = game.players.map(p => {
    if (p.id === viewerId) {
      return {
        id: p.id,
        name: p.name,
        hand: p.hand.slice(), // full
        points: p.points,
        seenCards: p.seenCards.slice(),
        stoImmune: p.stoImmune
      };
    } else {
      // mano nascosta: rappresentiamo come array di slot vuoti (length)
      return {
        id: p.id,
        name: p.name,
        hand: new Array(p.hand.length).fill({ hidden: true }),
        points: p.points,
        // NOTA: seenCards NON deve essere mostrato agli altri
        seenCards: [],
        stoImmune: p.stoImmune
      };
    }
  });

  const discardTop = game.discardPile.length ? game.discardPile[game.discardPile.length - 1] : null;

  return {
    gameId: game.gameId,
    players,
    currentPlayerIndex: game.currentPlayerIndex,
    deckCount: game.deck.length,
    discardTop,
    reaction: game.reaction.active ? { active: true, value: game.reaction.value, initiatorId: game.reaction.initiatorId } : { active: false },
    stoDeclared: game.stoDeclared,
    round: game.round
  };
}
