"use strict";

const gameCanvas = document.getElementById("game");
const gameCtx = gameCanvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nextCtx = nextCanvas.getContext("2d");

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");
const timeEl = document.getElementById("time");
const dangerFill = document.getElementById("dangerFill");
const pauseBtn = document.getElementById("pauseBtn");
const startScreen = document.getElementById("startScreen");

const COLS = 160;
const ROWS = 240;
const SCALE = 3;
const BLOCK = 16;
const MOVE_STEP = 8;
const HARD_DROP_COOLDOWN_MS = 220;
const SAND_STEPS = 1;
const SAND_MOVE_RATE = 5;
const FRESH_FLOAT_BASE = 8;
const FRESH_FLOAT_SPREAD = 22;
const BEST_KEY = "sandtrix-best-v4";

gameCanvas.width = COLS * SCALE;
gameCanvas.height = ROWS * SCALE;

const grainCanvas = document.createElement("canvas");
grainCanvas.width = COLS;
grainCanvas.height = ROWS;
const grainCtx = grainCanvas.getContext("2d");
const image = grainCtx.createImageData(COLS, ROWS);

const board = new Uint8Array(COLS * ROWS);
const shade = new Uint8Array(COLS * ROWS);
const floatDelay = new Uint8Array(COLS * ROWS);
const visited = new Uint8Array(COLS * ROWS);
const clearMarks = new Uint8Array(COLS * ROWS);
const flashMap = new Uint8Array(COLS * ROWS);
const searchQueue = new Int32Array(COLS * ROWS);

const PALETTE = [
  null,
  ["#e15a37", "#c9472c", "#f07348", "#aa3a29"],
  ["#4e88d6", "#3971b9", "#6aa0e8", "#2f5f9d"],
  ["#89d06f", "#70b956", "#a0df84", "#579a45"],
  ["#f0c54d", "#d8aa36", "#ffd96d", "#b4872b"]
];

const RGB = PALETTE.map((set) => {
  if (!set) return null;
  return set.map((hex) => {
    const raw = hex.slice(1);
    return [
      Number.parseInt(raw.slice(0, 2), 16),
      Number.parseInt(raw.slice(2, 4), 16),
      Number.parseInt(raw.slice(4, 6), 16)
    ];
  });
});

const SHAPES = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]]
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]]
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]]
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]]
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]]
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]]
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]]
  ]
};

const BAG_KEYS = Object.keys(SHAPES);
const COLOR_BY_SHAPE = {
  I: 2,
  O: 4,
  T: 1,
  L: 4,
  J: 2,
  S: 3,
  Z: 1
};

let bag = [];
let active = null;
let nextPiece = null;
let score = 0;
let lines = 0;
let level = 1;
let best = Number(localStorage.getItem(BEST_KEY) || 0);
let gameStarted = false;
let running = false;
let gameOver = false;
let elapsed = 0;
let dropRemainder = 0;
let lastTime = performance.now();
let frame = 0;
let touchState = null;
let nextHardDropAt = 0;
let audioCtx = null;
let audioUnlocked = false;

bestEl.textContent = String(best);

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) audioCtx = new AudioContextClass();
  return audioCtx;
}

function unlockAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const wasUnlocked = audioUnlocked;
  audioUnlocked = true;
  if (!wasUnlocked) primeAudio(ctx);
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

function primeAudio(ctx) {
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(ctx.currentTime);
}

function makeGain(ctx, volume, start, duration) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  gain.connect(ctx.destination);
  return gain;
}

function playTone(frequency, duration, volume, type = "square", when = 0, endFrequency = frequency) {
  if (!audioUnlocked) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const start = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = makeGain(ctx, volume, start, duration);
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(endFrequency, 1), start + duration);
  osc.connect(gain);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function playNoise(duration, volume, when = 0, filterFrequency = 420) {
  if (!audioUnlocked) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const start = ctx.currentTime + when;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = makeGain(ctx, volume, start, duration);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFrequency, start);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  source.start(start);
  source.stop(start + duration + 0.02);
}

