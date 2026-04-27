import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 5173);

const WORLD = {
  width: 3000,
  height: 1700,
  goalDepth: 180,
  goalWidth: 650,
  carRadius: 48,
  ballRadius: 42
};

const PHYSICS = {
  tickRate: 60,
  snapshotRate: 24,
  matchSeconds: 300,
  carAccel: 1320,
  carReverseAccel: 820,
  carMaxSpeed: 920,
  carBoostMaxSpeed: 1420,
  carTurnRate: 3.35,
  carFriction: 0.988,
  carBrakeFriction: 0.965,
  boostAccel: 1860,
  boostDrain: 34,
  boostRegen: 5,
  ballFriction: 0.992,
  ballCarImpulse: 860,
  wallBounce: 0.82,
  gravity: 1900,
  ballGravity: 1500,
  ballBounce: 0.7,
  carJumpVelocity: 680,
  carAirControl: 0.42,
  boostPadSmallCooldown: 4500,
  boostPadLargeCooldown: 9000
};

const BOOST_PAD_LAYOUT = [
  { id: 'blue-corner-top', x: 360, y: 260, amount: 42, radius: 64 },
  { id: 'blue-corner-bottom', x: 360, y: 1440, amount: 42, radius: 64 },
  { id: 'orange-corner-top', x: 2640, y: 260, amount: 42, radius: 64 },
  { id: 'orange-corner-bottom', x: 2640, y: 1440, amount: 42, radius: 64 },
  { id: 'mid-top', x: 1500, y: 250, amount: 28, radius: 54 },
  { id: 'mid-bottom', x: 1500, y: 1450, amount: 28, radius: 54 },
  { id: 'blue-wing-top', x: 910, y: 545, amount: 18, radius: 46 },
  { id: 'blue-wing-bottom', x: 910, y: 1155, amount: 18, radius: 46 },
  { id: 'orange-wing-top', x: 2090, y: 545, amount: 18, radius: 46 },
  { id: 'orange-wing-bottom', x: 2090, y: 1155, amount: 18, radius: 46 },
  { id: 'center-left', x: 1260, y: 850, amount: 18, radius: 46 },
  { id: 'center-right', x: 1740, y: 850, amount: 18, radius: 46 }
];

const rooms = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true
  }
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

if (isProduction) {
  app.use(express.static(path.join(rootDir, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(rootDir, 'dist', 'index.html'));
  });
} else {
  const vite = await createViteServer({
    root: rootDir,
    server: {
      middlewareMode: true
    },
    appType: 'spa'
  });
  app.use(vite.middlewares);
}

io.on('connection', (socket) => {
  let activeRoom = null;

  socket.on('room:join', ({ room, name }) => {
    const roomName = cleanRoom(room) || 'arena';
    if (activeRoom === roomName) return;

    if (activeRoom) {
      leaveRoom(socket, activeRoom);
    }

    activeRoom = roomName;
    socket.join(roomName);

    const game = getRoom(roomName);
    const player = createPlayer(socket.id, game, name);
    game.players.set(socket.id, player);
    resetPlayer(player, game, game.players.size - 1);

    socket.emit('room:joined', {
      room: roomName,
      playerId: socket.id
    });
  });

  socket.on('player:input', ({ input }) => {
    if (!activeRoom) return;
    const game = rooms.get(activeRoom);
    const player = game?.players.get(socket.id);
    if (!player) return;

    player.input.up = Boolean(input?.up);
    player.input.down = Boolean(input?.down);
    player.input.left = Boolean(input?.left);
    player.input.right = Boolean(input?.right);
    player.input.boost = Boolean(input?.boost);
    player.input.jump = Boolean(input?.jump);
    player.lastInputAt = Date.now();
  });

  socket.on('disconnect', () => {
    if (activeRoom) {
      leaveRoom(socket, activeRoom);
      activeRoom = null;
    }
  });
});

const fixedDt = 1 / PHYSICS.tickRate;
setInterval(() => {
  for (const [roomName, game] of rooms.entries()) {
    stepGame(game, fixedDt);
    if (game.players.size === 0 && Date.now() - game.emptySince > 10000) {
      rooms.delete(roomName);
    }
  }
}, 1000 / PHYSICS.tickRate);

