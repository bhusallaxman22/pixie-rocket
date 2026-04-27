import { Application, Graphics } from 'pixi.js';
import { io } from 'socket.io-client';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import './styles.css';

const WORLD = {
  width: 3000,
  height: 1700,
  goalDepth: 180,
  goalWidth: 650,
  carRadius: 48,
  ballRadius: 42
};

const SCALE = 0.01;
const FIELD_WIDTH = WORLD.width * SCALE;
const FIELD_HEIGHT = WORLD.height * SCALE;
const GOAL_WIDTH = WORLD.goalWidth * SCALE;
const GOAL_DEPTH = WORLD.goalDepth * SCALE;
const CAR_BASE_HEIGHT = 0.28;

const TEAM_COLORS = {
  blue: 0x2d9cff,
  orange: 0xff8f2d
};

const TEAM_ACCENTS = {
  blue: 0x9bdfff,
  orange: 0xffcf96
};

const controls = {
  up: false,
  down: false,
  left: false,
  right: false,
  boost: false,
  jump: false
};

const keyMap = new Map([
  ['KeyW', 'up'],
  ['ArrowUp', 'up'],
  ['KeyS', 'down'],
  ['ArrowDown', 'down'],
  ['KeyA', 'left'],
  ['ArrowLeft', 'left'],
  ['KeyD', 'right'],
  ['ArrowRight', 'right'],
  ['ShiftLeft', 'boost'],
  ['ShiftRight', 'boost'],
  ['KeyE', 'boost'],
  ['Space', 'jump']
]);

const state = {
  playerId: null,
  room: 'arena',
  playerName: '',
  connected: false,
  hasJoined: false,
  pendingJoin: null,
  snapshot: null,
  players: new Map(),
  boostPads: new Map(),
  goalBannerUntil: 0,
  goalBannerTeam: null
};

const elements = {
  app: document.querySelector('#app'),
  blueScore: document.querySelector('.scoreboard .blue'),
  orangeScore: document.querySelector('.scoreboard .orange'),
  clock: document.querySelector('.clock'),
  statusDot: document.querySelector('.status-dot'),
  statusText: document.querySelector('.status-text'),
  form: document.querySelector('.join-form'),
  nameInput: document.querySelector('#name-input'),
  roomInput: document.querySelector('#room-input'),
  randomRoom: document.querySelector('.random-room'),
  matchRoom: document.querySelector('.match-room'),
  speedValue: document.querySelector('.speed-value'),
  boostGauge: document.querySelector('.boost-gauge'),
  boostValue: document.querySelector('.boost-value')
};

const params = new URLSearchParams(window.location.search);
state.room = cleanRoom(params.get('room')) || 'arena';
state.playerName = cleanName(localStorage.getItem('pra-driver')) || `Driver ${Math.floor(Math.random() * 900 + 100)}`;
elements.roomInput.value = state.room;
elements.nameInput.value = state.playerName;
elements.matchRoom.textContent = state.room;

const socket = io({
  autoConnect: false,
  transports: ['websocket', 'polling']
});

let renderer;
let scene;
let camera;
let overlayApp;
let minimap;
let ballMesh;
let ballShadow;
let ballLight;
let textures = {};
let sceneReady = false;
let inputFrame = 0;
let inputAccumulator = 0;
let smoothedLookAt = new THREE.Vector3(0, 0, 0);

bootstrap();

async function bootstrap() {
  bindInput();
  bindSocket();
  socket.connect();

  await initThree();
  await initOverlay();
  sceneReady = true;
  if (state.snapshot) {
    syncSnapshot(state.snapshot);
  }

  let previousTime = performance.now();
  renderer.setAnimationLoop((time) => {
    const dt = Math.min(0.05, Math.max(0.001, (time - previousTime) / 1000));
    previousTime = time;
    tick(dt, time);
  });
}

async function initThree() {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  renderer.domElement.className = 'game-canvas';
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.querySelector('#app').prepend(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a08);
  scene.fog = new THREE.Fog(0x070a08, 34, 92);

  camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 140);
  camera.position.set(0, 8, 18);

  window.addEventListener('resize', resizeRenderer);
  resizeRenderer();

  await loadTextures();
  buildLighting();
  buildArena();
  buildBall();
}