function playLockSound() {
  playTone(132, 0.09, 0.075, "triangle", 0, 84);
  playNoise(0.06, 0.055, 0, 360);
}

function playClearSound(groups) {
  const notes = [392, 523, 659, 784];
  const count = Math.min(notes.length, 2 + groups);
  for (let i = 0; i < count; i += 1) {
    playTone(notes[i], 0.11, 0.07, "square", i * 0.055, notes[i] * 1.12);
  }
  playNoise(0.14, 0.035, 0.02, 1800);
}

function playRotateSound() {
  playTone(520, 0.035, 0.035, "square", 0, 620);
}

function playHardDropSound() {
  playTone(260, 0.08, 0.055, "sawtooth", 0, 120);
}

function playStartSound() {
  playTone(330, 0.08, 0.045, "square", 0, 440);
  playTone(660, 0.09, 0.04, "square", 0.08, 740);
}

function refillBag() {
  bag = [...BAG_KEYS];
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
}

function takeFromBag() {
  if (bag.length === 0) refillBag();
  return bag.pop();
}

function makePiece(name) {
  return {
    name,
    color: COLOR_BY_SHAPE[name],
    rotation: 0,
    x: Math.floor((COLS - BLOCK * 4) / 2),
    y: -BLOCK * 3,
    seed: randomInt(4096)
  };
}

function cellsFor(piece, rotation = piece.rotation) {
  return SHAPES[piece.name][rotation % 4];
}

function cellBlocked(x, y) {
  if (x < 0 || x >= COLS || y >= ROWS) return true;
  if (y < 0) return false;
  return board[y * COLS + x] !== 0;
}

function collides(piece, x = piece.x, y = piece.y, rotation = piece.rotation) {
  const cells = cellsFor(piece, rotation);
  for (const [cx, cy] of cells) {
    const ox = x + cx * BLOCK;
    const oy = y + cy * BLOCK;
    for (let yy = 0; yy < BLOCK; yy += 1) {
      for (let xx = 0; xx < BLOCK; xx += 1) {
        if (cellBlocked(ox + xx, oy + yy)) return true;
      }
    }
  }
  return false;
}

function spawnPiece() {
  active = nextPiece || makePiece(takeFromBag());
  active.x = Math.floor((COLS - BLOCK * 4) / 2);
  active.y = -BLOCK * 3;
  active.rotation = 0;
  active.seed = randomInt(4096);
  nextPiece = makePiece(takeFromBag());
  drawNext();

  if (collides(active)) {
    gameOver = true;
    running = false;
    updateUi();
  }
}

function grainShade(piece, gx, gy, edge) {
  if (edge) return 2;
  const noise = (gx * 37 + gy * 53 + piece.seed * 11) & 15;
  if (noise < 2) return 3;
  if (noise < 6) return 1;
  return 0;
}

function lockPiece() {
  let placedInside = false;
  let placedAboveTop = false;
  for (const [cx, cy] of cellsFor(active)) {
    const ox = active.x + cx * BLOCK;
    const oy = active.y + cy * BLOCK;
    for (let yy = 0; yy < BLOCK; yy += 1) {
      for (let xx = 0; xx < BLOCK; xx += 1) {
        const gx = ox + xx;
        const gy = oy + yy;
        if (gy < 0) {
          placedAboveTop = true;
          continue;
        }
        if (gx < 0 || gx >= COLS || gy >= ROWS) continue;
        const idx = gy * COLS + gx;
        board[idx] = active.color;
        shade[idx] = grainShade(active, gx, gy, xx === 0 || yy === 0);
        floatDelay[idx] = freshFloatDelay(active, cx, cy, xx, yy, gx, gy);
        placedInside = true;
      }
    }
  }

  if (!placedInside || placedAboveTop) {
    gameOver = true;
    running = false;
    updateUi();
    return;
  }

  score += 12;
  playLockSound();
  scanClears();
  spawnPiece();
}