setInterval(() => {
  for (const [roomName, game] of rooms.entries()) {
    if (game.players.size === 0) continue;
    io.to(roomName).emit('game:snapshot', snapshot(game));
  }
}, 1000 / PHYSICS.snapshotRate);

server.listen(port, () => {
  console.log(`Pixi Rocket Arena running at http://localhost:${port}`);
});

function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, createGame(roomName));
  }

  const game = rooms.get(roomName);
  game.emptySince = 0;
  return game;
}

function createGame(roomName) {
  return {
    roomName,
    players: new Map(),
    ball: {
      x: WORLD.width / 2,
      y: WORLD.height / 2,
      z: WORLD.ballRadius,
      vx: 0,
      vy: 0,
      vz: 0
    },
    boostPads: BOOST_PAD_LAYOUT.map((pad) => ({ ...pad, cooldownUntil: 0 })),
    score: {
      blue: 0,
      orange: 0
    },
    timeRemaining: PHYSICS.matchSeconds,
    lastScoredAt: 0,
    emptySince: 0
  };
}

function createPlayer(id, game, requestedName) {
  const team = countTeam(game, 'blue') <= countTeam(game, 'orange') ? 'blue' : 'orange';
  const shortId = id.slice(0, 4).toUpperCase();
  const playerName = cleanName(requestedName) || `${team === 'blue' ? 'Blue' : 'Orange'} ${shortId}`;

  return {
    id,
    name: playerName,
    team,
    x: WORLD.width / 2,
    y: WORLD.height / 2,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    angle: team === 'blue' ? 0 : Math.PI,
    boost: 100,
    boosting: false,
    grounded: true,
    prevJump: false,
    demolished: false,
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      boost: false,
      jump: false
    },
    lastInputAt: Date.now()
  };
}

function leaveRoom(socket, roomName) {
  socket.leave(roomName);
  const game = rooms.get(roomName);
  if (!game) return;

  game.players.delete(socket.id);
  if (game.players.size === 0) {
    game.emptySince = Date.now();
  }
}

function stepGame(game, dt) {
  if (game.players.size === 0) return;

  game.timeRemaining -= dt;
  if (game.timeRemaining <= 0) {
    game.timeRemaining = PHYSICS.matchSeconds;
    game.score.blue = 0;
    game.score.orange = 0;
    resetRound(game);
  }

  for (const player of game.players.values()) {
    stepPlayer(player, dt);
    collectBoostPads(game, player);
  }

  collideCars(game);
  collideBallWithCars(game);
  stepBall(game, dt);
}

function stepPlayer(player, dt) {
  const input = player.input;
  const moving = input.up || input.down || Math.hypot(player.vx, player.vy) > 60;
  const turnDirection = Number(input.right) - Number(input.left);
  const reverseFactor = input.down && !input.up ? -0.72 : 1;
  const controlScale = player.grounded ? 1 : PHYSICS.carAirControl;

  if (moving && turnDirection !== 0) {
    const speedFactor = clamp(Math.hypot(player.vx, player.vy) / 420, 0.35, 1.25);
    player.angle += turnDirection * PHYSICS.carTurnRate * reverseFactor * speedFactor * controlScale * dt;
  }

  const forwardX = Math.cos(player.angle);
  const forwardY = Math.sin(player.angle);

  if (input.up) {
    player.vx += forwardX * PHYSICS.carAccel * controlScale * dt;
    player.vy += forwardY * PHYSICS.carAccel * controlScale * dt;
  }

  if (input.down) {
    player.vx -= forwardX * PHYSICS.carReverseAccel * controlScale * dt;
    player.vy -= forwardY * PHYSICS.carReverseAccel * controlScale * dt;
  }

  if (input.jump && !player.prevJump && player.grounded) {
    player.vz = PHYSICS.carJumpVelocity;
    player.grounded = false;
  }
  player.prevJump = input.jump;

  const canBoost = input.boost && player.boost > 0 && (input.up || !player.grounded);
  player.boosting = canBoost;
  if (canBoost) {
    player.vx += forwardX * PHYSICS.boostAccel * dt;
    player.vy += forwardY * PHYSICS.boostAccel * dt;
    if (!player.grounded) {
      player.vz += 220 * dt;
    }
    player.boost = Math.max(0, player.boost - PHYSICS.boostDrain * dt);
  } else {
    player.boost = Math.min(100, player.boost + PHYSICS.boostRegen * dt);
  }

  const maxSpeed = canBoost ? PHYSICS.carBoostMaxSpeed : PHYSICS.carMaxSpeed;
  limitVelocity(player, maxSpeed);

  const friction = input.down && !input.up ? PHYSICS.carBrakeFriction : PHYSICS.carFriction;
  player.vx *= friction;
  player.vy *= friction;
  player.x += player.vx * dt;
  player.y += player.vy * dt;

  if (!player.grounded || player.z > 0) {
    player.vz -= PHYSICS.gravity * dt;
    player.z += player.vz * dt;
  }

  if (player.z <= 0) {
    player.z = 0;
    player.vz = 0;
    player.grounded = true;
  }

  keepCarInArena(player);
}