async function initOverlay() {
  overlayApp = new Application();
  await overlayApp.init({
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resizeTo: window
  });

  overlayApp.canvas.className = 'pixi-overlay';
  document.querySelector('#app').append(overlayApp.canvas);
  minimap = new Graphics();
  overlayApp.stage.addChild(minimap);
}

async function loadTextures() {
  const loader = new THREE.TextureLoader();
  const atlas = await loader.loadAsync('/assets/arena-texture-atlas.png');
  const ballMap = await loader.loadAsync('/assets/ball-material.png');
  const anisotropy = renderer.capabilities.getMaxAnisotropy();

  atlas.colorSpace = THREE.SRGBColorSpace;
  ballMap.colorSpace = THREE.SRGBColorSpace;
  ballMap.anisotropy = anisotropy;
  ballMap.wrapS = THREE.RepeatWrapping;
  ballMap.wrapT = THREE.RepeatWrapping;

  textures = {
    turf: cropAtlasTexture(atlas, 0, 0, 11, 6.5),
    carPaint: cropAtlasTexture(atlas, 1, 0, 1.6, 1.2),
    boost: cropAtlasTexture(atlas, 0, 1, 1, 1),
    stadium: cropAtlasTexture(atlas, 1, 1, 4, 1.4),
    ball: ballMap
  };
}

function cropAtlasTexture(source, column, row, repeatX, repeatY) {
  const image = source.image;
  const sourceWidth = image.width / 2;
  const sourceHeight = image.height / 2;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;

  const context = canvas.getContext('2d');
  context.drawImage(
    image,
    column * sourceWidth,
    row * sourceHeight,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function buildLighting() {
  const hemi = new THREE.HemisphereLight(0xbad7ff, 0x273023, 1.4);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-8, 18, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  scene.add(key);

  const rimBlue = new THREE.PointLight(TEAM_COLORS.blue, 42, 28);
  rimBlue.position.set(-FIELD_WIDTH / 2, 5, 0);
  scene.add(rimBlue);

  const rimOrange = new THREE.PointLight(TEAM_COLORS.orange, 42, 28);
  rimOrange.position.set(FIELD_WIDTH / 2, 5, 0);
  scene.add(rimOrange);
}

function buildArena() {
  const turfMaterial = new THREE.MeshStandardMaterial({
    map: textures.turf,
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.04
  });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH, FIELD_HEIGHT), turfMaterial);
  field.rotation.x = -Math.PI / 2;
  field.receiveShadow = true;
  addOuterStadiumFloor();
  scene.add(field);

  addFieldMarkings();
  addArenaWalls();
  addGoal('blue', -1);
  addGoal('orange', 1);
  addStadiumLightRigs();
}

function addOuterStadiumFloor() {
  const apronMaterial = new THREE.MeshStandardMaterial({
    color: 0x171d19,
    roughness: 0.82,
    metalness: 0.16
  });
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_WIDTH + 14, FIELD_HEIGHT + 10),
    apronMaterial
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.035;
  apron.receiveShadow = true;
  scene.add(apron);

  const tierMaterial = new THREE.MeshStandardMaterial({
    color: 0x202821,
    roughness: 0.74,
    metalness: 0.2
  });
  const railMaterial = new THREE.MeshBasicMaterial({
    color: 0x41524a,
    transparent: true,
    opacity: 0.62
  });

  for (let tier = 0; tier < 4; tier += 1) {
    const height = 0.18 + tier * 0.12;
    const depth = 0.72;
    const y = height / 2 - 0.02;
    const offset = 1.7 + tier * 0.74;
    addBoard(FIELD_WIDTH + 7 + tier * 1.8, height, depth, 0, y, -FIELD_HEIGHT / 2 - offset, tierMaterial);
    addBoard(FIELD_WIDTH + 7 + tier * 1.8, height, depth, 0, y, FIELD_HEIGHT / 2 + offset, tierMaterial);

    const railA = new THREE.Mesh(new THREE.BoxGeometry(FIELD_WIDTH + 7 + tier * 1.8, 0.035, 0.035), railMaterial);
    railA.position.set(0, height + 0.08, -FIELD_HEIGHT / 2 - offset + depth * 0.32);
    scene.add(railA);

    const railB = railA.clone();
    railB.position.z = FIELD_HEIGHT / 2 + offset - depth * 0.32;
    scene.add(railB);
  }
}

