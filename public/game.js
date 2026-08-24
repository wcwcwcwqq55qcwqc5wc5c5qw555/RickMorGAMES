const socket = io();

const ui = {
  screens: {
    menu: document.getElementById('menu'),
    join: document.getElementById('joinScreen'),
    lobby: document.getElementById('lobby'),
    game: document.getElementById('gameScreen'),
    shooterSetup: document.getElementById('shooterSetup'),
    shooter: document.getElementById('shooterScreen')
  },
  playerName: document.getElementById('playerName'),
  cpuLevel: document.getElementById('cpuLevel'),
  gamePicker: document.getElementById('gamePicker'),
  footballOptions: document.getElementById('footballOptions'),
  footballGameBtn: document.getElementById('footballGameBtn'),
  shooterGameBtn: document.getElementById('shooterGameBtn'),
  backToGamesBtn: document.getElementById('backToGamesBtn'),
  shooterGameBtn: document.getElementById('shooterGameBtn'),
  shooterSetup: document.getElementById('shooterSetup'),
  joinName: document.getElementById('joinName'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  playCpuBtn: document.getElementById('playCpuBtn'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  showJoinBtn: document.getElementById('showJoinBtn'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  backFromJoinBtn: document.getElementById('backFromJoinBtn'),
  copyCodeBtn: document.getElementById('copyCodeBtn'),
  menuError: document.getElementById('menuError'),
  joinError: document.getElementById('joinError'),
  roomCode: document.getElementById('roomCode'),
  waitingText: document.getElementById('waitingText'),
  blueName: document.getElementById('blueName'),
  redName: document.getElementById('redName'),
  scoreText: document.getElementById('scoreText'),
  timer: document.getElementById('timer'),
  countdown: document.getElementById('countdown'),
  goalOverlay: document.getElementById('goalOverlay'),
  endOverlay: document.getElementById('endOverlay'),
  finalScore: document.getElementById('finalScore'),
  winnerText: document.getElementById('winnerText'),
  rematchBtn: document.getElementById('rematchBtn'),
  homeBtn: document.getElementById('homeBtn'),
  rematchStatus: document.getElementById('rematchStatus'),
  disconnectOverlay: document.getElementById('disconnectOverlay'),
  homeAfterDisconnectBtn: document.getElementById('homeAfterDisconnectBtn')
};

const localInput = { up: false, down: false, left: false, right: false };
const MATCH_INTRO_MS = 7000;
let player = null;
let currentRoom = null;
let game = null;
let sceneRef = null;
let lastSentInput = '';
let matchIntroRunning = false;
let matchIntroRoomCode = null;

function showScreen(name) {
  Object.entries(ui.screens).forEach(([key, element]) => {
    element.classList.toggle('active', key === name);
  });
}

function setBusy(isBusy) {
  ui.playCpuBtn.disabled = isBusy;
  ui.createRoomBtn.disabled = isBusy;
  ui.joinRoomBtn.disabled = isBusy;
}

function showGamePicker() {
  ui.gamePicker.classList.remove('hidden');
  ui.footballOptions.classList.add('hidden');
  ui.menuError.textContent = '';
}

function showFootballOptions() {
  ui.gamePicker.classList.add('hidden');
  ui.footballOptions.classList.remove('hidden');
  ui.menuError.textContent = '';
}

function getName(input) {
  return input.value.trim() || 'Jugador';
}

function normalizeCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
  const rest = String(safe % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function playerNameBySide(room, side) {
  return room.players.find((item) => item.side === side)?.name || (side === 'blue' ? 'Azul' : 'Rojo');
}

function updateHud(room) {
  currentRoom = room;
  ui.blueName.textContent = playerNameBySide(room, 'blue');
  ui.redName.textContent = playerNameBySide(room, 'red');
  ui.scoreText.textContent = `${room.score.blue} - ${room.score.red}`;
  ui.timer.textContent = formatClock(room.timeLeft);

  const countdownText = room.countdown === 'GO' ? '\u00a1GO!' : room.countdown;
  ui.countdown.textContent = countdownText || '';
  ui.countdown.classList.toggle('hidden', !room.countdown);

  if (room.status !== 'goal') ui.goalOverlay.classList.add('hidden');
  if (room.status !== 'finished') ui.endOverlay.classList.add('hidden');
}

function showGameNow(room) {
  showScreen('game');
  ensureGame();
  updateHud(room);
  ui.disconnectOverlay.classList.add('hidden');
}

function showGame(room) {
  currentRoom = room;
  if (matchIntroRunning) {
    return;
  }
  if (ui.screens.game.classList.contains('active')) {
    showGameNow(room);
    return;
  }

  matchIntroRunning = true;
  matchIntroRoomCode = room.code;
  document.body.classList.add('match-intro-active');
  setTimeout(() => {
    document.body.classList.remove('match-intro-active');
    matchIntroRunning = false;
    showGameNow(currentRoom || room);
  }, MATCH_INTRO_MS);
}

function showFinished(room) {
  updateHud(room);
  const blue = playerNameBySide(room, 'blue');
  const red = playerNameBySide(room, 'red');
  ui.finalScore.textContent = `${blue} ${room.score.blue} - ${room.score.red} ${red}`;
  if (room.score.blue === room.score.red) {
    ui.winnerText.textContent = 'EMPATE';
  } else {
    const winner = room.score.blue > room.score.red ? blue : red;
    ui.winnerText.textContent = `GANADOR: ${winner}`;
  }
  ui.rematchStatus.textContent = '';
  ui.rematchBtn.disabled = false;
  ui.rematchBtn.textContent = room.mode === 'cpu' ? 'JUGAR OTRA VEZ' : 'REVANCHA';
  ui.endOverlay.classList.remove('hidden');
}

function resetToHome() {
  socket.emit('leaveRoom');
  player = null;
  currentRoom = null;
  matchIntroRunning = false;
  matchIntroRoomCode = null;
  document.body.classList.remove('match-intro-active');
  Object.keys(localInput).forEach((key) => {
    localInput[key] = false;
  });
  ui.menuError.textContent = '';
  ui.joinError.textContent = '';
  ui.countdown.classList.add('hidden');
  ui.goalOverlay.classList.add('hidden');
  ui.endOverlay.classList.add('hidden');
  ui.disconnectOverlay.classList.add('hidden');
  showScreen('menu');
}

function ensureGame() {
  if (game) {
    setTimeout(() => game.scale.refresh(), 50);
    return;
  }

  class FutbolitoScene extends Phaser.Scene {
    constructor() {
      super('FutbolitoScene');
    }

    create() {
      sceneRef = this;
      this.field = this.add.graphics();
      this.entities = this.add.graphics();
      this.resize();
      this.scale.on('resize', () => this.resize());
    }

    resize() {
      this.scaleFactor = Math.min(this.scale.width / 960, this.scale.height / 560);
      this.offsetX = (this.scale.width - 960 * this.scaleFactor) / 2;
      this.offsetY = (this.scale.height - 560 * this.scaleFactor) / 2;
      this.drawField();
    }

    worldX(x) {
      return this.offsetX + x * this.scaleFactor;
    }

    worldY(y) {
      return this.offsetY + y * this.scaleFactor;
    }

    size(value) {
      return value * this.scaleFactor;
    }

    drawField() {
      const s = this.scaleFactor;
      const x = this.offsetX;
      const y = this.offsetY;
      const w = 960 * s;
      const h = 560 * s;
      const goalTop = y + (560 / 2 - 150 / 2) * s;
      const goalH = 150 * s;
      this.field.clear();
      this.field.fillStyle(0x118f46, 1);
      this.field.fillRect(x, y, w, h);

      for (let i = 0; i < 12; i += 1) {
        this.field.fillStyle(i % 2 === 0 ? 0x159b4f : 0x0f843f, 1);
        this.field.fillRect(x + (w / 12) * i, y, w / 12, h);
      }

      this.field.lineStyle(4 * s, 0xffffff, 0.88);
      this.field.strokeRect(x + 12 * s, y + 12 * s, w - 24 * s, h - 24 * s);
      this.field.lineBetween(x + w / 2, y + 12 * s, x + w / 2, y + h - 12 * s);
      this.field.strokeCircle(x + w / 2, y + h / 2, 78 * s);
      this.field.strokeRect(x + 12 * s, y + 156 * s, 128 * s, 248 * s);
      this.field.strokeRect(x + w - 140 * s, y + 156 * s, 128 * s, 248 * s);
      this.field.fillStyle(0xffffff, 0.92);
      this.field.fillRect(x - 9 * s, goalTop, 18 * s, goalH);
      this.field.fillRect(x + w - 9 * s, goalTop, 18 * s, goalH);
    }

    update() {
      if (!currentRoom?.state) return;
      const state = currentRoom.state;
      this.entities.clear();

      this.entities.lineStyle(this.size(3), 0xffffff, 0.8);
      this.entities.fillStyle(0xffffff, 1);
      this.entities.fillCircle(this.worldX(state.ball.x), this.worldY(state.ball.y), this.size(12));
      this.entities.lineStyle(this.size(2), 0x1b1b1b, 0.4);
      this.entities.strokeCircle(this.worldX(state.ball.x), this.worldY(state.ball.y), this.size(12));

      this.drawPlayer(state.players.blue, 0x2478ff, 'blue');
      this.drawPlayer(state.players.red, 0xf34848, 'red');
    }

    drawPlayer(position, color, side) {
      const isLocal = player?.side === side;
      this.entities.fillStyle(color, 1);
      this.entities.fillCircle(this.worldX(position.x), this.worldY(position.y), this.size(22));
      this.entities.lineStyle(this.size(isLocal ? 5 : 3), isLocal ? 0xffffff : 0x101010, isLocal ? 0.92 : 0.45);
      this.entities.strokeCircle(this.worldX(position.x), this.worldY(position.y), this.size(22));
    }
  }

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'gameCanvas',
    backgroundColor: '#0e7c3d',
    scale: {
      mode: Phaser.Scale.RESIZE,
      parent: 'gameCanvas',
      width: '100%',
      height: '100%'
    },
    scene: FutbolitoScene
  });
}

function sendInput() {
  if (!player) return;
  const serialized = JSON.stringify(localInput);
  if (serialized === lastSentInput) return;
  lastSentInput = serialized;
  socket.emit('input', localInput);
}

function setDirection(dir, value) {
  localInput[dir] = value;
  sendInput();
}

function bindTouchControls() {
  const joystick = document.getElementById('moveJoystick');
  const knob = document.getElementById('joystickKnob');
  if (!joystick || !knob) return;

  const directions = ['up', 'down', 'left', 'right'];
  const radius = 62;
  const deadZone = 12;
  let activePointerId = null;

  const reset = () => {
    activePointerId = null;
    knob.style.transform = 'translate(-50%, -50%)';
    directions.forEach((dir) => setDirection(dir, false));
  };

  const update = (event) => {
    const bounds = joystick.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    let x = event.clientX - centerX;
    let y = event.clientY - centerY;
    const distance = Math.hypot(x, y);
    if (distance > radius) {
      x = (x / distance) * radius;
      y = (y / distance) * radius;
    }
    knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    directions.forEach((dir) => setDirection(dir, false));
    if (distance < deadZone) return;
    setDirection('left', x < -deadZone);
    setDirection('right', x > deadZone);
    setDirection('up', y < -deadZone);
    setDirection('down', y > deadZone);
  };

  joystick.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activePointerId = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    update(event);
  });
  joystick.addEventListener('pointermove', (event) => {
    if (event.pointerId === activePointerId) update(event);
  });
  joystick.addEventListener('pointerup', (event) => {
    if (event.pointerId === activePointerId) reset();
  });
  joystick.addEventListener('pointercancel', reset);
}