function tryMove(dx, dy) {
  if (!active || !running || gameOver) return false;
  if (!collides(active, active.x + dx, active.y + dy)) {
    active.x += dx;
    active.y += dy;
    return true;
  }
  if (dy > 0) lockPiece();
  return false;
}

function tryRotate() {
  if (!active || !running || gameOver) return;
  const nextRotation = (active.rotation + 1) % 4;
  const kicks = [0, -MOVE_STEP, MOVE_STEP, -BLOCK, BLOCK, -BLOCK * 2, BLOCK * 2];
  for (const kick of kicks) {
    if (!collides(active, active.x + kick, active.y, nextRotation)) {
      active.x += kick;
      active.rotation = nextRotation;
      playRotateSound();
      return;
    }
  }
}

function hardDrop() {
  if (!active || !running || gameOver) return;
  const now = performance.now();
  if (now < nextHardDropAt) return;
  nextHardDropAt = now + HARD_DROP_COOLDOWN_MS;

  let distance = 0;
  while (!collides(active, active.x, active.y + 1)) {
    active.y += 1;
    distance += 1;
  }
  score += Math.floor(distance / 2);
  playHardDropSound();
  lockPiece();
}

function softDrop() {
  if (tryMove(0, 3)) score += 1;
}

function swapCells(a, b) {
  board[b] = board[a];
  shade[b] = shade[a];
  floatDelay[b] = floatDelay[a];
  board[a] = 0;
  shade[a] = 0;
  floatDelay[a] = 0;
}

function updateSand() {
  for (let step = 0; step < SAND_STEPS; step += 1) {
    const leftFirst = ((frame + step) & 1) === 0;
    for (let y = ROWS - 2; y >= 0; y -= 1) {
      if (leftFirst) {
        for (let x = 0; x < COLS; x += 1) settleAt(x, y, step);
      } else {
        for (let x = COLS - 1; x >= 0; x -= 1) settleAt(x, y, step);
      }
    }
  }
}

function settleAt(x, y, step) {
  const idx = y * COLS + x;
  if (board[idx] === 0) return;
  if (floatDelay[idx] > 0) {
    floatDelay[idx] -= 1;
    return;
  }
  if (!canMoveThisFrame(idx, step)) return;

  const below = idx + COLS;
  if (board[below] === 0) {
    swapCells(idx, below);
    return;
  }

  const preferLeft = ((x + y + frame + step) & 1) === 0;
  const d1 = preferLeft ? -1 : 1;
  const d2 = -d1;

  if (canSlip(x, below, d1)) {
    swapCells(idx, below + d1);
  } else if (canSlip(x, below, d2)) {
    swapCells(idx, below + d2);
  }
}

function canSlip(x, below, dir) {
  const nx = x + dir;
  return nx >= 0 && nx < COLS && board[below + dir] === 0;
}

function freshFloatDelay(piece, cx, cy, xx, yy, gx, gy) {
  const localY = cy * BLOCK + yy;
  const topLift = Math.floor((BLOCK * 4 - localY) * 0.32);
  const noise = (gx * 19 + gy * 23 + xx * 7 + piece.seed) % FRESH_FLOAT_SPREAD;
  return FRESH_FLOAT_BASE + topLift + noise;
}

function canMoveThisFrame(idx, step) {
  return ((idx * 13 + frame * 11 + step * 7) & 7) < SAND_MOVE_RATE;
}

function scanClears() {
  visited.fill(0);
  clearMarks.fill(0);

  let clearedCells = 0;
  let clearedGroups = 0;

  for (let y = 0; y < ROWS; y += 1) {
    const start = y * COLS;
    const color = board[start];
    if (color === 0 || visited[start] !== 0) continue;

    const component = traceSameColorComponent(start, color);
    if (!component.reachesRight) continue;

    clearedGroups += 1;
    for (let i = 0; i < component.length; i += 1) {
      const idx = searchQueue[i];
      clearMarks[idx] = 1;
      clearedCells += 1;
    }
  }

  if (clearedCells === 0) return;

  for (let idx = 0; idx < board.length; idx += 1) {
    if (clearMarks[idx] === 0) continue;
    board[idx] = 0;
    shade[idx] = 0;
    floatDelay[idx] = 0;
    flashMap[idx] = 18;
  }

  lines += clearedGroups;
  level = 1 + Math.floor(lines / 5);
  score += Math.round(clearedCells * clearedGroups * 0.75 * level);
  playClearSound(clearedGroups);
}

