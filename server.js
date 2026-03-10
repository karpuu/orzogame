import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

import {
  createGame,
  joinGame,
  clearInitialReveal,
  getPublicStateForViewer,
  requestDraw,
  playDrawn,
  respondReaction,
  endReactionAndAdvanceTurn,
  declareSto,
  useLook,
  useKing,
  useHorse,
  tryMatchDiscard,
  tryMatchOtherDiscard,
  startGame,
  startRoundReveal
} from "./game.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const games = {}; // gameId -> game

function broadcastPersonalized(game) {
  // IMPORTANTISSIMO: mando uno stato diverso a ogni socket
  for (const p of game.players) {
    io.to(p.id).emit("update", getPublicStateForViewer(game, p.id));
  }
}

io.on("connection", (socket) => {
  socket.on("startGame", ({ gameId }, cb) => {
  const game = games[gameId];
  if (!game) {
    cb && cb({ ok: false, error: "Partita non trovata" });
    return socket.emit("errorMsg", "Partita non trovata");
  }

  const r = startGame(game, socket.id);
  if (!r.success) {
    cb && cb({ ok: false, error: r.message });
    return socket.emit("errorMsg", r.message);
  }

  // PRIMA aggiorna tutti: la partita è partita davvero
  broadcastPersonalized(game);

  // POI prova a far partire il reveal iniziale
  const r2 = startRoundReveal(game, socket.id);
  if (!r2.success) {
    cb && cb({ ok: false, error: r2.message });
    return socket.emit("errorMsg", r2.message);
  }

  // aggiorna di nuovo per far vedere le prime 2 carte
  broadcastPersonalized(game);

  for (const p of game.players) {
    setTimeout(() => {
      const g = games[gameId];
      if (!g) return;
      clearInitialReveal(g, p.id);
      broadcastPersonalized(g);
    }, 5000);
  }

  cb && cb({ ok: true });
});
  socket.on("tryMatchDiscard", ({ gameId, handIndex, targetId }) => {
  const game = games[gameId];
  if (!game) return socket.emit("errorMsg", "Partita non trovata");

  // NON permettere mentre è attivo uno speciale (opzionale ma consigliato)
  if (game.special) return socket.emit("errorMsg", "Prima risolvi il potere speciale");

  const r = tryMatchDiscard(game, socket.id, handIndex, targetId || null);
  if (!r.success) return socket.emit("errorMsg", r.message);

  broadcastPersonalized(game);
});
  socket.on("startRoundReveal", ({ gameId }) => {
  const game = games[gameId];
  if (!game) return socket.emit("errorMsg", "Partita non trovata");

  const r = startRoundReveal(game, socket.id);
  if (!r.success) return socket.emit("errorMsg", r.message);

  broadcastPersonalized(game);

  for (const p of game.players) {
    setTimeout(() => {
      const g = games[gameId];
      if (!g) return;
      clearInitialReveal(g, p.id);
      broadcastPersonalized(g);
    }, 5000);
  }
});
  socket.on("useLook", ({ gameId, handIndex }) => {
  const game = games[gameId];
  if (!game) return socket.emit("errorMsg", "Partita non trovata");

  const r = useLook(game, socket.id, handIndex);
  if (!r.success) return socket.emit("errorMsg", r.message);

  broadcastPersonalized(game);

  // parte reaction dopo speciale
  io.to(gameId).emit("reactionStarted", { value: game.reaction.value, endsAt: game.reaction.endsAt });
  setTimeout(() => {
    const g = games[gameId]; if (!g) return;
    const res = endReactionAndAdvanceTurn(g);
    broadcastPersonalized(g);

     if (res?.roundEnded) {
     io.to(gameId).emit("roundEnded", res.payload);
    }
    io.to(gameId).emit("reactionEnded");
  }, Math.max(0, game.reaction.endsAt - Date.now()));
});
socket.on("tryMatchOtherDiscard", ({ gameId, targetId, handIndex }) => {
  const game = games[gameId];
  if (!game) return socket.emit("errorMsg", "Partita non trovata");

  const r = tryMatchOtherDiscard(game, socket.id, targetId, handIndex);
  if (!r.success) return socket.emit("errorMsg", r.message);

  broadcastPersonalized(game);

  if (r.drew) io.to(r.drew.playerId).emit("cardsAdded", r.drew);
});
socket.on("useKing", ({ gameId, targetId }) => {
  const game = games[gameId];
  if (!game) return socket.emit("errorMsg", "Partita non trovata");

  const r = useKing(game, socket.id, targetId);
  if (!r.success) return socket.emit("errorMsg", r.message);

  broadcastPersonalized(game);
  io.to(gameId).emit("reactionStarted", { value: game.reaction.value, endsAt: game.reaction.endsAt });
  setTimeout(() => {
    const g = games[gameId]; if (!g) return;
    const res = endReactionAndAdvanceTurn(g);
    broadcastPersonalized(g);

    if (res?.roundEnded) {
     io.to(gameId).emit("roundEnded", res.payload);
    }
    io.to(gameId).emit("reactionEnded");
  }, Math.max(0, game.reaction.endsAt - Date.now()));
});

socket.on("useHorse", ({ gameId, myIndex, otherId, otherIndex }) => {
  const game = games[gameId];
  if (!game) return socket.emit("errorMsg", "Partita non trovata");

  const r = useHorse(game, socket.id, { myIndex, otherId, otherIndex });
  if (!r.success) return socket.emit("errorMsg", r.message);

  broadcastPersonalized(game);
  io.to(gameId).emit("reactionStarted", { value: game.reaction.value, endsAt: game.reaction.endsAt });
  setTimeout(() => {
    const g = games[gameId]; if (!g) return;
    const res = endReactionAndAdvanceTurn(g);
    broadcastPersonalized(g);

    if (res?.roundEnded) {
     io.to(gameId).emit("roundEnded", res.payload);
    }
    io.to(gameId).emit("reactionEnded");
  }, Math.max(0, game.reaction.endsAt - Date.now()));
});

  socket.on("createGame", (nickname, cb) => {
    const gameId = Math.random().toString(36).substring(2, 8);
    const game = createGame(gameId, socket.id, nickname || "Host");
    games[gameId] = game;

    socket.join(gameId);

    

    broadcastPersonalized(game);
    if (cb) cb({ gameId });
  });

  socket.on("joinGame", ({ gameId, nickname }, cb) => {
  const game = games[gameId];
  if (!game) return cb && cb({ error: "Partita non trovata" });

  const res = joinGame(game, socket.id, nickname || "Player");
  if (!res.success) return cb && cb({ error: res.message });

  socket.join(gameId);

  broadcastPersonalized(game);
  cb && cb({ ok: true });
});

  socket.on("requestDraw", ({ gameId, source }) => {
    const game = games[gameId];
    if (!game) return socket.emit("errorMsg", "Partita non trovata");

    const r = requestDraw(game, socket.id, source);
    if (!r.success) return socket.emit("errorMsg", r.message);

    broadcastPersonalized(game);
  });

  socket.on("playDrawn", ({ gameId, keep, swapIndex }) => {
  const game = games[gameId];
  if (!game) return socket.emit("errorMsg", "Partita non trovata");

  const r = playDrawn(game, socket.id, { keep, swapIndex });
  if (!r.success) return socket.emit("errorMsg", r.message);

  // aggiorna tutti
  broadcastPersonalized(game);

  // se parte uno speciale (8/9/10), niente reaction subito
  if (r.specialStarted) {
    io.to(gameId).emit("specialStarted", {
      type: game.special.type,
      playerId: game.special.playerId
    });
    return;
  }

  // reaction normale: fai vedere i 5 secondi
  io.to(gameId).emit("reactionStarted", {
    value: game.reaction.value,
    endsAt: game.reaction.endsAt
  });

  setTimeout(() => {
    const g = games[gameId];
    if (!g) return;

    const res = endReactionAndAdvanceTurn(g);
    broadcastPersonalized(g);

    if (res?.roundEnded) {
      io.to(gameId).emit("roundEnded", res.payload);
    }

    io.to(gameId).emit("reactionEnded");
  }, Math.max(0, game.reaction.endsAt - Date.now()));
});

  socket.on("respondReaction", ({ gameId, handIndex, targetId }) => {
  const game = games[gameId];
  if (!game) return socket.emit("errorMsg", "Partita non trovata");

  const r = respondReaction(game, socket.id, handIndex, targetId || null);
  if (!r.success) return socket.emit("errorMsg", r.message);

  // ✅ prima manda lo state aggiornato
  broadcastPersonalized(game);

  // ✅ poi manda l'evento animazione
  if (r.drew) {
  setTimeout(() => {
    io.to(r.drew.playerId).emit("cardsAdded", r.drew);
  }, 0);
}
});
  socket.on("declareSto", ({ gameId }, cb) => {
    const game = games[gameId];
    if (!game) return cb && cb({ ok: false, error: "Partita non trovata" });

    const r = declareSto(game, socket.id);
    if (!r.success) return cb && cb({ ok: false, error: r.message });

    broadcastPersonalized(game);
    cb && cb({ ok: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server on port", PORT))
