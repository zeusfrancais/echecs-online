const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SECRET = 'echecs_secret_key';
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const friends = {};
const waitingPlayer = { id: null, username: null };
const games = {};

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (users[username]) return res.json({ ok: false, msg: 'Pseudo déjà pris' });
  users[username] = { password: bcrypt.hashSync(password, 10) };
  friends[username] = [];
  res.json({ ok: true });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.json({ ok: false, msg: 'Identifiants incorrects' });
  const token = jwt.sign({ username }, SECRET);
  res.json({ ok: true, token, username });
});

app.post('/add-friend', (req, res) => {
  const { token, friendName } = req.body;
  try {
    const { username } = jwt.verify(token, SECRET);
    if (!users[friendName]) return res.json({ ok: false, msg: 'Joueur introuvable' });
    if (!friends[username].includes(friendName)) friends[username].push(friendName);
    if (!friends[friendName].includes(username)) friends[friendName].push(username);
    res.json({ ok: true });
  } catch { res.json({ ok: false, msg: 'Non autorisé' }); }
});

app.get('/friends', (req, res) => {
  const token = req.headers.authorization;
  try {
    const { username } = jwt.verify(token, SECRET);
    const list = (friends[username] || []).map(f => ({
      username: f,
      online: !!onlineUsers[f]
    }));
    res.json({ ok: true, friends: list });
  } catch { res.json({ ok: false }); }
});

const onlineUsers = {};

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const { username } = jwt.verify(token, SECRET);
    socket.username = username;
    next();
  } catch { next(new Error('Non autorisé')); }
});

io.on('connection', (socket) => {
  onlineUsers[socket.username] = socket.id;

  socket.on('invite-friend', ({ friendName }) => {
    const friendSocketId = onlineUsers[friendName];
    if (friendSocketId) {
      io.to(friendSocketId).emit('invited', { from: socket.username, fromId: socket.id });
    } else {
      socket.emit('friend-offline');
    }
  });

  socket.on('accept-invite', ({ fromId, fromName }) => {
    const gameId = socket.id + '_' + fromId;
    games[gameId] = { white: fromId, black: socket.id, board: null };
    io.to(fromId).emit('game-start', { gameId, color: 'w', opponent: socket.username });
    socket.emit('game-start', { gameId, color: 'b', opponent: fromName });
  });

  socket.on('join-random', () => {
    if (waitingPlayer.id && waitingPlayer.id !== socket.id) {
      const gameId = waitingPlayer.id + '_' + socket.id;
      games[gameId] = { white: waitingPlayer.id, black: socket.id };
      io.to(waitingPlayer.id).emit('game-start', { gameId, color: 'w', opponent: socket.username });
      socket.emit('game-start', { gameId, color: 'b', opponent: waitingPlayer.username });
      waitingPlayer.id = null;
      waitingPlayer.username = null;
    } else {
      waitingPlayer.id = socket.id;
      waitingPlayer.username = socket.username;
      socket.emit('waiting');
    }
  });

 socket.on('move', ({ gameId, from, to, promoType }) => {
    console.log('move reçu', gameId, 'games connus:', Object.keys(games));
    const game = games[gameId];
    if (!game) {
        console.log('partie introuvable!');
        return;
    }
    const opponentId = game.white === socket.id ? game.black : game.white;
    console.log('envoi coup à', opponentId);
    io.to(opponentId).emit('opponent-move', { from, to, promoType });
});

  socket.on('disconnect', () => {
    delete onlineUsers[socket.username];
    if (waitingPlayer.id === socket.id) {
      waitingPlayer.id = null;
      waitingPlayer.username = null;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Serveur lancé sur le port ' + PORT));