function traceSameColorComponent(start, color) {
  let head = 0;
  let tail = 0;
  let reachesRight = false;

  const queueNeighbor = (idx, inBounds) => {
    if (!inBounds || visited[idx] !== 0 || board[idx] !== color) return;
    visited[idx] = 1;
    searchQueue[tail] = idx;
    tail += 1;
  };

  searchQueue[tail] = start;
  tail += 1;
  visited[start] = 1;

  while (head < tail) {
    const idx = searchQueue[head];
    head += 1;

    const x = idx % COLS;
    if (x === COLS - 1) reachesRight = true;

    const hasUp = idx >= COLS;
    const hasDown = idx < COLS * (ROWS - 1);
    const hasLeft = x > 0;
    const hasRight = x < COLS - 1;

    queueNeighbor(idx - COLS, hasUp);
    queueNeighbor(idx + COLS, hasDown);
    queueNeighbor(idx - 1, hasLeft);
    queueNeighbor(idx + 1, hasRight);
    queueNeighbor(idx - COLS - 1, hasUp && hasLeft);
    queueNeighbor(idx - COLS + 1, hasUp && hasRight);
    queueNeighbor(idx + COLS - 1, hasDown && hasLeft);
    queueNeighbor(idx + COLS + 1, hasDown && hasRight);
  }

  return { length: tail, reachesRight };
}

function highestPileRatio() {
  for (let y = 0; y < ROWS; y += 1) {
    const row = y * COLS;
    for (let x = 0; x < COLS; x += 1) {
      if (board[row + x] !== 0) {
        return 1 - y / ROWS;
      }
    }
  }
  return 0;
}

function updateUi() {
  scoreEl.textContent = String(score);
  linesEl.textContent = String(lines);
  levelEl.textContent = String(level);
  dangerFill.style.width = `${Math.round(highestPileRatio() * 100)}%`;

  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
    bestEl.textContent = String(best);
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);
  timeEl.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  pauseBtn.textContent = running ? "||" : ">";
}

function paintPixel(data, idx, rgb) {
  data[idx] = rgb[0];
  data[idx + 1] = rgb[1];
  data[idx + 2] = rgb[2];
  data[idx + 3] = 255;
}

function render() {
  const data = image.data;
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const idx = y * COLS + x;
      const pixel = idx * 4;
      const color = board[idx];
      if (color !== 0) {
        paintPixel(data, pixel, RGB[color][shade[idx] % 4]);
      } else {
        const n = ((x * 13 + y * 7) & 31) < 1 ? 17 : 14;
        data[pixel] = n;
        data[pixel + 1] = n + 1;
        data[pixel + 2] = n + 2;
        data[pixel + 3] = 255;
      }
    }
  }

  if (active && !gameOver) paintActive(data);

  grainCtx.putImageData(image, 0, 0);
  gameCtx.imageSmoothingEnabled = false;
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  gameCtx.drawImage(grainCanvas, 0, 0, gameCanvas.width, gameCanvas.height);
  drawScanLines();
  drawFlashes();

  if (gameOver) drawBanner("GAME OVER");
  else if (gameStarted && !running) drawBanner("PAUSED");
}

function paintActive(data) {
  for (const [cx, cy] of cellsFor(active)) {
    const ox = active.x + cx * BLOCK;
    const oy = active.y + cy * BLOCK;
    for (let yy = 0; yy < BLOCK; yy += 1) {
      for (let xx = 0; xx < BLOCK; xx += 1) {
        const gx = ox + xx;
        const gy = oy + yy;
        if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) continue;
        const edge = xx === 0 || yy === 0 || xx === BLOCK - 1 || yy === BLOCK - 1;
        const idx = (gy * COLS + gx) * 4;
        paintPixel(data, idx, RGB[active.color][grainShade(active, gx, gy, edge)]);
      }
    }
  }
}

