const socket = io();
let lastState = null;

let reactionMode = null;
let reactionTargetId = null;
let newCardIdx = new Set();
const tableEl = document.getElementById("table");
const elHand = document.getElementById("hand");
const elStatus = document.getElementById("status");
const elInfo = document.getElementById("info");

const elDeckCard = document.getElementById("deckCard");
const elDeckCount = document.getElementById("deckCount");
const elDiscardCard = document.getElementById("discardCard");
const elDiscardHint = document.getElementById("discardHint");

const elPending = document.getElementById("pending");
const elPendingCard = document.getElementById("pendingCard");

const elReaction = document.getElementById("reaction");
const elReactionValue = document.getElementById("reactionValue");
const elReactionCountdown = document.getElementById("reactionCountdown");

const sockStatus = document.getElementById("sockStatus");
const sockInfo = document.getElementById("sockInfo");
const fxLayer = document.getElementById("fxLayer");
let lastPendingActive = false;

function setSock(ok, text) {
  sockStatus.textContent = text;
  sockStatus.className = "pill " + (ok ? "ok" : "bad");
}

socket.on("connect", () => {
  setSock(true, "connesso");
  sockInfo.textContent = `socket.id = ${socket.id}`;
});
socket.on("disconnect", (reason) => {
  setSock(false, "disconnesso");
  sockInfo.textContent = `reason = ${reason}`;
});
socket.on("connect_error", (err) => {
  setSock(false, "errore");
  sockInfo.textContent = String(err?.message || err);
});

document.getElementById("createBtn").onclick = () => {
  const nickname = document.getElementById("nickname").value || "Host";
  socket.emit("createGame", nickname, (res) => {
    if (!res?.gameId) return alert("Errore createGame");
    document.getElementById("gameId").value = res.gameId;
  });
};

document.getElementById("joinBtn").onclick = () => {
  const gameId = document.getElementById("gameId").value.trim();
  const nickname = document.getElementById("nickname").value || "Player";
  socket.emit("joinGame", { gameId, nickname }, (res) => {
    if (res?.error) return alert(res.error);
  });
};

document.getElementById("drawDeckBtn").onclick = () => {
  const gameId = document.getElementById("gameId").value.trim();
  socket.emit("requestDraw", { gameId, source: "deck" });
};

document.getElementById("drawDiscardBtn").onclick = () => {
  const gameId = document.getElementById("gameId").value.trim();
  socket.emit("requestDraw", { gameId, source: "discard" });
};

document.getElementById("discardDrawnBtn").onclick = () => {
  const gameId = document.getElementById("gameId").value.trim();
  socket.emit("playDrawn", { gameId, keep: false });
};

document.getElementById("stoBtn").onclick = () => {
  const gameId = document.getElementById("gameId").value.trim();
  socket.emit("declareSto", { gameId }, (res) => {
    if (!res?.ok) alert(res?.error || "Errore STÒ");
  });
};

/* ---------------- SPECIALI ---------------- */

