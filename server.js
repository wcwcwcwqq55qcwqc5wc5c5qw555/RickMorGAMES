const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const STATE_RATE = 30;
const PRE_MATCH_SECONDS = 7;
const MATCH_DURATION = 120;
const FIELD = {
  width: 960,
  height: 560,
  playerRadius: 22,
  ballRadius: 12,
  goalDepth: 28,
  goalHeight: 150,
  playerSpeed: 285,
  ballFriction: 0.986,
  ballKick: 410,
  playerPush: 70
};
const AI_LEVELS = {
  easy: {
    label: 'Facil',
    speed: 0.72,
    reactionMs: 420,
    aimError: 70,
    attackLine: 560,
    homeX: 760,
    chaseBias: 0.42
  },
  normal: {
    label: 'Normal',
    speed: 0.9,
    reactionMs: 230,
    aimError: 34,
    attackLine: 510,
    homeX: 720,
    chaseBias: 0.62
  },
  hard: {
    label: 'Dificil',
    speed: 1.08,
    reactionMs: 110,
    aimError: 12,
    attackLine: 450,
    homeX: 680,
    chaseBias: 0.82
  }
};

const rooms = new Map();
let lastTick = Date.now();

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'phaser', 'dist')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));

function cleanName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  return value.slice(0, 18) || 'Jugador';
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeRoom(code) {
  return {
    code,
    mode: 'online',
    aiLevel: null,
    aiLastThinkAt: 0,
    players: [],
    inputs: {},
    rematchVotes: new Set(),
    status: 'waiting',
    countdownValue: null,
    countdownTimer: null,
    goalPauseUntil: 0,
    lastScorer: null,
    matchStartedAt: 0,
    elapsedBeforePause: 0,
    score: { blue: 0, red: 0 },
    state: defaultState()
  };
}

function defaultState() {
  return {
    players: {
      blue: { x: 225, y: FIELD.height / 2, vx: 0, vy: 0 },
      red: { x: FIELD.width - 225, y: FIELD.height / 2, vx: 0, vy: 0 }
    },
    ball: { x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0 }
  };
}

function publicRoomState(room) {
  return {
    code: room.code,
    mode: room.mode,
    aiLevel: room.aiLevel,
    status: room.status,
    countdown: room.countdownValue,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      side: player.side
    })),
    score: room.score,
    timeLeft: getTimeLeft(room),
    field: FIELD,
    state: room.state,
    lastScorer: room.lastScorer
  };
}

function playerSide(index) {
  return index === 0 ? 'blue' : 'red';
}

function normalizeAiLevel(level) {
  return AI_LEVELS[level] ? level : 'normal';
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((player) => player.id === socketId)) return room;
  }
  return null;
}

function getTimeLeft(room) {
  if (room.status === 'playing') {
    const elapsed = room.elapsedBeforePause + (Date.now() - room.matchStartedAt) / 1000;
    return Math.max(0, MATCH_DURATION - elapsed);
  }
  return Math.max(0, MATCH_DURATION - room.elapsedBeforePause);
}

function emitRoom(room, event, payload) {
  io.to(room.code).emit(event, payload);
}

function startCountdown(room) {
  if (room.countdownTimer) clearInterval(room.countdownTimer);
  room.status = 'countdown';
  room.countdownValue = PRE_MATCH_SECONDS;
  room.elapsedBeforePause = 0;
  emitRoom(room, 'roomState', publicRoomState(room));

  room.countdownTimer = setInterval(() => {
    if (!rooms.has(room.code) || room.players.length < 2) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      return;
    }

    room.countdownValue -= 1;
    if (room.countdownValue > 0) {
      emitRoom(room, 'roomState', publicRoomState(room));
      return;
    }

    if (room.countdownValue === 0) {
      room.countdownValue = 'GO';
      emitRoom(room, 'roomState', publicRoomState(room));
      return;
    }

    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
    room.countdownValue = null;
    room.status = 'playing';
    room.matchStartedAt = Date.now();
    emitRoom(room, 'matchStart', publicRoomState(room));
  }, 1000);
}

function resetPositions(room, scorer = null) {
  room.state = defaultState();
  if (scorer === 'blue') {
    room.state.ball.x = FIELD.width / 2 + 45;
  } else if (scorer === 'red') {
    room.state.ball.x = FIELD.width / 2 - 45;
  }
}

