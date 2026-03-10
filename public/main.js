// public/main.js
const socket = io();

let myId = null;
let pendingDrawSource = null; // "deck" o "discard"
let pendingCard = null;
let lastState = null;
let reactionActive = false;

// UI hooks (assicurati che gli ID esistano in index.html)
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const nicknameInput = document.getElementById("nickname");
const gameIdInput = document.getElementById("gameId");
const stoBtn = document.getElementById("stoBtn");
const drawDeckBtn = document.getElementById("drawDeckBtn");
const drawDiscardBtn = document.getElementById("drawDiscardBtn");
const discardDrawnBtn = document.getElementById("discardDrawnBtn");
const handDiv = document.getElementById("hand");
const currentPlayerDiv = document.getElementById("currentPlayer");
const discardDiv = document.getElementById("discard");
const pendingChoiceDiv = document.getElementById("pendingChoice");
const reactionInfoDiv = document.getElementById("reactionInfo");

createBtn.onclick = () => {
  const nickname = nicknameInput.value || "Player";
  socket.emit("createGame", nickname, (res) => {
    myId = socket.id;
    gameIdInput.value = res.gameId;
    document.getElementById("game").style.display = "block";
    // server manda subito update personalizzato
  });
};

joinBtn.onclick = () => {
  const gameId = gameIdInput.value;
  const nickname = nicknameInput.value || "Player";
  socket.emit("joinGame", { gameId, nickname }, (res) => {
    myId = socket.id;
    document.getElementById("game").style.display = "block";
  });
};

stoBtn.onclick = () => {
  const gameId = gameIdInput.value;
  socket.emit("declareSto", { gameId });
};

drawDeckBtn.onclick = () => {
  const gameId = gameIdInput.value;
  socket.emit("requestDraw", { gameId, source: "deck" });
  pendingDrawSource = "deck";
  showPendingChoice(false); // in attesa che server risponda con 'drawn' specifica
};

drawDiscardBtn.onclick = () => {
  const gameId = gameIdInput.value;
  socket.emit("requestDraw", { gameId, source: "discard" });
  pendingDrawSource = "discard";
  showPendingChoice(false);
};

discardDrawnBtn.onclick = () => {
  // scartiamo la carta pescata
  if (!pendingCard) return;
  const gameId = gameIdInput.value;
  socket.emit("playDrawn", { gameId, keep: false });
  pendingCard = null;
  hidePendingChoice();
};

// ricevo aggiornamenti PERSONALIZZATI per il mio socket
socket.on("update", (state) => {
  lastState = state;
  renderState(state);
});

// server manda 'drawn' SOLO al giocatore che ha pescato
socket.on("drawn", (card) => {
  pendingCard = card;
  showPendingChoice(true); // show card and allow swap or discard
});

// reaction started: server notifica a tutti
socket.on("reactionStarted", (info) => {
  reactionActive = true;
  reactionInfoDiv.style.display = "block";
  reactionInfoDiv.textContent = `Scartata: ${info.value} — puoi rispondere cliccando una tua carta (poi scegli target opzionale)`;
});

// reaction ended
socket.on("reactionEnded", () => {
  reactionActive = false;
  reactionInfoDiv.style.display = "none";
});

// error message
socket.on("errorMsg", (m) => alert(m));

// quando l'utente clicca una carta della propria mano
function onClickMyCard(idx) {
  // se c'è una pendingCard -> faccio swap
  if (pendingCard) {
    const gameId = gameIdInput.value;
    socket.emit("playDrawn", { gameId, keep: true, swapIndex: idx });
    pendingCard = null;
    hidePendingChoice();
    return;
  }

  // se reaction attiva -> reagisco usando questa carta
  if (reactionActive) {
    const target = prompt("Se vuoi far pescare 2 carte a un altro giocatore, inserisci il nome del target (lascia vuoto per reagire su te stesso):");
    // cerco id del target
    let targetId = null;
    if (target) {
      const targetPlayer = lastState.players.find(p => p.name === target);
      if (targetPlayer) targetId = targetPlayer.id;
      else {
        alert("Target non trovato (usa il nome esatto come mostrato).");
        return;
      }
    }
    const gameId = gameIdInput.value;
    socket.emit("respondReaction", { gameId, handIndex: idx, targetId });
    return;
  }
}

// UI rendering
function renderState(state) {
  currentPlayerDiv.textContent = `Turno di: ${state.players[state.currentPlayerIndex].name}`;
  // hand (viewer = me)
  const me = state.players.find(p => p.id === socket.id);
  handDiv.innerHTML = "";
  if (me) {
    me.hand.forEach((c, idx) => {
      const slot = document.createElement("button");
      slot.className = "card";
      // se il server ha indicato seenCards, il viewer vede quelle posizioni in chiaro
      if (me.seenCards && me.seenCards.includes(idx)) {
        slot.textContent = `${c.valore} di ${c.seme}`;
      } else if (c.hidden) {
        slot.textContent = "🂠";
      } else {
        // viewer hand full (should not happen for other players)
        slot.textContent = `${c.valore} di ${c.seme}`;
      }
      slot.onclick = () => onClickMyCard(idx);
      handDiv.appendChild(slot);
    });
  }

  // discard top
  if (state.discardTop) {
    discardDiv.textContent = `Ultimo scarto: ${state.discardTop.valore} di ${state.discardTop.seme}`;
  } else {
    discardDiv.textContent = "Nessuno scarto";
  }
}

// pendingChoice UI helpers
function showPendingChoice(showCard) {
  pendingChoiceDiv.style.display = "block";
  if (showCard && pendingCard) {
    pendingChoiceDiv.querySelector("#pendingCardInfo").textContent = `Carta pescata: ${pendingCard.valore} di ${pendingCard.seme}`;
  } else {
    pendingChoiceDiv.querySelector("#pendingCardInfo").textContent = "In attesa della carta dal server...";
  }
}

function hidePendingChoice() {
  pendingChoiceDiv.style.display = "none";
  pendingCard = null;
  pendingDrawSource = null;
}