socket.on("specialStarted", ({ type, playerId }) => {
  if (!lastState?.me) return;
  if (playerId !== lastState.me.id) return;

  handleMySpecial(type);
});
function handleMySpecial(type) {
  if (!lastState?.me) return;
  const gameId = document.getElementById("gameId").value.trim();

  if (type === "LOOK") {
    alert("Hai scartato un FANTE (8)! Clicca una tua carta per guardarla.");
    return;
  }

  if (type === "KING") {
    while (true) {
      const available = (lastState.players || [])
        .filter(p => p.id !== lastState.me.id)
        .map(p => p.name)
        .join(", ");

      const name = prompt(
        `RE (10): scrivi il NOME del giocatore a cui dare 1 carta.\nGiocatori disponibili: ${available}\n\nLascia vuoto o premi Annulla per riprovare dopo.`
      );

      if (name == null || !name.trim()) {
        alert("Potere RE ancora attivo. Quando vuoi riprovare, premi di nuovo un pulsante o fai aggiornare lo stato.");
        return;
      }

      const target = lastState.players.find(
        p => p.id !== lastState.me.id && p.name.toLowerCase() === name.trim().toLowerCase()
      );

      if (!target) {
        alert("Nome non trovato. Riprova.");
        continue;
      }

      socket.emit("useKing", { gameId, targetId: target.id });
      return;
    }
  }

  if (type === "HORSE") {
    while (true) {
      const available = (lastState.players || [])
        .filter(p => p.id !== lastState.me.id)
        .map(p => p.name)
        .join(", ");

      const otherName = prompt(
        `CAVALLO (9): nome del giocatore con cui scambiare.\nGiocatori disponibili: ${available}\n\nLascia vuoto o premi Annulla per riprovare dopo.`
      );

      if (otherName == null || !otherName.trim()) {
        alert("Potere CAVALLO ancora attivo. Quando vuoi riprovare, premi di nuovo un pulsante o fai aggiornare lo stato.");
        return;
      }

      const other = lastState.players.find(
        p => p.id !== lastState.me.id && p.name.toLowerCase() === otherName.trim().toLowerCase()
      );

      if (!other) {
        alert("Nome non trovato. Riprova.");
        continue;
      }

      const myPosRaw = prompt("Quale tua carta vuoi scambiare? Scrivi 1, 2, 3, 4...");
      if (myPosRaw == null) {
        alert("Potere CAVALLO ancora attivo.");
        return;
      }

      const otherPosRaw = prompt(`Quale carta di ${other.name} vuoi prendere? Scrivi 1, 2, 3, 4...`);
      if (otherPosRaw == null) {
        alert("Potere CAVALLO ancora attivo.");
        return;
      }

      const myPos = Number(myPosRaw) - 1;
      const otherPos = Number(otherPosRaw) - 1;

      if (!Number.isInteger(myPos) || myPos < 0) {
        alert("Indice tua carta non valido. Riprova.");
        continue;
      }

      if (!Number.isInteger(otherPos) || otherPos < 0) {
        alert("Indice carta avversario non valido. Riprova.");
        continue;
      }

      socket.emit("useHorse", {
        gameId,
        myIndex: myPos,
        otherId: other.id,
        otherIndex: otherPos
      });
      return;
    }
  }
}
socket.on("cardsAdded", ({ playerId, indices }) => {
  if (!lastState?.me) return;
  if (playerId !== lastState.me.id) return;

  // salva per highlight (come facevi)
  newCardIdx = new Set(indices.map(i => String(i)));

  // animazione: deck -> slot mano
  // Troviamo i bottoni della mano dopo il prossimo render
  setTimeout(() => {
    const handButtons = [...elHand.querySelectorAll("button.cardBtn")];
    indices.forEach((idx, j) => {
      const targetBtn = handButtons[idx];
      if (!targetBtn) return;

      // vola dal mazzo allo slot (stagger)
      flyBackCard(elDeckCard, targetBtn, { duration: 420, delay: j * 140, spin: 18, arc: -18 });
    });
  }, 0);

  // dopo 2s togli highlight
  setTimeout(() => {
    newCardIdx.clear();
    if (lastState) render(lastState);
  }, 2000);

  if (lastState) render(lastState);
});
/* ---------------- REAZIONE ---------------- */

socket.on("reactionStarted", ({ value, endsAt }) => {
  elReaction.style.display = "block";
  elReactionValue.textContent = value;

  if (endsAt) {
    const interval = setInterval(() => {
      const ms = Math.max(0, endsAt - Date.now());
      const sec = Math.ceil(ms / 1000);
      elReactionCountdown.textContent = `Tempo: ${sec}s`;
      if (ms <= 0) clearInterval(interval);
    }, 500);
  }
});

socket.on("reactionEnded", () => {
  elReaction.style.display = "none";
  reactionMode = null;
  reactionTargetId = null;
});

/* ---------------- UPDATE ---------------- */

socket.on("errorMsg", (m) => alert(m));

socket.on("update", (state) => {
  lastState = state;
  render(state);
});

/* ---------------- RENDER ---------------- */
function getRect(el){
  const r = el.getBoundingClientRect();
  return { left:r.left, top:r.top, width:r.width, height:r.height,
           cx:r.left + r.width/2, cy:r.top + r.height/2 };
}

function makeFlyingBackCard(){
  const wrap = document.createElement("div");
  wrap.className = "flyingCard";
  const inner = document.createElement("div");
  inner.className = "inner";
  inner.appendChild(cardSvgBack()); // SEMPRE COPERTA
  wrap.appendChild(inner);
  document.body.appendChild(wrap);  // fixed -> meglio su body
  return wrap;
}