function startNewMatch(room) {
  room.score = { blue: 0, red: 0 };
  room.elapsedBeforePause = 0;
  room.goalPauseUntil = 0;
  room.lastScorer = null;
  room.rematchVotes.clear();
  room.aiLastThinkAt = 0;
  resetPositions(room);
  startCountdown(room);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function movePlayers(room, dt) {
  for (const player of room.players) {
    const side = player.side;
    const input = room.inputs[player.id] || {};
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;

    const current = room.state.players[side];
    const speedMultiplier = player.isCpu ? AI_LEVELS[room.aiLevel].speed : 1;
    const speed = FIELD.playerSpeed * speedMultiplier;
    current.vx = dx * speed;
    current.vy = dy * speed;
    current.x = clamp(current.x + current.vx * dt, FIELD.playerRadius, FIELD.width - FIELD.playerRadius);
    current.y = clamp(current.y + current.vy * dt, FIELD.playerRadius, FIELD.height - FIELD.playerRadius);
  }
}

function updateCpuInput(room) {
  if (room.mode !== 'cpu' || room.status !== 'playing') return;
  const cpu = room.players.find((item) => item.isCpu);
  if (!cpu) return;

  const level = AI_LEVELS[room.aiLevel];
  const now = Date.now();
  if (now - room.aiLastThinkAt < level.reactionMs) return;
  room.aiLastThinkAt = now;

  const cpuPos = room.state.players.red;
  const ball = room.state.ball;
  const defending = ball.x < level.attackLine && ball.vx <= 160;
  const goalTop = FIELD.height / 2 - FIELD.goalHeight / 2 + 28;
  const goalBottom = FIELD.height / 2 + FIELD.goalHeight / 2 - 28;
  let targetX;
  let targetY;

  if (defending) {
    targetX = level.homeX;
    targetY = clamp(ball.y, goalTop, goalBottom);
  } else {
    const behindBall = ball.x + 32 + (1 - level.chaseBias) * 70;
    targetX = clamp(behindBall, FIELD.width * 0.42, FIELD.width - FIELD.playerRadius);
    targetY = ball.y + Math.sin(now / 350) * level.aimError;
  }

  if (ball.x > cpuPos.x - 24) {
    targetX = ball.x;
    targetY = ball.y - Math.sign(ball.y - FIELD.height / 2 || 1) * level.aimError * 0.35;
  }

  const dx = targetX - cpuPos.x;
  const dy = targetY - cpuPos.y;
  const deadZone = 9 + level.aimError * 0.08;
  room.inputs[cpu.id] = {
    up: dy < -deadZone,
    down: dy > deadZone,
    left: dx < -deadZone,
    right: dx > deadZone
  };
}

function separatePlayers(room) {
  const a = room.state.players.blue;
  const b = room.state.players.red;
  const minDist = FIELD.playerRadius * 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  if (dist >= minDist) return;
  const overlap = (minDist - dist) / 2;
  const nx = dx / dist;
  const ny = dy / dist;
  a.x = clamp(a.x - nx * overlap, FIELD.playerRadius, FIELD.width - FIELD.playerRadius);
  a.y = clamp(a.y - ny * overlap, FIELD.playerRadius, FIELD.height - FIELD.playerRadius);
  b.x = clamp(b.x + nx * overlap, FIELD.playerRadius, FIELD.width - FIELD.playerRadius);
  b.y = clamp(b.y + ny * overlap, FIELD.playerRadius, FIELD.height - FIELD.playerRadius);
}

function collideBallWithPlayer(room, side) {
  const player = room.state.players[side];
  const ball = room.state.ball;
  const minDist = FIELD.playerRadius + FIELD.ballRadius;
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  if (dist >= minDist) return;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;

  const speedFromPlayer = Math.hypot(player.vx, player.vy);
  const impulse = FIELD.ballKick + speedFromPlayer * 0.55;
  ball.vx = nx * impulse + player.vx * 0.25;
  ball.vy = ny * impulse + player.vy * 0.25;
}

function moveBall(room, dt) {
  const ball = room.state.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.vx *= Math.pow(FIELD.ballFriction, dt * 60);
  ball.vy *= Math.pow(FIELD.ballFriction, dt * 60);

  const goalTop = FIELD.height / 2 - FIELD.goalHeight / 2;
  const goalBottom = FIELD.height / 2 + FIELD.goalHeight / 2;
  const insideGoalMouth = ball.y > goalTop + FIELD.ballRadius && ball.y < goalBottom - FIELD.ballRadius;

  if (insideGoalMouth && ball.x + FIELD.ballRadius < 0) {
    scoreGoal(room, 'red');
    return;
  }
  if (insideGoalMouth && ball.x - FIELD.ballRadius > FIELD.width) {
    scoreGoal(room, 'blue');
    return;
  }

  if (!insideGoalMouth && ball.x < FIELD.ballRadius) {
    ball.x = FIELD.ballRadius;
    ball.vx = Math.abs(ball.vx) * 0.78;
  }
  if (!insideGoalMouth && ball.x > FIELD.width - FIELD.ballRadius) {
    ball.x = FIELD.width - FIELD.ballRadius;
    ball.vx = -Math.abs(ball.vx) * 0.78;
  }
  if (ball.y < FIELD.ballRadius) {
    ball.y = FIELD.ballRadius;
    ball.vy = Math.abs(ball.vy) * 0.78;
  }
  if (ball.y > FIELD.height - FIELD.ballRadius) {
    ball.y = FIELD.height - FIELD.ballRadius;
    ball.vy = -Math.abs(ball.vy) * 0.78;
  }

  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed < 6) {
    ball.vx = 0;
    ball.vy = 0;
  }
}