function addFieldMarkings() {
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: 0xe2f4ee,
    transparent: true,
    opacity: 0.66,
    depthWrite: false
  });
  const blueMaterial = new THREE.MeshBasicMaterial({
    color: TEAM_COLORS.blue,
    transparent: true,
    opacity: 0.42,
    depthWrite: false
  });
  const orangeMaterial = new THREE.MeshBasicMaterial({
    color: TEAM_COLORS.orange,
    transparent: true,
    opacity: 0.42,
    depthWrite: false
  });

  addFlatLine(FIELD_WIDTH, 0.045, 0, -FIELD_HEIGHT / 2 + 0.03, lineMaterial);
  addFlatLine(FIELD_WIDTH, 0.045, 0, FIELD_HEIGHT / 2 - 0.03, lineMaterial);
  addFlatLine(0.045, FIELD_HEIGHT, -FIELD_WIDTH / 2 + 0.03, 0, lineMaterial);
  addFlatLine(0.045, FIELD_HEIGHT, FIELD_WIDTH / 2 - 0.03, 0, lineMaterial);
  addFlatLine(0.052, FIELD_HEIGHT, 0, 0, lineMaterial);

  const centerRadius = 255 * SCALE;
  const ring = new THREE.Mesh(new THREE.RingGeometry(centerRadius - 0.04, centerRadius + 0.04, 128), lineMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025;
  scene.add(ring);

  addFlatLine(GOAL_DEPTH, GOAL_WIDTH, -FIELD_WIDTH / 2 + GOAL_DEPTH / 2, 0, blueMaterial);
  addFlatLine(GOAL_DEPTH, GOAL_WIDTH, FIELD_WIDTH / 2 - GOAL_DEPTH / 2, 0, orangeMaterial);
}

function addFlatLine(width, depth, x, z, material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.position.set(x, 0.026, z);
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  return mesh;
}

function addArenaWalls() {
  const wallMaterial = new THREE.MeshStandardMaterial({
    map: textures.stadium,
    color: 0xb9c3bd,
    roughness: 0.62,
    metalness: 0.28
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x9ed7ff,
    transparent: true,
    opacity: 0.1,
    roughness: 0.12,
    transmission: 0.28,
    depthWrite: false
  });

  addBoard(FIELD_WIDTH + 0.7, 0.48, 0.24, 0, 0.24, -FIELD_HEIGHT / 2 - 0.16, wallMaterial);
  addBoard(FIELD_WIDTH + 0.7, 0.48, 0.24, 0, 0.24, FIELD_HEIGHT / 2 + 0.16, wallMaterial);

  const endDepth = (FIELD_HEIGHT - GOAL_WIDTH) / 2;
  addBoard(0.24, 0.48, endDepth, -FIELD_WIDTH / 2 - 0.16, 0.24, -FIELD_HEIGHT / 2 + endDepth / 2, wallMaterial);
  addBoard(0.24, 0.48, endDepth, -FIELD_WIDTH / 2 - 0.16, 0.24, FIELD_HEIGHT / 2 - endDepth / 2, wallMaterial);
  addBoard(0.24, 0.48, endDepth, FIELD_WIDTH / 2 + 0.16, 0.24, -FIELD_HEIGHT / 2 + endDepth / 2, wallMaterial);
  addBoard(0.24, 0.48, endDepth, FIELD_WIDTH / 2 + 0.16, 0.24, FIELD_HEIGHT / 2 - endDepth / 2, wallMaterial);

  addBoard(FIELD_WIDTH + 2.2, 1.2, 0.055, 0, 1.06, -FIELD_HEIGHT / 2 - 0.58, glassMaterial);
  addBoard(FIELD_WIDTH + 2.2, 1.2, 0.055, 0, 1.06, FIELD_HEIGHT / 2 + 0.58, glassMaterial);
  addBoard(0.055, 1.2, FIELD_HEIGHT + 1.05, -FIELD_WIDTH / 2 - 0.58, 1.06, 0, glassMaterial);
  addBoard(0.055, 1.2, FIELD_HEIGHT + 1.05, FIELD_WIDTH / 2 + 0.58, 1.06, 0, glassMaterial);

  const standMaterial = new THREE.MeshStandardMaterial({
    map: textures.stadium,
    color: 0x68736d,
    roughness: 0.78,
    metalness: 0.2
  });
  addBoard(FIELD_WIDTH + 7, 1.05, 1.1, 0, 0.72, -FIELD_HEIGHT / 2 - 1.85, standMaterial);
  addBoard(FIELD_WIDTH + 7, 1.05, 1.1, 0, 0.72, FIELD_HEIGHT / 2 + 1.85, standMaterial);
  addBoard(1.1, 1.05, FIELD_HEIGHT + 3.7, -FIELD_WIDTH / 2 - 1.85, 0.72, 0, standMaterial);
  addBoard(1.1, 1.05, FIELD_HEIGHT + 3.7, FIELD_WIDTH / 2 + 1.85, 0.72, 0, standMaterial);
}