/**
 * Casino-style flight:
 * - parte da sourceRect
 * - arriva a targetRect
 * - con tilt + piccolo flip (rotateY) anche se è coperta
 */
function flyBackCard(sourceEl, targetEl, opts = {}){
  const duration = opts.duration ?? 420;     // casino feel
  const delay = opts.delay ?? 0;
  const arc = opts.arc ?? -18;              // leggero arco in su
  const spin = opts.spin ?? 18;             // tilt/rotazione

  const s = getRect(sourceEl);
  const t = getRect(targetEl);

  const card = makeFlyingBackCard();

  // piazza card al centro della source
  card.style.left = (s.cx - 92/2) + "px";
  card.style.top  = (s.cy - 140/2) + "px";
  card.style.opacity = "1";

  // stato iniziale (tilt)
  card.style.transform = `translate(0px, 0px) rotate(${-(spin)}deg) scale(0.98)`;
  card.querySelector(".inner").style.transform = `rotateY(0deg)`;

  // forza reflow
  void card.offsetWidth;

  // animazione con transition
  card.style.transition = `transform ${duration}ms cubic-bezier(.16,1,.3,1) ${delay}ms, opacity 160ms ease-out ${delay + duration - 120}ms`;
  card.querySelector(".inner").style.transition = `transform ${duration}ms cubic-bezier(.2,.9,.2,1) ${delay}ms`;

  const dx = (t.cx - s.cx);
  const dy = (t.cy - s.cy) + arc;

  // vai al target
  card.style.transform = `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(1.02)`;
  // flip leggero “casino”
  card.querySelector(".inner").style.transform = `rotateY(140deg)`;

  // atterraggio + cleanup
  setTimeout(() => {
    // attacca effetto land sull’elemento reale
    targetEl.classList.remove("land");
    void targetEl.offsetWidth;
    targetEl.classList.add("land");
  }, delay + duration - 40);

  setTimeout(() => {
    card.remove();
  }, delay + duration + 80);
}
function render(state) {
  const currentName = state.players?.[state.currentPlayerIndex]?.name ?? "(?)";
  elStatus.innerHTML = `<b>Turno di:</b> ${currentName}`;
  elInfo.textContent = `Mazzo: ${state.deckCount ?? 0}`;

  elDeckCard.innerHTML = "";
  elDeckCard.appendChild(cardSvgBack("svgCard"));
  elDeckCount.textContent = `${state.deckCount ?? 0} carte`;

  elDiscardCard.innerHTML = "";
  if (state.discardTop) {
    elDiscardCard.appendChild(cardSvgFace(state.discardTop, "svgCard"));
    elDiscardHint.textContent = "cima degli scarti";
  } else {
    elDiscardCard.appendChild(cardSvgEmpty("svgCard"));
    elDiscardHint.textContent = "vuoto";
  
  }

  renderTableSeats(state); 
  renderHand(state);
  renderPending(state);
    // --- ANIMAZIONE PESCA: quando pending diventa attivo ---
  const nowPending = !!(state?.pendingDraw?.active && state.pendingDraw.card);

  if (!lastPendingActive && nowPending) {
    // source: deck o discard
    const fromEl = (state.pendingDraw.source === "discard") ? elDiscardCard : elDeckCard;

    // target: il contenitore dove mostri la carta pescata
    // (qui tu hai <span id="pendingCard"> ... </span>)
    // mettiamo un wrapper reale: il parent panel è ok
    const toEl = elPendingCard; // dove appendi la svg della carta pescata

    // Se il pending panel era display:none, prima mostralo (renderPending già lo fa)
    // poi animiamo
    flyBackCard(fromEl, toEl, { duration: 460, spin: 22, arc: -26 });
  }

  lastPendingActive = nowPending;
    if (
    state?.special?.active &&
    state.special.playerId === state.me?.id &&
    (state.special.type === "KING" || state.special.type === "HORSE")
  ) {
    clearTimeout(window.__retrySpecialTimer);
    window.__retrySpecialTimer = setTimeout(() => {
      if (
        lastState?.special?.active &&
        lastState.special.playerId === lastState.me?.id &&
        (lastState.special.type === "KING" || lastState.special.type === "HORSE")
      ) {
        handleMySpecial(lastState.special.type);
      }
    }, 300);
  }
}