function collectBoostPads(game, player) {
  const now = Date.now();

  for (const pad of game.boostPads) {
    if (now < pad.cooldownUntil || player.boost >= 100) continue;
    const distance = Math.hypot(player.x - pad.x, player.y - pad.y);
    if (distance > pad.radius + WORLD.carRadius) continue;

    player.boost = Math.min(100, player.boost + pad.amount);
    pad.cooldownUntil =
      now + (pad.amount >= 40 ? PHYSICS.boostPadLargeCooldown : PHYSICS.boostPadSmallCooldown);
  }
}

function collideCars(game) {
  const players = [...game.players.values()];
  const minDistance = WORLD.carRadius * 2;

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance >= minDistance) continue;

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;

      const impulse = ((b.vx - a.vx) * nx + (b.vy - a.vy) * ny) * 0.42;
      a.vx += nx * impulse;
      a.vy += ny * impulse;
      b.vx -= nx * impulse;
      b.vy -= ny * impulse;
    }
  }
}

function collideBallWithCars(game) {
  const ball = game.ball;
  const minDistance = WORLD.ballRadius + WORLD.carRadius;

  for (const player of game.players.values()) {
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const dz = ball.z - (player.z + 30);
    const horizontalDistance = Math.hypot(dx, dy) || 1;
    const distance = Math.hypot(horizontalDistance, dz * 0.55);
    if (distance >= minDistance) continue;

    const nx = dx / horizontalDistance;
    const ny = dy / horizontalDistance;
    const overlap = minDistance - distance;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const carSpeed = Math.hypot(player.vx, player.vy);
    const touchPower = PHYSICS.ballCarImpulse + carSpeed * 0.72;
    ball.vx = nx * touchPower + player.vx * 0.42;
    ball.vy = ny * touchPower + player.vy * 0.42;
    ball.vz = Math.max(ball.vz, player.grounded ? 150 : 410 + Math.max(0, player.vz) * 0.28);

    player.vx -= nx * 80;
    player.vy -= ny * 80;
  }
}

function stepBall(game, dt) {
  const ball = game.ball;

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;
  ball.vx *= PHYSICS.ballFriction;
  ball.vy *= PHYSICS.ballFriction;
  ball.vz -= PHYSICS.ballGravity * dt;

  if (ball.z < WORLD.ballRadius) {
    ball.z = WORLD.ballRadius;
    ball.vz = Math.abs(ball.vz) > 80 ? Math.abs(ball.vz) * PHYSICS.ballBounce : 0;
  }

  const goalTop = WORLD.height / 2 - WORLD.goalWidth / 2;
  const goalBottom = WORLD.height / 2 + WORLD.goalWidth / 2;
  const inGoalMouth = ball.y > goalTop && ball.y < goalBottom;

  if (ball.x < -WORLD.ballRadius && inGoalMouth && ball.z < 260) {
    scoreGoal(game, 'orange');
    return;
  }

  if (ball.x > WORLD.width + WORLD.ballRadius && inGoalMouth && ball.z < 260) {
    scoreGoal(game, 'blue');
    return;
  }

  const leftBound = inGoalMouth ? -WORLD.ballRadius * 1.4 : WORLD.ballRadius;
  const rightBound = inGoalMouth ? WORLD.width + WORLD.ballRadius * 1.4 : WORLD.width - WORLD.ballRadius;

  if (ball.x < leftBound) {
    ball.x = leftBound;
    ball.vx = Math.abs(ball.vx) * PHYSICS.wallBounce;
  }

  if (ball.x > rightBound) {
    ball.x = rightBound;
    ball.vx = -Math.abs(ball.vx) * PHYSICS.wallBounce;
  }

  if (ball.y < WORLD.ballRadius) {
    ball.y = WORLD.ballRadius;
    ball.vy = Math.abs(ball.vy) * PHYSICS.wallBounce;
  }

  if (ball.y > WORLD.height - WORLD.ballRadius) {
    ball.y = WORLD.height - WORLD.ballRadius;
    ball.vy = -Math.abs(ball.vy) * PHYSICS.wallBounce;
  }

  limitVelocity(ball, 1260);
}