function addBoard(width, height, depth, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addGoal(team, side) {
  const color = TEAM_COLORS[team];
  const goalMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
    roughness: 0.36,
    metalness: 0.48
  });
  const netMaterial = new THREE.MeshStandardMaterial({
    map: textures.stadium,
    color: 0xffffff,
    transparent: true,
    opacity: 0.34,
    roughness: 0.45,
    metalness: 0.16
  });

  const edgeX = side * FIELD_WIDTH / 2;
  const backX = edgeX + side * GOAL_DEPTH;
  addBoard(0.12, 1.25, 0.12, edgeX, 0.62, -GOAL_WIDTH / 2, goalMaterial);
  addBoard(0.12, 1.25, 0.12, edgeX, 0.62, GOAL_WIDTH / 2, goalMaterial);
  addBoard(0.12, 0.12, GOAL_WIDTH + 0.12, edgeX, 1.24, 0, goalMaterial);
  addBoard(GOAL_DEPTH, 1.05, 0.08, edgeX + side * GOAL_DEPTH / 2, 0.68, -GOAL_WIDTH / 2, netMaterial);
  addBoard(GOAL_DEPTH, 1.05, 0.08, edgeX + side * GOAL_DEPTH / 2, 0.68, GOAL_WIDTH / 2, netMaterial);
  addBoard(0.08, 1.05, GOAL_WIDTH, backX, 0.68, 0, netMaterial);

  const glow = new THREE.PointLight(color, 24, 8);
  glow.position.set(edgeX + side * 0.4, 1.6, 0);
  scene.add(glow);
}

function addStadiumLightRigs() {
  const rigMaterial = new THREE.MeshStandardMaterial({
    color: 0x313833,
    roughness: 0.5,
    metalness: 0.62
  });
  const bulbMaterial = new THREE.MeshBasicMaterial({
    color: 0xf5fff7
  });

  for (const z of [-FIELD_HEIGHT / 2 - 1.35, FIELD_HEIGHT / 2 + 1.35]) {
    for (const x of [-FIELD_WIDTH * 0.35, 0, FIELD_WIDTH * 0.35]) {
      addBoard(2.2, 0.08, 0.08, x, 4.2, z, rigMaterial);
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.06), bulbMaterial);
      bulb.position.set(x, 4.12, z);
      scene.add(bulb);
      const light = new THREE.PointLight(0xf2fff6, 10, 10);
      light.position.set(x, 3.9, z);
      scene.add(light);
    }
  }
}

function buildBall() {
  const ballMaterial = new THREE.MeshStandardMaterial({
    map: textures.ball,
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.08,
    emissive: 0x121b18,
    emissiveIntensity: 0.08
  });
  ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(WORLD.ballRadius * SCALE, 48, 24),
    ballMaterial
  );
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  scene.add(ballMesh);

  ballShadow = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD.ballRadius * SCALE * 1.15, 32),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.34,
      depthWrite: false
    })
  );
  ballShadow.rotation.x = -Math.PI / 2;
  scene.add(ballShadow);

  ballLight = new THREE.PointLight(0xeefcff, 8, 5);
  scene.add(ballLight);
}

function bindInput() {
  window.addEventListener('keydown', (event) => {
    const control = keyMap.get(event.code);
    if (!control) return;
    controls[control] = true;
    if (event.code === 'Space') event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    const control = keyMap.get(event.code);
    if (!control) return;
    controls[control] = false;
  });

  document.querySelectorAll('[data-touch]').forEach((button) => {
    const control = button.dataset.touch;
    const setPressed = (pressed) => {
      controls[control] = pressed;
      button.classList.toggle('pressed', pressed);
    };

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      setPressed(true);
    });

    button.addEventListener('pointerup', () => setPressed(false));
    button.addEventListener('pointercancel', () => setPressed(false));
    button.addEventListener('lostpointercapture', () => setPressed(false));
  });

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const room = cleanRoom(elements.roomInput.value) || 'arena';
    const playerName = cleanName(elements.nameInput.value) || state.playerName;
    requestJoin(room, playerName);
  });

  elements.randomRoom.addEventListener('click', () => {
    elements.roomInput.value = randomRoomName();
    elements.roomInput.focus();
  });
}

