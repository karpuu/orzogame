// server.js (snippet; integra nel tuo file esistente)
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { createGame, joinGame, requestDraw, playDrawn, respondToReaction, endReaction, declareSto, getPublicState } from "./game.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const games = {}; // gameId -> game state

// helper broadcast per-player (stato PERSONALIZZATO)
function broadcastGame(game) {
  for (const p of game.players) {
    io.to(p.id).emit("update", getPublicState(game, p.id));
  }
}

io.on("connection", (socket) => {
  console.log("connesso", socket.id);

  socket.on("createGame", (nickname, cb) => {
    const gameId = Math.random().toString(36).substring(2, 8);
    const game = createGame(gameId, socket.id, nickname || "Host");
    games[gameId] = game;
    socket.join(gameId);
    // clear seenCards after 10s
    setTimeout(() => {
      const g = games[gameId];
      if (!g) return;
      const host = g.players.find(p => p.id === socket.id);
      if (host) host.seenCards = [];
      broadcastGame(g);
    }, 10000);
    broadcastGame(game);
    if (cb) cb({ gameId, state: getPublicState(game, socket.id) });
  });

  socket.on("joinGame", ({ gameId, nickname }, cb) => {
    const game = games[gameId];
    if (!game) return cb && cb({ error: "Partita non trovata" });
    const res = joinGame(game, socket.id, nickname || "Player");
    if (!res.success) return cb && cb({ error: res.message });
    socket.join(gameId);
    // clear seenCards of new player after 10s
    setTimeout(() => {
      const g = games[gameId];
      if (!g) return;
      const p = g.players.find(x => x.id === socket.id);
      if (p) p.seenCards = [];
      broadcastGame(g);
    }, 10000);
    broadcastGame(game);
    if (cb) cb({ state: getPublicState(game, socket.id) });
  });

  socket.on("requestDraw", ({ gameId, source }) => {
    const game = games[gameId];
    if (!game) return socket.emit("errorMsg", "Partita non trovata");
    const r = requestDraw(game, socket.id, source);
    if (!r.success) return socket.emit("errorMsg", r.message);
    // invia la carta pescata SOLO al giocatore che ha pescato
    socket.emit("drawn", r.card);
    broadcastGame(game);
  });

  socket.on("playDrawn", ({ gameId, keep, swapIndex }) => {
    const game = games[gameId];
    if (!game) return socket.emit("errorMsg", "Partita non trovata");
    const r = playDrawn(game, socket.id, { keep, swapIndex });
    if (!r.success) return socket.emit("errorMsg", r.message);
    // notifica a tutti che è partita una reaction e l'ultimo scarto
    broadcastGame(game);
    if (r.reactionStarted) {
      io.to(gameId).emit("reactionStarted", { value: r.value });
      // apri window per le reazioni (es. 5 secondi)
      setTimeout(() => {
        endReaction(game);
        broadcastGame(game);
        io.to(gameId).emit("reactionEnded");
      }, 5000);
    }
  });

  socket.on("respondReaction", ({ gameId, handIndex, targetId }) => {
    const game = games[gameId];
    if (!game) return socket.emit("errorMsg", "Partita non trovata");
    const r = respondToReaction(game, socket.id, handIndex, targetId);
    if (!r.success) return socket.emit("errorMsg", r.message);
    broadcastGame(game);
  });

  socket.on("declareSto", ({ gameId }) => {
    const game = games[gameId];
    if (!game) return socket.emit("errorMsg", "Partita non trovata");
    declareSto(game, socket.id);
    broadcastGame(game);
  });

  socket.on("disconnect", () => {
    // opzionale: gestire sconnesioni / rimozione giocatori
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server avviato su port", process.env.PORT || 3000);
});