function scoreGoal(room, scorer) {
  if (room.status !== 'playing') return;
  room.score[scorer] += 1;
  room.status = 'goal';
  room.lastScorer = scorer;
  room.elapsedBeforePause += (Date.now() - room.matchStartedAt) / 1000;
  room.goalPauseUntil = Date.now() + 2000;
  resetPositions(room, scorer);
  emitRoom(room, 'goal', publicRoomState(room));
}

function finishMatch(room) {
  room.status = 'finished';
  room.elapsedBeforePause = MATCH_DURATION;
  room.lastScorer = null;
  room.rematchVotes.clear();
  emitRoom(room, 'matchEnd', publicRoomState(room));
}

function tickRoom(room, dt) {
  if (room.status === 'goal') {
    if (Date.now() >= room.goalPauseUntil) {
      room.status = 'playing';
      room.matchStartedAt = Date.now();
      room.lastScorer = null;
      emitRoom(room, 'roomState', publicRoomState(room));
    }
    return;
  }

  if (room.status !== 'playing') return;

  if (getTimeLeft(room) <= 0) {
    finishMatch(room);
    return;
  }

  updateCpuInput(room);
  movePlayers(room, dt);
  separatePlayers(room);
  collideBallWithPlayer(room, 'blue');
  collideBallWithPlayer(room, 'red');
  moveBall(room, dt);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name } = {}, ack) => {
    handleDisconnect(socket);
    const code = makeRoomCode();
    const room = makeRoom(code);
    const player = { id: socket.id, name: cleanName(name), side: 'blue' };
    room.players.push(player);
    room.inputs[socket.id] = {};
    rooms.set(code, room);
    socket.join(code);
    ack?.({ ok: true, room: publicRoomState(room), player });
  });

  socket.on('createCpuMatch', ({ name, level } = {}, ack) => {
    handleDisconnect(socket);
    const code = makeRoomCode();
    const room = makeRoom(code);
    room.mode = 'cpu';
    room.aiLevel = normalizeAiLevel(level);

    const human = { id: socket.id, name: cleanName(name), side: 'blue' };
    const cpu = { id: `cpu:${code}`, name: `CPU ${AI_LEVELS[room.aiLevel].label}`, side: 'red', isCpu: true };
    room.players.push(human, cpu);
    room.inputs[human.id] = {};
    room.inputs[cpu.id] = {};
    rooms.set(code, room);
    socket.join(code);
    ack?.({ ok: true, room: publicRoomState(room), player: human });
    startNewMatch(room);
  });

  socket.on('joinRoom', ({ code, name } = {}, ack) => {
    handleDisconnect(socket);
    const normalized = String(code || '').trim().toUpperCase();
    const room = rooms.get(normalized);
    if (!room) {
      ack?.({ ok: false, error: 'La sala no existe. Revisa el codigo.' });
      return;
    }
    if (room.players.length >= 2) {
      ack?.({ ok: false, error: 'La sala ya esta llena.' });
      return;
    }

    const player = { id: socket.id, name: cleanName(name), side: playerSide(room.players.length) };
    room.players.push(player);
    room.inputs[socket.id] = {};
    socket.join(room.code);
    ack?.({ ok: true, room: publicRoomState(room), player });
    emitRoom(room, 'roomState', publicRoomState(room));
    startNewMatch(room);
  });

  socket.on('input', (input = {}) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    room.inputs[socket.id] = {
      up: Boolean(input.up),
      down: Boolean(input.down),
      left: Boolean(input.left),
      right: Boolean(input.right)
    };
  });

  socket.on('rematch', () => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.status !== 'finished') return;
    if (room.mode === 'cpu') {
      startNewMatch(room);
      return;
    }
    room.rematchVotes.add(socket.id);
    emitRoom(room, 'roomState', publicRoomState(room));
    if (room.players.length === 2 && room.players.every((player) => room.rematchVotes.has(player.id))) {
      startNewMatch(room);
    }
  });

  socket.on('leaveRoom', () => {
    handleDisconnect(socket);
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket);
  });
});

function handleDisconnect(socket) {
  const room = getRoomBySocket(socket.id);
  if (!room) return;

  room.players = room.players.filter((player) => player.id !== socket.id);
  delete room.inputs[socket.id];
  room.rematchVotes.delete(socket.id);
  socket.leave(room.code);

  if (room.mode === 'cpu' || room.players.length === 0) {
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    rooms.delete(room.code);
    return;
  }

  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
  room.status = 'abandoned';
  emitRoom(room, 'opponentLeft', publicRoomState(room));
}

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;
  for (const room of rooms.values()) tickRoom(room, dt);
}, 1000 / TICK_RATE);

setInterval(() => {
  for (const room of rooms.values()) {
    emitRoom(room, 'state', publicRoomState(room));
  }
}, 1000 / STATE_RATE);

server.listen(PORT, () => {
  console.log(`RicMor Soccers listo en http://localhost:${PORT}`);
});