function drawScanLines() {
  gameCtx.save();
  gameCtx.globalAlpha = 0.16;
  gameCtx.fillStyle = "#000";
  for (let y = 0; y < gameCanvas.height; y += SCALE * 4) {
    gameCtx.fillRect(0, y, gameCanvas.width, SCALE);
  }
  gameCtx.restore();
}

function drawFlashes() {
  gameCtx.save();
  for (let idx = 0; idx < flashMap.length; idx += 1) {
    const life = flashMap[idx];
    if (life === 0) continue;
    const alpha = life / 18;
    gameCtx.globalAlpha = alpha;
    gameCtx.fillStyle = "#fff9cc";
    gameCtx.fillRect((idx % COLS) * SCALE, Math.floor(idx / COLS) * SCALE, SCALE, SCALE);
    flashMap[idx] = life - 1;
  }
  gameCtx.restore();
}

function drawBanner(text) {
  gameCtx.save();
  gameCtx.fillStyle = "rgba(0, 0, 0, 0.72)";
  gameCtx.fillRect(0, gameCanvas.height * 0.42, gameCanvas.width, 82);
  gameCtx.fillStyle = "#eef4eb";
  gameCtx.font = '900 34px "Courier New", monospace';
  gameCtx.textAlign = "center";
  gameCtx.textBaseline = "middle";
  gameCtx.fillText(text, gameCanvas.width / 2, gameCanvas.height * 0.42 + 41);
  gameCtx.restore();
}

function drawNext() {
  const piece = nextPiece;
  nextCtx.imageSmoothingEnabled = false;
  nextCtx.fillStyle = "#111";
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (!piece) return;

  const cells = cellsFor(piece, 0);
  const size = 20;
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = (maxX - minX + 1) * size;
  const height = (maxY - minY + 1) * size;
  const startX = Math.floor((nextCanvas.width - width) / 2);
  const startY = Math.floor((nextCanvas.height - height) / 2);

  for (const [cx, cy] of cells) {
    const x = startX + (cx - minX) * size;
    const y = startY + (cy - minY) * size;
    nextCtx.fillStyle = PALETTE[piece.color][0];
    nextCtx.fillRect(x, y, size, size);
    nextCtx.fillStyle = PALETTE[piece.color][2];
    nextCtx.fillRect(x, y, size, 4);
    nextCtx.fillRect(x, y, 4, size);
    nextCtx.fillStyle = PALETTE[piece.color][1];
    nextCtx.fillRect(x + size - 4, y, 4, size);
    nextCtx.fillRect(x, y + size - 4, size, 4);
  }
}

function resetGame(startRunning = true) {
  board.fill(0);
  shade.fill(0);
  floatDelay.fill(0);
  bag = [];
  active = null;
  nextPiece = null;
  score = 0;
  lines = 0;
  level = 1;
  elapsed = 0;
  dropRemainder = 0;
  frame = 0;
  nextHardDropAt = 0;
  flashMap.fill(0);
  running = startRunning;
  gameOver = false;
  nextPiece = makePiece(takeFromBag());
  spawnPiece();
  updateUi();
}

function startGame() {
  if (gameStarted) return;
  unlockAudio();
  gameStarted = true;
  startScreen.classList.add("hidden");
  resetGame(true);
  lastTime = performance.now();
  playStartSound();
}

function setPaused(value) {
  if (gameOver) return;
  running = !value;
  updateUi();
}

function togglePause() {
  if (gameOver) {
    resetGame();
    return;
  }
  if (!gameStarted) return;
  setPaused(running);
}