function bindKeyboard() {
  const map = {
    KeyW: 'up',
    ArrowUp: 'up',
    KeyS: 'down',
    ArrowDown: 'down',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right'
  };

  window.addEventListener('keydown', (event) => {
    const dir = map[event.code];
    if (!dir) return;
    event.preventDefault();
    if (!localInput[dir]) setDirection(dir, true);
  });

  window.addEventListener('keyup', (event) => {
    const dir = map[event.code];
    if (!dir) return;
    event.preventDefault();
    setDirection(dir, false);
  });
}

ui.createRoomBtn.addEventListener('click', () => {
  setBusy(true);
  ui.menuError.textContent = '';
  socket.emit('createRoom', { name: getName(ui.playerName) }, (response) => {
    setBusy(false);
    if (!response?.ok) {
      ui.menuError.textContent = response?.error || 'No se pudo crear la sala.';
      return;
    }
    player = response.player;
    currentRoom = response.room;
    ui.roomCode.textContent = response.room.code;
    showScreen('lobby');
  });
});

ui.footballGameBtn.addEventListener('click', showFootballOptions);
ui.backToGamesBtn.addEventListener('click', showGamePicker);
ui.shooterGameBtn.addEventListener('click', () => {
  ui.menuError.textContent = 'DISPAROS EN MANTENIMIENTO';
});