function scoreGoal(game, team) {
  if (Date.now() - game.lastScoredAt < 1400) return;
  game.score[team] += 1;
  game.lastScoredAt = Date.now();
  io.to(game.roomName).emit('game:goal', { team });
  resetRound(game);
}

function resetRound(game) {
  game.ball.x = WORLD.width / 2;
  game.ball.y = WORLD.height / 2;
  game.ball.z = WORLD.ballRadius;
  game.ball.vx = 0;
  game.ball.vy = 0;
  game.ball.vz = 0;

  let index = 0;
  for (const player of game.players.values()) {
    resetPlayer(player, game, index);
    index += 1;
  }
}

function resetPlayer(player, game, index) {
  const teamIndex = [...game.players.values()].filter((candidate) => candidate.team === player.team).indexOf(player);
  const laneOffset = (teamIndex % 3 - 1) * 250;
  const rowOffset = Math.floor(teamIndex / 3) * 170;

  player.x = player.team === 'blue' ? WORLD.width * 0.27 - rowOffset : WORLD.width * 0.73 + rowOffset;
  player.y = WORLD.height / 2 + laneOffset + (index % 2 === 0 ? 76 : -76);
  player.z = 0;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.angle = player.team === 'blue' ? 0 : Math.PI;
  player.boost = 100;
  player.boosting = false;
  player.grounded = true;
  player.prevJump = false;
}

function keepCarInArena(player) {
  const minX = WORLD.carRadius;
  const maxX = WORLD.width - WORLD.carRadius;
  const minY = WORLD.carRadius;
  const maxY = WORLD.height - WORLD.carRadius;

  if (player.x < minX) {
    player.x = minX;
    player.vx = Math.abs(player.vx) * 0.28;
  }

  if (player.x > maxX) {
    player.x = maxX;
    player.vx = -Math.abs(player.vx) * 0.28;
  }

  if (player.y < minY) {
    player.y = minY;
    player.vy = Math.abs(player.vy) * 0.28;
  }

  if (player.y > maxY) {
    player.y = maxY;
    player.vy = -Math.abs(player.vy) * 0.28;
  }
}

function snapshot(game) {
  const now = Date.now();

  return {
    room: game.roomName,
    serverTime: now,
    score: game.score,
    timeRemaining: game.timeRemaining,
    ball: {
      x: round(game.ball.x),
      y: round(game.ball.y),
      z: round(game.ball.z),
      vx: round(game.ball.vx),
      vy: round(game.ball.vy),
      vz: round(game.ball.vz)
    },
    boostPads: game.boostPads.map((pad) => ({
      id: pad.id,
      x: pad.x,
      y: pad.y,
      amount: pad.amount,
      radius: pad.radius,
      active: now >= pad.cooldownUntil
    })),
    players: [...game.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      x: round(player.x),
      y: round(player.y),
      z: round(player.z),
      vx: round(player.vx),
      vy: round(player.vy),
      vz: round(player.vz),
      angle: round(player.angle),
      boost: round(player.boost),
      boosting: player.boosting,
      grounded: player.grounded,
      demolished: player.demolished
    }))
  };
}

function countTeam(game, team) {
  let count = 0;
  for (const player of game.players.values()) {
    if (player.team === team) count += 1;
  }
  return count;
}

function cleanRoom(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 18);
}

function cleanName(value) {
  return String(value || '')
    .trim()
    .replace(/[^\w -]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 16);
}

function limitVelocity(entity, maxSpeed) {
  const speed = Math.hypot(entity.vx, entity.vy);
  if (speed <= maxSpeed) return;

  const scale = maxSpeed / speed;
  entity.vx *= scale;
  entity.vy *= scale;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