function bindSocket() {
  socket.on('connect', () => {
    state.connected = true;
    state.playerId = socket.id;
    updateConnection('Connected', true);
    if (state.pendingJoin) {
      joinRoom(state.pendingJoin.room, state.pendingJoin.playerName);
    }
  });

  socket.on('disconnect', () => {
    state.connected = false;
    updateConnection('Disconnected', false);
  });

  socket.on('room:joined', ({ room, playerId }) => {
    state.room = room;
    state.playerId = playerId;
    state.hasJoined = true;
    state.pendingJoin = null;
    updateConnection('Connected', true);
    elements.roomInput.value = room;
    elements.matchRoom.textContent = room;
    const url = new URL(window.location.href);
    url.searchParams.set('room', room);
    window.history.replaceState({}, '', url);
    elements.app.classList.remove('in-lobby');
    elements.app.classList.add('in-game');
  });

  socket.on('game:snapshot', (snapshot) => {
    state.snapshot = snapshot;
    if (sceneReady) {
      syncSnapshot(snapshot);
    }
    updateHud(snapshot);
  });

  socket.on('game:goal', ({ team }) => {
    state.goalBannerTeam = team;
    state.goalBannerUntil = performance.now() + 1700;
  });
}

function tick(dt, time) {
  inputAccumulator += dt * 1000;
  if (inputAccumulator >= 33) {
    inputAccumulator = 0;
    socket.emit('player:input', {
      seq: inputFrame++,
      room: state.room,
      input: { ...controls }
    });
  }

  updateScene(dt, time);
  renderer.render(scene, camera);
  drawOverlay(time);
}

function syncSnapshot(snapshot) {
  syncPlayers(snapshot.players);
  syncBoostPads(snapshot.boostPads || []);

  const ballPosition = worldToScene(snapshot.ball.x, snapshot.ball.y, snapshot.ball.z);
  ballMesh.userData.target = ballPosition;
  ballMesh.userData.velocity = snapshot.ball;
}

function syncPlayers(players) {
  const activeIds = new Set(players.map((player) => player.id));

  for (const player of players) {
    if (!state.players.has(player.id)) {
      const playerObject = createCarMesh(player);
      state.players.set(player.id, playerObject);
      scene.add(playerObject.group, playerObject.shadow);
    }

    const playerObject = state.players.get(player.id);
    playerObject.target.position.copy(worldToScene(player.x, player.y, player.z + 18));
    playerObject.target.angle = player.angle;
    playerObject.target.boost = player.boost;
    playerObject.target.boosting = player.boosting;
    playerObject.target.grounded = player.grounded;
    playerObject.target.speed = Math.hypot(player.vx, player.vy);
    playerObject.data = player;
  }

  for (const [id, playerObject] of state.players.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(playerObject.group, playerObject.shadow);
      playerObject.group.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
      });
      playerObject.shadow.geometry.dispose();
      state.players.delete(id);
    }
  }
}

function syncBoostPads(pads) {
  const activeIds = new Set(pads.map((pad) => pad.id));

  for (const pad of pads) {
    if (!state.boostPads.has(pad.id)) {
      const padObject = createBoostPadMesh(pad);
      state.boostPads.set(pad.id, padObject);
      scene.add(padObject.group);
    }

    const padObject = state.boostPads.get(pad.id);
    padObject.active = pad.active;
    padObject.amount = pad.amount;
  }

  for (const [id, padObject] of state.boostPads.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(padObject.group);
      state.boostPads.delete(id);
    }
  }
}