function update(dt) {
  if (!running || gameOver) return;
  elapsed += dt;
  frame += 1;

  updateSand();

  const fallSpeed = 22 + (level - 1) * 5;
  dropRemainder += dt * fallSpeed;
  while (dropRemainder >= 1 && active && running) {
    if (!tryMove(0, 1)) {
      dropRemainder = 0;
      break;
    }
    dropRemainder -= 1;
  }

  if (frame % 18 === 0) scanClears();
  if (frame % 8 === 0) updateUi();
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

document.addEventListener("keydown", (event) => {
  const key = event.key;
  if (!gameStarted) {
    event.preventDefault();
    startGame();
    return;
  }

  if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " ", "p", "P", "x", "X"].includes(key)) {
    event.preventDefault();
    unlockAudio();
  }

  if (key === "ArrowLeft" || key === "a" || key === "A") tryMove(-MOVE_STEP, 0);
  else if (key === "ArrowRight" || key === "d" || key === "D") tryMove(MOVE_STEP, 0);
  else if (key === "ArrowDown" || key === "s" || key === "S") softDrop();
  else if (key === "ArrowUp" || key === "x" || key === "X") tryRotate();
  else if (key === " " && !event.repeat) hardDrop();
  else if (key === "p" || key === "P") togglePause();
});

function bindHold(id, action, repeatMs = 86) {
  const button = document.getElementById(id);
  let timer = 0;

  const stop = () => {
    if (timer) window.clearInterval(timer);
    timer = 0;
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    unlockAudio();
    button.setPointerCapture(event.pointerId);
    action();
    stop();
    timer = window.setInterval(action, repeatMs);
  });

  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("pointerleave", stop);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

bindHold("leftBtn", () => tryMove(-MOVE_STEP, 0));
bindHold("rightBtn", () => tryMove(MOVE_STEP, 0));
bindHold("downBtn", softDrop, 58);
document.getElementById("rotateBtn").addEventListener("click", () => {
  unlockAudio();
  tryRotate();
});
document.getElementById("dropBtn").addEventListener("click", () => {
  unlockAudio();
  hardDrop();
});
pauseBtn.addEventListener("click", () => {
  unlockAudio();
  togglePause();
});

startScreen.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  startGame();
});

startScreen.addEventListener("contextmenu", (event) => event.preventDefault());

gameCanvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") return;
  event.preventDefault();
  unlockAudio();
  gameCanvas.setPointerCapture(event.pointerId);
  touchState = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    startedAt: performance.now(),
    moved: false
  };
});

gameCanvas.addEventListener("pointermove", (event) => {
  if (!touchState || touchState.id !== event.pointerId) return;
  event.preventDefault();

  const dx = event.clientX - touchState.lastX;
  const dy = event.clientY - touchState.lastY;
  const step = Math.max(18, gameCanvas.getBoundingClientRect().width * 0.06);

  if (Math.abs(dx) >= step && Math.abs(dx) > Math.abs(dy) * 0.7) {
    tryMove(dx > 0 ? MOVE_STEP : -MOVE_STEP, 0);
    touchState.lastX = event.clientX;
    touchState.moved = true;
  }

  if (dy >= step) {
    softDrop();
    touchState.lastY = event.clientY;
    touchState.moved = true;
  }
});

gameCanvas.addEventListener("pointerup", (event) => {
  if (!touchState || touchState.id !== event.pointerId) return;
  event.preventDefault();

  const totalX = event.clientX - touchState.startX;
  const totalY = event.clientY - touchState.startY;
  const duration = performance.now() - touchState.startedAt;
  const tapLimit = Math.max(18, gameCanvas.getBoundingClientRect().width * 0.06);

  if (totalY < -tapLimit * 2 && Math.abs(totalX) < tapLimit * 2.2) {
    hardDrop();
  } else if (!touchState.moved && Math.abs(totalX) < tapLimit && Math.abs(totalY) < tapLimit && duration < 320) {
    tryRotate();
  }

  touchState = null;
});

gameCanvas.addEventListener("pointercancel", () => {
  touchState = null;
});

gameCanvas.addEventListener("contextmenu", (event) => event.preventDefault());

resetGame(false);
requestAnimationFrame(loop);