/* ---------------- MANO ---------------- */

function renderHand(state) {
  elHand.innerHTML = "";
  const me = state.me;
  if (!state.started) {
  elHand.textContent = "In attesa che l'host avvii la partita...";
  return;
}
  if (!me) {
    elHand.textContent = "Attendo mano...";
    return;
  }

  const now = Date.now();
  const tempSeen = me.tempSeen || {};
  const revealActive = (me.revealEndsAt || 0) > now;

  me.hand.forEach((card, idx) => {
    const btn = document.createElement("button");
    btn.className = "cardBtn";
    btn.onclick = () => onMyCardClick(idx);

    const permanentlySeen = (me.seenCards || []).includes(idx);
    const temporarilySeen = (tempSeen[String(idx)] || 0) > now;

    // prime 2 visibili SOLO durante revealActive + fante visibile 10s
    const showFace = (permanentlySeen && revealActive) || temporarilySeen;

    let svg;
    if (!card) {
     svg = cardSvgEmpty();
     btn.disabled = true; // slot vuoto non cliccabile
    } else {
      svg = showFace ? cardSvgFace(card) : cardSvgBack();
    }
    if (newCardIdx.has(String(idx))) svg.classList.add("newCard");
    btn.appendChild(svg);
    elHand.appendChild(btn);
  });
}

function onMyCardClick(idx) {
  const gameId = document.getElementById("gameId").value.trim();

  // FANTE (8)
  if (lastState?.special?.active &&
      lastState.special.type === "LOOK" &&
      lastState.special.playerId === lastState.me?.id) {
    socket.emit("useLook", { gameId, handIndex: idx });
    return;
  }

  // swap
  if (lastState?.pendingDraw?.active) {
    socket.emit("playDrawn", { gameId, keep: true, swapIndex: idx });
    return;
  }

  // reazione
  if (lastState?.reaction?.active) {
    socket.emit("respondReaction", { gameId, handIndex: idx });
    return;
  }

  const ok = confirm("Vuoi provare a scartare (match) se è uguale all'ultima scartata?");
  if (!ok) return;

  socket.emit("tryMatchDiscard", { gameId, handIndex: idx });
}
function onOtherCardClick(targetId, handIndex) {
  const gameId = document.getElementById("gameId").value.trim();
  const ok = confirm("Vuoi provare a scartare questa carta dell'avversario?");
  if (!ok) return;

  socket.emit("tryMatchOtherDiscard", { gameId, targetId, handIndex });
}
function renderTableSeats(state) {
  tableEl.querySelectorAll(".seat").forEach(n => n.remove());

  const positions = ["pos-bottom","pos-top","pos-left","pos-right","pos-top-left","pos-top-right"];
  const currentId = state.players?.[state.currentPlayerIndex]?.id;
  const myId = state.me?.id;

  state.players.forEach((p, i) => {
    const seat = document.createElement("div");
    seat.className = `seat ${positions[i % positions.length]}`;

    const name = document.createElement("div");
    name.className = "nameTag" + (p.id === currentId ? " turn" : "");
    name.textContent = `${p.name} (${p.handCount})`;
    if (!state.started) {
     seat.appendChild(name);
     tableEl.appendChild(seat);
     return;
    }
    // ✅ slot visibili con buchi + click
    const slots = document.createElement("div");
    slots.className = "oppSlots";

    const arr = p.handSlots || [];     // array 0/1
    const maxSlots = Math.max(4, arr.length); // almeno 4 slot

    for (let k = 0; k < maxSlots; k++) {
      const occupied = arr[k] === 1;

      const btn = document.createElement("button");
      btn.className = "slotBtn" + (occupied ? "" : " empty");
      btn.disabled = (!occupied); // slot vuoto non cliccabile

      // non cliccare su te stesso dal seat (la tua mano la gestisci sotto)
      if (p.id !== myId && occupied) {
        btn.onclick = () => onOtherCardClick(p.id, k);
      } else {
        btn.onclick = null;
      }

      const back = document.createElement("div");
      back.className = "miniBack";
      btn.appendChild(back);

      slots.appendChild(btn);
    }

    seat.appendChild(name);
    seat.appendChild(slots);
    tableEl.appendChild(seat);
  });
}