function updateScene(dt, time) {
  const smoothing = 1 - Math.pow(0.0004, dt);

  for (const playerObject of state.players.values()) {
    const { group, shadow, flame, flameLight, target } = playerObject;
    group.position.lerp(target.position, smoothing);
    group.rotation.y = dampAngle(group.rotation.y, -target.angle, smoothing);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, target.grounded ? 0 : 0.12, smoothing * 0.55);

    flame.visible = target.boosting;
    flameLight.visible = target.boosting;
    if (target.boosting) {
      const pulse = 1 + Math.sin(time / 42) * 0.16;
      flame.scale.set(pulse, pulse, pulse);
      flameLight.intensity = 4 + Math.sin(time / 36) * 1.5;
    }

    shadow.position.set(group.position.x, 0.032, group.position.z);
    const heightFade = THREE.MathUtils.clamp(1 - group.position.y / 4.2, 0.18, 0.58);
    shadow.material.opacity = heightFade;
    const shadowScale = THREE.MathUtils.clamp(1 + group.position.y * 0.22, 1, 2.1);
    shadow.scale.set(1.3 * shadowScale, 0.72 * shadowScale, 1);
  }

  if (ballMesh.userData.target) {
    ballMesh.position.lerp(ballMesh.userData.target, smoothing);
    ballLight.position.copy(ballMesh.position);
    ballLight.position.y += 0.35;

    const velocity = ballMesh.userData.velocity || { vx: 0, vy: 0 };
    const radius = WORLD.ballRadius * SCALE;
    ballMesh.rotation.x += (velocity.vy * SCALE * dt) / Math.max(radius, 0.001);
    ballMesh.rotation.z -= (velocity.vx * SCALE * dt) / Math.max(radius, 0.001);
    ballShadow.position.set(ballMesh.position.x, 0.035, ballMesh.position.z);
    ballShadow.material.opacity = THREE.MathUtils.clamp(0.44 - ballMesh.position.y * 0.08, 0.08, 0.36);
    const scale = THREE.MathUtils.clamp(1 + ballMesh.position.y * 0.16, 1, 2.2);
    ballShadow.scale.set(scale, scale, 1);
  }

  for (const padObject of state.boostPads.values()) {
    const activeScale = padObject.active ? 1 + Math.sin(time / 180) * 0.05 : 0.78;
    padObject.group.scale.setScalar(activeScale);
    padObject.ring.rotation.z += dt * (padObject.active ? 1.8 : 0.45);
    padObject.core.material.opacity = padObject.active ? 0.92 : 0.18;
    padObject.core.material.emissiveIntensity = padObject.active ? 1.1 : 0.05;
    padObject.ring.material.opacity = padObject.active ? 0.82 : 0.2;
    padObject.light.visible = padObject.active;
  }

  updateCamera(dt);
}

function updateCamera(dt) {
  const local = state.players.get(state.playerId);
  const t = 1 - Math.pow(0.002, dt);

  if (!local) {
    const overview = new THREE.Vector3(0, 12.5, 21);
    camera.position.lerp(overview, t);
    smoothedLookAt.lerp(new THREE.Vector3(0, 0, 0), t);
    camera.lookAt(smoothedLookAt);
    return;
  }

  const angle = local.target.angle;
  const forward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const speed = local.target.speed || 0;
  const distance = 6.9 + THREE.MathUtils.clamp(speed / 680, 0, 2.4);
  const height = 2.45 + THREE.MathUtils.clamp(speed / 900, 0, 0.9) + local.group.position.y * 0.1;
  const desiredPosition = local.group.position
    .clone()
    .addScaledVector(forward, -distance)
    .add(new THREE.Vector3(0, height, 0));
  const desiredLookAt = local.group.position
    .clone()
    .addScaledVector(forward, 7.8)
    .add(new THREE.Vector3(0, 0.62, 0));

  camera.fov = THREE.MathUtils.lerp(camera.fov, 68 + THREE.MathUtils.clamp(speed / 1250, 0, 1) * 6, t);
  camera.updateProjectionMatrix();
  camera.position.lerp(desiredPosition, t);
  smoothedLookAt.lerp(desiredLookAt, t);
  camera.lookAt(smoothedLookAt);
}