ui.playCpuBtn.addEventListener('click', () => {
  setBusy(true);
  ui.menuError.textContent = '';
  socket.emit('createCpuMatch', { name: getName(ui.playerName), level: ui.cpuLevel.value }, (response) => {
    setBusy(false);
    if (!response?.ok) {
      ui.menuError.textContent = response?.error || 'No se pudo iniciar el partido contra CPU.';
      return;
    }
    player = response.player;
    currentRoom = response.room;
  });
});

ui.showJoinBtn.addEventListener('click', () => {
  ui.joinName.value = ui.playerName.value;
  ui.joinError.textContent = '';
  showScreen('join');
});

ui.backFromJoinBtn.addEventListener('click', () => showScreen('menu'));

ui.joinRoomBtn.addEventListener('click', () => {
  const code = normalizeCode(ui.roomCodeInput.value);
  ui.roomCodeInput.value = code;
  ui.joinError.textContent = '';
  if (code.length !== 6) {
    ui.joinError.textContent = 'Escribe un codigo de sala de 6 caracteres.';
    return;
  }

  setBusy(true);
  socket.emit('joinRoom', { code, name: getName(ui.joinName) }, (response) => {
    setBusy(false);
    if (!response?.ok) {
      ui.joinError.textContent = response?.error || 'No se pudo entrar a la sala.';
      return;
    }
    player = response.player;
    currentRoom = response.room;
  });
});