/* ---------------- SVG CARDS ---------------- */

function suitMeta(seme) {
  switch (seme) {
    case "denari": return { bg: "#FFF3C4", icon: "◉" };
    case "coppe": return { bg: "#D7F2FF", icon: "◕" };
    case "bastoni": return { bg: "#DFFFE0", icon: "▮" };
    case "spade": return { bg: "#F3E1FF", icon: "✦" };
    default: return { bg: "#FFFFFF", icon: "?" };
  }
}

function cardSvgFace(card) {
  const { bg, icon } = suitMeta(card.seme);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 92 140");
  svg.classList.add("svgCard");

  svg.innerHTML = `
    <rect x="1" y="1" width="90" height="138" rx="16" fill="#fff" stroke="#ccc"/>
    <rect x="8" y="10" width="28" height="28" rx="8" fill="${bg}"/>
    <text x="22" y="30" text-anchor="middle" font-size="16" font-weight="800">${icon}</text>
    <text x="12" y="56" font-size="18" font-weight="900">${card.valore}</text>
    <text x="80" y="130" text-anchor="end" font-size="18" font-weight="900">${card.valore}</text>
  `;
  return svg;
}

function cardSvgBack() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 92 140");
  svg.classList.add("svgCard");

  svg.innerHTML = `
    <rect x="1" y="1" width="90" height="138" rx="16" fill="#111827"/>
    <text x="46" y="78" text-anchor="middle" font-size="16" font-weight="900" fill="white">ORZO</text>
  `;
  return svg;
}

function cardSvgEmpty() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 92 140");
  svg.classList.add("svgCard");

  svg.innerHTML = `
    <rect x="1" y="1" width="90" height="138" rx="16" fill="rgba(255,255,255,.1)" stroke="#ccc"/>
    <text x="46" y="76" text-anchor="middle" font-size="20" font-weight="900">—</text>
  `;
  return svg;
}
function renderPending(state) {
  if (state?.pendingDraw?.active && state.pendingDraw.card) {
    elPending.style.display = "block";
    elPendingCard.innerHTML = "";
    elPendingCard.appendChild(cardSvgFace(state.pendingDraw.card));
  } else {
    elPending.style.display = "none";
    elPendingCard.innerHTML = "";
  }
}
document.getElementById("startRevealBtn").onclick = () => {
  const gameId = document.getElementById("gameId").value.trim();
  socket.emit("startRoundReveal", { gameId });
};
document.getElementById("startBtn").onclick = () => {
  const gameId = document.getElementById("gameId").value.trim();

  socket.emit("startGame", { gameId }, (res) => {
    console.log("startGame callback:", res);
    if (!res?.ok) {
      alert(res?.error || "Errore avvio partita");
    }
  });
};
const roundModal = document.getElementById("roundModal");
const roundBoard = document.getElementById("roundBoard");
document.getElementById("closeRoundModal").onclick = () => (roundModal.style.display = "none");

socket.on("roundEnded", (payload) => {
  // payload.leaderboard = [{name, roundPts, totalPts, hand:[...]}, ...] già ordinato crescente
  roundBoard.innerHTML = "";

  payload.leaderboard.forEach((p, rank) => {
    const row = document.createElement("div");
    row.style.padding = "10px 8px";
    row.style.borderTop = "1px solid rgba(255,255,255,.08)";

    const head = document.createElement("div");
    head.innerHTML = `<b>#${rank+1} ${p.name}</b> — Round: <b>${p.roundPts}</b> — Totale: <b>${p.totalPts}</b>`;
    row.appendChild(head);

    const cards = document.createElement("div");
    cards.style.display = "flex";
    cards.style.gap = "8px";
    cards.style.flexWrap = "wrap";
    cards.style.marginTop = "8px";

    p.hand.forEach(c => {
      const svg = cardSvgFace(c);
      svg.classList.add("small"); // usa la tua classe .svgCard.small
      cards.appendChild(svg);
    });

    row.appendChild(cards);
    roundBoard.appendChild(row);
  });

  roundModal.style.display = "block";
});