function createCarMesh(player) {
  const group = new THREE.Group();
  const teamColor = TEAM_COLORS[player.team];
  const accentColor = TEAM_ACCENTS[player.team];
  const carMaterial = new THREE.MeshStandardMaterial({
    map: textures.carPaint,
    color: teamColor,
    roughness: 0.32,
    metalness: 0.58,
    emissive: teamColor,
    emissiveIntensity: 0.04
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.2,
    metalness: 0.42,
    emissive: accentColor,
    emissiveIntensity: 0.18
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0e2128,
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.72
  });
  const tireMaterial = new THREE.MeshStandardMaterial({
    color: 0x060706,
    roughness: 0.82,
    metalness: 0.15
  });

  const body = new THREE.Mesh(new RoundedBoxGeometry(1.48, 0.32, 0.72, 6, 0.08), carMaterial);
  body.position.y = CAR_BASE_HEIGHT - 0.02;
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.2, 0.62, 5, 0.07), carMaterial);
  nose.position.set(0.52, CAR_BASE_HEIGHT - 0.03, 0);
  nose.castShadow = true;
  group.add(nose);

  const cabin = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.26, 0.46, 5, 0.06), glassMaterial);
  cabin.position.set(0.03, CAR_BASE_HEIGHT + 0.24, 0);
  cabin.castShadow = true;
  group.add(cabin);

  const roofScoop = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.08, 0.18, 3, 0.03), accentMaterial);
  roofScoop.position.set(-0.04, CAR_BASE_HEIGHT + 0.43, 0);
  roofScoop.castShadow = true;
  group.add(roofScoop);

  const spoiler = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.08, 0.88, 4, 0.025), accentMaterial);
  spoiler.position.set(-0.66, CAR_BASE_HEIGHT + 0.31, 0);
  spoiler.castShadow = true;
  group.add(spoiler);

  const stripe = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.035, 0.08, 3, 0.015), accentMaterial);
  stripe.position.set(0.18, CAR_BASE_HEIGHT + 0.17, 0);
  stripe.castShadow = true;
  group.add(stripe);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.78), accentMaterial);
  splitter.position.set(0.84, 0.14, 0);
  splitter.castShadow = true;
  group.add(splitter);

  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.7), accentMaterial);
  diffuser.position.set(-0.78, 0.15, 0);
  diffuser.castShadow = true;
  group.add(diffuser);

  const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xeefcff });
  for (const z of [-0.21, 0.21]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.055, 0.16), headlightMaterial);
    headlight.position.set(0.84, CAR_BASE_HEIGHT + 0.02, z);
    group.add(headlight);
  }

  for (const x of [-0.42, 0.42]) {
    for (const z of [-0.42, 0.42]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 20), tireMaterial);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.16, z);
      wheel.castShadow = true;
      group.add(wheel);

      const fender = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.08, 0.12, 3, 0.03), accentMaterial);
      fender.position.set(x, 0.32, z * 0.96);
      fender.castShadow = true;
      group.add(fender);
    }
  }

  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xffa12f,
    transparent: true,
    opacity: 0.86
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.92, 24), flameMaterial);
  flame.position.set(-0.98, CAR_BASE_HEIGHT, 0);
  flame.rotation.z = Math.PI / 2;
  flame.visible = false;
  group.add(flame);

  const flameLight = new THREE.PointLight(0xff9828, 0, 4);
  flameLight.position.set(-0.72, CAR_BASE_HEIGHT, 0);
  flameLight.visible = false;
  group.add(flameLight);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.72, 32),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.46,
      depthWrite: false
    })
  );
  shadow.rotation.x = -Math.PI / 2;

  return {
    group,
    shadow,
    flame,
    flameLight,
    target: {
      position: worldToScene(player.x, player.y, player.z + 18),
      angle: player.angle,
      boost: player.boost,
      boosting: player.boosting,
      grounded: player.grounded,
      speed: 0
    },
    data: player
  };
}

function createBoostPadMesh(pad) {
  const group = new THREE.Group();
  const radius = pad.radius * SCALE;
  const position = worldToScene(pad.x, pad.y, 4);
  group.position.copy(position);

  const coreMaterial = new THREE.MeshStandardMaterial({
    map: textures.boost,
    color: 0xffb233,
    emissive: 0xff8f20,
    emissiveIntensity: 1.1,
    roughness: 0.28,
    metalness: 0.35,
    transparent: true,
    opacity: 0.92
  });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.055, 48), coreMaterial);
  core.receiveShadow = true;
  group.add(core);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc557,
    transparent: true,
    opacity: 0.82
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.05, 0.025, 12, 48), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.045;
  group.add(ring);

  const light = new THREE.PointLight(0xff9a2f, pad.amount >= 40 ? 9 : 5, pad.amount >= 40 ? 4.5 : 3);
  light.position.y = 0.35;
  group.add(light);

  return {
    group,
    core,
    ring,
    light,
    active: pad.active,
    amount: pad.amount
  };
}