ui.roomCodeInput.addEventListener('input', () => {
  ui.roomCodeInput.value = normalizeCode(ui.roomCodeInput.value);
});

ui.copyCodeBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ui.roomCode.textContent);
    ui.copyCodeBtn.textContent = 'COPIADO';
    setTimeout(() => {
      ui.copyCodeBtn.textContent = 'COPIAR CODIGO';
    }, 1200);
  } catch {
    ui.copyCodeBtn.textContent = ui.roomCode.textContent;
  }
});

ui.rematchBtn.addEventListener('click', () => {
  ui.rematchBtn.disabled = true;
  ui.rematchStatus.textContent = currentRoom?.mode === 'cpu'
    ? 'Preparando otro partido...'
    : 'Esperando que tu rival acepte la revancha...';
  socket.emit('rematch');
});

ui.homeBtn.addEventListener('click', resetToHome);
ui.homeAfterDisconnectBtn.addEventListener('click', resetToHome);

socket.on('roomState', (room) => {
  currentRoom = room;
  if (room.status === 'waiting') {
    ui.roomCode.textContent = room.code;
    showScreen('lobby');
    return;
  }
  if (room.status === 'countdown' || room.status === 'playing' || room.status === 'goal') {
    showGame(room);
  }
});

socket.on('matchStart', (room) => {
  currentRoom = room;
  if (!matchIntroRunning || matchIntroRoomCode !== room.code) {
    showGame(room);
  }
});
socket.on('state', (room) => {
  if (!player || room.code !== currentRoom?.code) return;
  currentRoom = room;
  if (ui.screens.game.classList.contains('active')) updateHud(room);
});

socket.on('goal', (room) => {
  showGame(room);
  ui.goalOverlay.classList.remove('hidden');
});

socket.on('matchEnd', (room) => {
  showGame(room);
  showFinished(room);
});

socket.on('opponentLeft', (room) => {
  currentRoom = room;
  showScreen('game');
  ensureGame();
  ui.countdown.classList.add('hidden');
  ui.goalOverlay.classList.add('hidden');
  ui.endOverlay.classList.add('hidden');
  ui.disconnectOverlay.classList.remove('hidden');
});

window.addEventListener('beforeunload', () => {
  socket.emit('leaveRoom');
});

bindKeyboard();
bindTouchControls();
showScreen('menu');