function drawOverlay(time) {
  if (!minimap || !state.snapshot) return;

  const width = window.innerWidth < 720 ? 126 : 182;
  const height = width * (WORLD.height / WORLD.width);
  const x = window.innerWidth < 720 ? 12 : 22;
  const y = window.innerHeight - height - (window.innerWidth < 720 ? 12 : 22);
  const scaleX = width / WORLD.width;
  const scaleY = height / WORLD.height;

  minimap.clear();
  minimap.roundRect(x, y, width, height, 8).fill({ color: 0x050908, alpha: 0.5 });
  minimap.roundRect(x, y, width, height, 8).stroke({ color: 0xe6f5ee, width: 1, alpha: 0.22 });
  minimap.rect(x, y + height / 2 - GOAL_WIDTH / SCALE * scaleY / 2, 8, GOAL_WIDTH / SCALE * scaleY)
    .fill({ color: TEAM_COLORS.blue, alpha: 0.45 });
  minimap.rect(x + width - 8, y + height / 2 - GOAL_WIDTH / SCALE * scaleY / 2, 8, GOAL_WIDTH / SCALE * scaleY)
    .fill({ color: TEAM_COLORS.orange, alpha: 0.45 });
  minimap.moveTo(x + width / 2, y + 4).lineTo(x + width / 2, y + height - 4)
    .stroke({ color: 0xe6f5ee, width: 1, alpha: 0.24 });

  const ball = state.snapshot.ball;
  minimap.circle(x + ball.x * scaleX, y + ball.y * scaleY, 4).fill(0xf5f1df);

  for (const pad of state.snapshot.boostPads || []) {
    const alpha = pad.active ? 0.74 + Math.sin(time / 220) * 0.12 : 0.18;
    minimap.circle(x + pad.x * scaleX, y + pad.y * scaleY, pad.amount >= 40 ? 3.2 : 2.4)
      .fill({ color: 0xffb233, alpha });
  }

  for (const player of state.snapshot.players) {
    const radius = player.id === state.playerId ? 4.8 : 3.6;
    minimap.circle(x + player.x * scaleX, y + player.y * scaleY, radius)
      .fill(player.team === 'blue' ? TEAM_COLORS.blue : TEAM_COLORS.orange);
    if (player.id === state.playerId) {
      minimap.circle(x + player.x * scaleX, y + player.y * scaleY, radius + 2.4)
        .stroke({ color: 0xffffff, width: 1.2, alpha: 0.9 });
    }
  }
}

function updateHud(snapshot) {
  elements.blueScore.textContent = snapshot.score.blue;
  elements.orangeScore.textContent = snapshot.score.orange;
  elements.clock.textContent = formatClock(snapshot.timeRemaining);

  const localPlayer = snapshot.players.find((player) => player.id === state.playerId);
  const speed = localPlayer ? Math.round(Math.hypot(localPlayer.vx, localPlayer.vy) * 0.18) : 0;
  const boost = localPlayer ? Math.round(localPlayer.boost) : 0;
  elements.speedValue.textContent = speed;
  elements.boostValue.textContent = boost;
  elements.boostGauge.style.setProperty('--boost', `${boost * 3.6}deg`);

  elements.matchRoom.textContent = snapshot.room;
}

function requestJoin(room, playerName) {
  state.room = room;
  state.playerName = playerName;
  state.pendingJoin = { room, playerName };
  localStorage.setItem('pra-driver', playerName);
  elements.matchRoom.textContent = room;
  updateConnection(socket.connected ? 'Joining' : 'Connecting', false);

  if (!socket.connected) {
    socket.connect();
    return;
  }

  joinRoom(room, playerName);
}

function joinRoom(room, playerName = state.playerName) {
  socket.emit('room:join', { room, name: playerName });
}

function updateConnection(text, connected) {
  elements.statusText.textContent = text;
  elements.statusDot.classList.toggle('online', connected);
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function worldToScene(x, y, z = 0) {
  return new THREE.Vector3((x - WORLD.width / 2) * SCALE, z * SCALE, (y - WORLD.height / 2) * SCALE);
}

function dampAngle(current, target, smoothing) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * smoothing;
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

function randomRoomName() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = 'arena-';
  for (let i = 0; i < 4; i += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)].toLowerCase();
  }
  return value;
}

function formatClock(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return map[char];
  });
}
