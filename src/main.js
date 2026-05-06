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
const DEMOLITION_EFFECT_DURATION = 0.82;

const TEAM_COLORS = {
  blue: 0x2d9cff,
  orange: 0xff8f2d
};

const TEAM_ACCENTS = {
  blue: 0x9bdfff,
  orange: 0xffcf96
};

const INPUT_SETTINGS = {
  deadzone: 0.14,
  triggerDeadzone: 0.04,
  steerExponent: 1.45,
  throttleExponent: 1.18,
  steerRise: 5.2,
  steerFall: 9.4,
  throttleRise: 4.6,
  throttleFall: 8.2,
  sendIntervalMs: 1000 / 60
};

const SOUNDTRACKS = [
  {
    id: 'overtime-pulse',
    title: 'Overtime Pulse',
    bpm: 132,
    root: 55,
    bass: [0, null, 0, 7, 3, null, 5, 7, 0, null, 10, 7, 5, null, 3, 0],
    lead: [12, null, 15, null, 17, null, 19, 17, 15, null, 12, null, 10, null, 12, null],
    chords: [[0, 7, 10], [3, 10, 15], [5, 12, 17], [10, 15, 19]],
    kick: [0, 4, 8, 12, 14],
    snare: [4, 12],
    hat: [2, 6, 10, 14],
    tone: 0x73c9ff
  },
  {
    id: 'neon-kickoff',
    title: 'Neon Kickoff',
    bpm: 146,
    root: 61.74,
    bass: [0, 0, 7, null, 10, 7, 5, null, 0, 0, 12, null, 10, 7, 5, 3],
    lead: [19, 17, null, 15, 22, null, 19, null, 17, 15, null, 12, 15, null, 17, null],
    chords: [[0, 7, 12], [5, 10, 17], [3, 10, 15], [7, 12, 19]],
    kick: [0, 3, 6, 8, 11, 14],
    snare: [4, 12],
    hat: [1, 3, 5, 7, 9, 11, 13, 15],
    tone: 0xffb233
  },
  {
    id: 'midfield-drift',
    title: 'Midfield Drift',
    bpm: 118,
    root: 49,
    bass: [0, null, 0, null, 5, null, 7, null, 10, null, 7, null, 5, null, 3, null],
    lead: [12, null, null, 15, null, 17, null, null, 19, null, 17, null, 15, null, null, 12],
    chords: [[0, 7, 12], [10, 15, 19], [5, 12, 17], [3, 10, 15]],
    kick: [0, 8],
    snare: [4, 12],
    hat: [2, 6, 10, 14],
    tone: 0x42e18d
  }
];

const MUSIC_VOLUME = 0.18;
const SFX_VOLUME = 0.72;

const SOUND_ASSETS = {
  ballHit: [
    '/assets/audio/ball-hit-soft.ogg',
    '/assets/audio/ball-hit-punch.ogg'
  ],
  carCollision: [
    '/assets/audio/car-collision.ogg',
    '/assets/audio/car-metal-heavy.ogg'
  ],
  demolition: [
    '/assets/audio/demo-explosion.wav'
  ]
};

const controls = {
  up: false,
  down: false,
  left: false,
  right: false,
  boost: false,
  jump: false,
  throttle: 0,
  steer: 0
};

const keyboardControls = createDigitalControls();
const touchControls = createDigitalControls();
const touchAxes = {
  throttle: 0,
  steer: 0
};
let activeGamepadIndex = null;

const audioState = {
  context: null,
  master: null,
  compressor: null,
  noiseBuffer: null,
  timer: null,
  active: false,
  track: null,
  step: 0,
  nextStepTime: 0,
  soundBuffers: new Map(),
  soundLoads: new Map(),
  soundCursor: new Map()
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
  explosions: [],
  pendingDemolitions: [],
  goalBannerUntil: 0,
  goalBannerTeam: null,
  trackId: safeTrackId(localStorage.getItem('pra-track')),
  audioMuted: localStorage.getItem('pra-muted') === 'true'
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
  audioToggle: document.querySelector('.audio-toggle'),
  trackButtons: document.querySelectorAll('[data-track]'),
  activeTrackName: document.querySelector('.active-track-name'),
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
updateTrackUi();

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
let previousInputTime = performance.now();
let smoothedLookAt = new THREE.Vector3(0, 0, 0);

bootstrap();

async function bootstrap() {
  bindInput();
  bindSocket();
  socket.connect();
  startInputLoop();

  await initThree();
  await initOverlay();
  sceneReady = true;
  if (state.snapshot) {
    syncSnapshot(state.snapshot);
  }
  for (const demolition of state.pendingDemolitions.splice(0)) {
    spawnDemolitionExplosion(demolition);
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
  bindBrowserGestureGuards();

  window.addEventListener('keydown', (event) => {
    const control = keyMap.get(event.code);
    if (!control) return;
    keyboardControls[control] = true;
    event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    const control = keyMap.get(event.code);
    if (!control) return;
    keyboardControls[control] = false;
    event.preventDefault();
  });

  bindDriveStick();

  document.querySelectorAll('[data-touch]').forEach((button) => {
    const control = button.dataset.touch;
    const setPressed = (pressed) => {
      touchControls[control] = pressed;
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

  window.addEventListener('gamepadconnected', (event) => {
    activeGamepadIndex = event.gamepad.index;
  });

  window.addEventListener('gamepaddisconnected', (event) => {
    if (activeGamepadIndex === event.gamepad.index) {
      activeGamepadIndex = null;
    }
  });

  window.addEventListener('blur', () => {
    resetDigitalControls(keyboardControls);
    resetDigitalControls(touchControls);
    resetTouchAxes();
    document.querySelector('[data-drive-stick]')?.classList.remove('active');
    const stickKnob = document.querySelector('.drive-stick-knob');
    if (stickKnob) {
      stickKnob.style.transform = 'translate(-50%, -50%)';
    }
    document.querySelectorAll('[data-touch]').forEach((button) => {
      button.classList.remove('pressed');
    });
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

  elements.trackButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setTrack(button.dataset.track);
      if (!state.audioMuted) {
        void startSoundtrack();
      }
    });
  });

  elements.audioToggle.addEventListener('click', () => {
    setAudioMuted(!state.audioMuted);
    if (!state.audioMuted) {
      void startSoundtrack();
    }
  });
}

function bindBrowserGestureGuards() {
  const isInGame = () => elements.app.classList.contains('in-game');
  const preventInGame = (event) => {
    if (isInGame()) {
      event.preventDefault();
    }
  };

  window.addEventListener('dblclick', preventInGame, { passive: false });
  window.addEventListener('contextmenu', preventInGame, { passive: false });

  for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
    window.addEventListener(eventName, preventInGame, { passive: false });
  }

  let lastTouchEndAt = 0;
  window.addEventListener('touchend', (event) => {
    if (!isInGame()) return;

    const now = performance.now();
    if (now - lastTouchEndAt < 360) {
      event.preventDefault();
    }
    lastTouchEndAt = now;
  }, { passive: false });
}

function bindDriveStick() {
  const stick = document.querySelector('[data-drive-stick]');
  const knob = stick?.querySelector('.drive-stick-knob');
  if (!stick || !knob) return;

  let pointerId = null;

  const updateFromPointer = (event) => {
    const rect = stick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.42);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const rawX = THREE.MathUtils.clamp((event.clientX - centerX) / radius, -1, 1);
    const rawY = THREE.MathUtils.clamp((event.clientY - centerY) / radius, -1, 1);
    const steer = curveAxis(normalizeAxis(rawX, 0.05), 1.12);
    const vertical = -rawY;
    const throttle = vertical < -0.34
      ? THREE.MathUtils.clamp(vertical, -1, 0)
      : THREE.MathUtils.clamp(
          0.72 + Math.max(0, vertical) * 0.28 - Math.max(0, -vertical) * 0.42,
          0.24,
          1
        );

    touchAxes.steer = roundInput(steer);
    touchAxes.throttle = roundInput(throttle);
    knob.style.transform =
      `translate(-50%, -50%) translate(${rawX * radius}px, ${rawY * radius}px)`;
  };

  const resetStick = () => {
    pointerId = null;
    resetTouchAxes();
    stick.classList.remove('active');
    knob.style.transform = 'translate(-50%, -50%)';
  };

  stick.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    pointerId = event.pointerId;
    stick.setPointerCapture(pointerId);
    stick.classList.add('active');
    updateFromPointer(event);
  });

  stick.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    updateFromPointer(event);
  });

  stick.addEventListener('pointerup', (event) => {
    if (event.pointerId === pointerId) {
      resetStick();
    }
  });
  stick.addEventListener('pointercancel', (event) => {
    if (event.pointerId === pointerId) {
      resetStick();
    }
  });
  stick.addEventListener('lostpointercapture', resetStick);
}

function createDigitalControls() {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    boost: false,
    jump: false
  };
}

function resetDigitalControls(target) {
  for (const key of Object.keys(target)) {
    target[key] = false;
  }
}

function resetTouchAxes() {
  touchAxes.throttle = 0;
  touchAxes.steer = 0;
}

function updateControlState(dt) {
  const gamepad = readGamepadInput();
  const keyboardThrottle = digitalAxis(keyboardControls.down, keyboardControls.up);
  const touchThrottle = digitalAxis(touchControls.down, touchControls.up);
  const keyboardSteer = digitalAxis(keyboardControls.left, keyboardControls.right);
  const touchSteer = touchAxes.steer;
  const digital = {
    up: keyboardControls.up || touchControls.up || touchAxes.throttle > 0.08,
    down: keyboardControls.down || touchControls.down || touchAxes.throttle < -0.08,
    left: keyboardControls.left || touchControls.left || touchAxes.steer < -0.08,
    right: keyboardControls.right || touchControls.right || touchAxes.steer > 0.08,
    boost: keyboardControls.boost || touchControls.boost,
    jump: keyboardControls.jump || touchControls.jump
  };

  const throttleTarget = mergeAxis(
    mergeAxis(keyboardThrottle, touchThrottle),
    mergeAxis(touchAxes.throttle, gamepad.throttle)
  );
  const steerTarget = mergeAxis(mergeAxis(keyboardSteer, touchSteer), gamepad.steer);

  controls.throttle = roundInput(smoothAxis(
    controls.throttle,
    throttleTarget,
    INPUT_SETTINGS.throttleRise,
    INPUT_SETTINGS.throttleFall,
    dt
  ));
  controls.steer = roundInput(smoothAxis(
    controls.steer,
    steerTarget,
    INPUT_SETTINGS.steerRise,
    INPUT_SETTINGS.steerFall,
    dt
  ));

  controls.boost = digital.boost || gamepad.boost;
  controls.jump = digital.jump || gamepad.jump;
  controls.up = digital.up || controls.throttle > 0.08;
  controls.down = digital.down || controls.throttle < -0.08;
  controls.left = digital.left || controls.steer < -0.08;
  controls.right = digital.right || controls.steer > 0.08;
}

function readGamepadInput() {
  const gamepads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  let gamepad = activeGamepadIndex !== null ? gamepads[activeGamepadIndex] : null;

  if (!gamepad) {
    gamepad = Array.from(gamepads).find(Boolean) || null;
    activeGamepadIndex = gamepad ? gamepad.index : null;
  }

  if (!gamepad) {
    return {
      throttle: 0,
      steer: 0,
      boost: false,
      jump: false
    };
  }

  const leftStickX = curveAxis(normalizeAxis(gamepad.axes[0] || 0), INPUT_SETTINGS.steerExponent);
  const leftStickY = curveAxis(normalizeAxis(-(gamepad.axes[1] || 0), 0.2), INPUT_SETTINGS.throttleExponent);
  const triggerThrottle = triggerValue(gamepad, 7) - triggerValue(gamepad, 6);
  const dpadThrottle = digitalAxis(isGamepadButtonPressed(gamepad, 13), isGamepadButtonPressed(gamepad, 12));
  const dpadSteer = digitalAxis(isGamepadButtonPressed(gamepad, 14), isGamepadButtonPressed(gamepad, 15));

  return {
    throttle: mergeAxis(mergeAxis(triggerThrottle, leftStickY), dpadThrottle),
    steer: mergeAxis(leftStickX, dpadSteer),
    boost: isGamepadButtonPressed(gamepad, 1) || isGamepadButtonPressed(gamepad, 5),
    jump: isGamepadButtonPressed(gamepad, 0)
  };
}

function triggerValue(gamepad, index) {
  const button = gamepad.buttons[index];
  const value = button ? button.value : 0;
  return value > INPUT_SETTINGS.triggerDeadzone ? value : 0;
}

function isGamepadButtonPressed(gamepad, index) {
  const button = gamepad.buttons[index];
  return Boolean(button?.pressed || button?.value > 0.45);
}

function digitalAxis(negative, positive) {
  return Number(Boolean(positive)) - Number(Boolean(negative));
}

function mergeAxis(primary, secondary) {
  return Math.abs(secondary) > Math.abs(primary) ? secondary : primary;
}

function normalizeAxis(value, deadzone = INPUT_SETTINGS.deadzone) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;

  const absolute = Math.abs(number);
  if (absolute <= deadzone) return 0;

  return Math.sign(number) * ((absolute - deadzone) / (1 - deadzone));
}

function curveAxis(value, exponent) {
  return Math.sign(value) * Math.pow(Math.abs(value), exponent);
}

function smoothAxis(current, target, riseRate, fallRate, dt) {
  const gainingInput =
    Math.abs(target) > Math.abs(current) &&
    Math.sign(target || current) === Math.sign(current || target);
  const rate = gainingInput ? riseRate : fallRate;
  return approach(current, target, rate * dt);
}

function approach(current, target, delta) {
  if (current < target) return Math.min(current + delta, target);
  if (current > target) return Math.max(current - delta, target);
  return target;
}

function roundInput(value) {
  return Math.abs(value) < 0.001 ? 0 : Math.round(value * 1000) / 1000;
}

function setTrack(trackId) {
  const track = getTrack(trackId);
  state.trackId = track.id;
  localStorage.setItem('pra-track', track.id);
  updateTrackUi();

  if (audioState.active) {
    audioState.track = track;
    audioState.step = 0;
    audioState.nextStepTime = audioState.context.currentTime + 0.04;
  }
}

function setAudioMuted(muted) {
  state.audioMuted = muted;
  localStorage.setItem('pra-muted', String(muted));
  updateTrackUi();

  if (!audioState.master || !audioState.context) return;

  const targetVolume = muted ? 0.0001 : MUSIC_VOLUME;
  audioState.master.gain.cancelScheduledValues(audioState.context.currentTime);
  audioState.master.gain.setTargetAtTime(targetVolume, audioState.context.currentTime, 0.04);

  if (muted) {
    audioState.active = false;
    if (audioState.timer) {
      window.clearInterval(audioState.timer);
      audioState.timer = null;
    }
  }
}

function updateTrackUi() {
  const track = getTrack(state.trackId);
  elements.activeTrackName.textContent = track.title;
  elements.audioToggle.textContent = state.audioMuted ? 'Sound Off' : 'Sound On';
  elements.audioToggle.setAttribute('aria-pressed', String(state.audioMuted));

  elements.trackButtons.forEach((button) => {
    const active = button.dataset.track === track.id;
    button.setAttribute('aria-checked', String(active));
  });
}

async function startSoundtrack() {
  if (state.audioMuted) return;

  const context = initAudio();
  if (!context) return;

  await context.resume().catch(() => {});
  void preloadSoundAssets();
  audioState.track = getTrack(state.trackId);
  audioState.active = true;

  if (!audioState.nextStepTime || audioState.nextStepTime < context.currentTime) {
    audioState.step = 0;
    audioState.nextStepTime = context.currentTime + 0.04;
  }

  audioState.master.gain.cancelScheduledValues(context.currentTime);
  audioState.master.gain.setTargetAtTime(MUSIC_VOLUME, context.currentTime, 0.08);

  if (!audioState.timer) {
    audioState.timer = window.setInterval(scheduleMusic, 25);
  }
}

function initAudio() {
  if (audioState.context) return audioState.context;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    elements.audioToggle.disabled = true;
    elements.audioToggle.textContent = 'No Audio';
    return null;
  }

  const context = new AudioContext();
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.22;
  master.gain.value = state.audioMuted ? 0.0001 : MUSIC_VOLUME;
  master.connect(compressor);
  compressor.connect(context.destination);

  audioState.context = context;
  audioState.master = master;
  audioState.compressor = compressor;
  return context;
}

function scheduleMusic() {
  if (!audioState.active || !audioState.context || !audioState.master) return;

  const context = audioState.context;
  const track = audioState.track || getTrack(state.trackId);
  const stepDuration = 60 / track.bpm / 4;
  const scheduleUntil = context.currentTime + 0.16;

  while (audioState.nextStepTime < scheduleUntil) {
    scheduleMusicStep(track, audioState.step, audioState.nextStepTime, stepDuration);
    audioState.nextStepTime += stepDuration;
    audioState.step = (audioState.step + 1) % 32;
  }
}

function scheduleMusicStep(track, step, time, stepDuration) {
  const patternStep = step % 16;

  if (track.kick.includes(patternStep)) {
    scheduleKick(time);
  }

  if (track.snare.includes(patternStep)) {
    scheduleSnare(time);
  }

  if (track.hat.includes(patternStep)) {
    scheduleHat(time);
  }

  const bassSemi = track.bass[patternStep];
  if (bassSemi !== null && patternStep % 2 === 0) {
    scheduleTone({
      type: 'sawtooth',
      frequency: noteFrequency(track.root, bassSemi),
      time,
      duration: stepDuration * 1.9,
      volume: 0.09,
      filterFrequency: 420
    });
  }

  const leadSemi = track.lead[patternStep];
  if (leadSemi !== null) {
    scheduleTone({
      type: 'triangle',
      frequency: noteFrequency(track.root, leadSemi + 12),
      time: time + stepDuration * 0.05,
      duration: stepDuration * 0.78,
      volume: 0.045,
      filterFrequency: 2400
    });
  }

  if (patternStep === 0 || patternStep === 8) {
    const chord = track.chords[(step / 8) % track.chords.length];
    scheduleChord(track, chord, time, stepDuration * 7.4);
  }
}

function scheduleTone({ type, frequency, time, duration, volume, filterFrequency }) {
  const context = audioState.context;
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, time);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFrequency, time);
  filter.Q.setValueAtTime(0.8, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), time + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(audioState.master);
  oscillator.start(time);
  oscillator.stop(time + duration + 0.04);
}

function scheduleChord(track, chord, time, duration) {
  chord.forEach((semitone, index) => {
    scheduleTone({
      type: index === 1 ? 'triangle' : 'sawtooth',
      frequency: noteFrequency(track.root, semitone + 24),
      time: time + index * 0.012,
      duration,
      volume: 0.026,
      filterFrequency: 1600
    });
  });
}

function scheduleKick(time) {
  const context = audioState.context;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(145, time);
  oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.18);
  gain.gain.setValueAtTime(0.52, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);

  oscillator.connect(gain);
  gain.connect(audioState.master);
  oscillator.start(time);
  oscillator.stop(time + 0.22);
}

function scheduleSnare(time) {
  const context = audioState.context;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = getNoiseBuffer();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1800, time);
  filter.Q.setValueAtTime(0.7, time);
  gain.gain.setValueAtTime(0.11, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioState.master);
  source.start(time);
  source.stop(time + 0.13);
}

function scheduleHat(time) {
  const context = audioState.context;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = getNoiseBuffer();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(6400, time);
  gain.gain.setValueAtTime(0.045, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioState.master);
  source.start(time);
  source.stop(time + 0.06);
}

function preloadSoundAssets() {
  if (!audioState.context) return Promise.resolve();

  const urls = Object.values(SOUND_ASSETS).flat();
  return Promise.all(urls.map((url) => loadSoundBuffer(url)));
}

function loadSoundBuffer(url) {
  if (audioState.soundBuffers.has(url)) {
    return Promise.resolve(audioState.soundBuffers.get(url));
  }

  if (audioState.soundLoads.has(url)) {
    return audioState.soundLoads.get(url);
  }

  const load = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((data) => audioState.context.decodeAudioData(data))
    .then((buffer) => {
      audioState.soundBuffers.set(url, buffer);
      return buffer;
    })
    .catch((error) => {
      console.warn(`Could not load sound effect ${url}`, error);
      return null;
    });

  audioState.soundLoads.set(url, load);
  return load;
}

function playSampledSound(group, { volume = 1, playbackRate = 1 } = {}) {
  if (state.audioMuted || !audioState.context || !audioState.master) return false;

  const urls = SOUND_ASSETS[group];
  if (!urls?.length) return false;

  const cursor = audioState.soundCursor.get(group) || 0;
  const url = urls[cursor % urls.length];
  audioState.soundCursor.set(group, cursor + 1);

  const buffer = audioState.soundBuffers.get(url);
  if (!buffer) {
    void loadSoundBuffer(url);
    return false;
  }

  const source = audioState.context.createBufferSource();
  const gain = audioState.context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = THREE.MathUtils.clamp(playbackRate, 0.65, 1.45);
  gain.gain.value = THREE.MathUtils.clamp(volume * SFX_VOLUME, 0, 1.2);
  source.connect(gain);
  gain.connect(audioState.master);
  source.start();
  return true;
}

function eventVolume(event, baseVolume) {
  const localPlayer = state.snapshot?.players?.find((player) => player.id === state.playerId);
  if (!localPlayer || !Number.isFinite(event?.x) || !Number.isFinite(event?.y)) {
    return baseVolume;
  }

  const distance = Math.hypot(localPlayer.x - event.x, localPlayer.y - event.y);
  const attenuation = THREE.MathUtils.clamp(1 - distance / 2600, 0.38, 1);
  return baseVolume * attenuation;
}

function playBallHitSound(hit = {}) {
  if (state.audioMuted || !audioState.context || !audioState.master) return;

  const { intensity = 0.45, team = 'blue' } = hit;
  const clamped = THREE.MathUtils.clamp(Number(intensity) || 0.45, 0.2, 1);
  const sampled = playSampledSound('ballHit', {
    volume: eventVolume(hit, 0.18 + clamped * 0.2),
    playbackRate: 0.88 + clamped * 0.22
  });
  if (sampled) return;

  const context = audioState.context;
  const now = context.currentTime + 0.012;
  const teamRoot = team === 'orange' ? 92.5 : 82.41;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(teamRoot * (1 + clamped * 0.7), now);
  oscillator.frequency.exponentialRampToValueAtTime(teamRoot * 0.58, now + 0.11);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900 + clamped * 1800, now);
  gain.gain.setValueAtTime(0.11 * clamped, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(audioState.master);
  oscillator.start(now);
  oscillator.stop(now + 0.15);

  const source = context.createBufferSource();
  const noiseFilter = context.createBiquadFilter();
  const noiseGain = context.createGain();
  source.buffer = getNoiseBuffer();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(1400 + clamped * 1500, now);
  noiseFilter.Q.setValueAtTime(1.4, now);
  noiseGain.gain.setValueAtTime(0.04 * clamped, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  source.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(audioState.master);
  source.start(now);
  source.stop(now + 0.09);
}

function playCarCollisionSound(collision = {}) {
  const intensity = THREE.MathUtils.clamp(Number(collision.intensity) || 0.35, 0.16, 1);
  playSampledSound('carCollision', {
    volume: eventVolume(collision, 0.16 + intensity * 0.42),
    playbackRate: 0.84 + intensity * 0.26
  });
}

function playDemolitionSound(demolition = {}) {
  playSampledSound('demolition', {
    volume: eventVolume(demolition, 0.86),
    playbackRate: 0.94 + Math.random() * 0.08
  });
}

function playGoalCelebration(team) {
  if (state.audioMuted || !audioState.context || !audioState.master) return;

  const root = team === 'blue' ? 73.42 : 82.41;
  const now = audioState.context.currentTime + 0.02;
  [0, 7, 12, 19, 24, 31].forEach((semitone, index) => {
    scheduleTone({
      type: 'triangle',
      frequency: noteFrequency(root, semitone + 24),
      time: now + index * 0.055,
      duration: 0.46,
      volume: 0.062,
      filterFrequency: 3600
    });
  });

  [0, 0.16, 0.32, 0.56].forEach((offset) => {
    scheduleKick(now + offset);
  });
  [0.24, 0.48, 0.72].forEach((offset) => {
    scheduleSnare(now + offset);
  });
  scheduleCrowdSweep(now, team);
}

function scheduleCrowdSweep(time, team) {
  const context = audioState.context;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = getNoiseBuffer();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(team === 'blue' ? 900 : 1100, time);
  filter.frequency.linearRampToValueAtTime(2800, time + 0.72);
  filter.Q.setValueAtTime(0.55, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.09, time + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.84);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioState.master);
  source.start(time);
  source.stop(time + 0.88);
}

function getNoiseBuffer() {
  if (audioState.noiseBuffer) return audioState.noiseBuffer;

  const context = audioState.context;
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }

  audioState.noiseBuffer = buffer;
  return buffer;
}

function noteFrequency(root, semitone) {
  return root * Math.pow(2, semitone / 12);
}

function getTrack(trackId) {
  return SOUNDTRACKS.find((track) => track.id === trackId) || SOUNDTRACKS[0];
}

function safeTrackId(trackId) {
  return getTrack(trackId).id;
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
    playGoalCelebration(team);
  });

  socket.on('game:ball-hit', (hit) => {
    playBallHitSound(hit);
  });

  socket.on('game:car-collision', (collision) => {
    playCarCollisionSound(collision);
  });

  socket.on('game:demolition', (demolition) => {
    playDemolitionSound(demolition);
    if (!sceneReady) {
      state.pendingDemolitions.push(demolition);
      return;
    }
    spawnDemolitionExplosion(demolition);
  });
}

function startInputLoop() {
  window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - previousInputTime) / 1000));
    previousInputTime = now;
    updateControlState(dt);

    if (state.hasJoined && socket.connected) {
      socket.emit('player:input', {
        seq: inputFrame++,
        room: state.room,
        input: { ...controls }
      });
    }
  }, INPUT_SETTINGS.sendIntervalMs);
}

function tick(dt, time) {
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
    const wasDemolished = Boolean(playerObject.target.demolished);
    const targetPosition = worldToScene(player.x, player.y, player.z + 18);
    playerObject.target.position.copy(targetPosition);
    playerObject.target.angle = player.angle;
    playerObject.target.boost = player.boost;
    playerObject.target.boosting = player.boosting;
    playerObject.target.grounded = player.grounded;
    playerObject.target.demolished = player.demolished;
    playerObject.target.bot = player.bot;
    playerObject.target.speed = Math.hypot(player.vx, player.vy);
    playerObject.target.velocity = {
      x: player.vx,
      z: player.vy
    };
    playerObject.target.steer = player.id === state.playerId ? controls.steer : estimateSteer(playerObject, player.angle);
    playerObject.data = player;

    if (wasDemolished && !player.demolished) {
      playerObject.group.position.copy(targetPosition);
      playerObject.shadow.position.set(targetPosition.x, 0.032, targetPosition.z);
    }
  }

  for (const [id, playerObject] of state.players.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(playerObject.group, playerObject.shadow);
      disposeObject3D(playerObject.group);
      disposeObject3D(playerObject.shadow);
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

    if (target.demolished) {
      group.visible = false;
      shadow.visible = false;
      flame.visible = false;
      flameLight.visible = false;
      continue;
    }

    group.visible = true;
    shadow.visible = true;

    const forward = new THREE.Vector3(Math.cos(target.angle), 0, Math.sin(target.angle));
    const velocity = target.velocity || { x: 0, z: 0 };
    const forwardSpeed = velocity.x * forward.x + velocity.z * forward.z;
    const rollDistance = (forwardSpeed * SCALE * dt) / 0.17;

    group.position.lerp(target.position, smoothing);
    group.rotation.y = dampAngle(group.rotation.y, -target.angle, smoothing);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, target.grounded ? 0 : 0.12, smoothing * 0.55);

    for (const wheel of playerObject.wheels) {
      wheel.mesh.rotation.z += rollDistance;
      wheel.pivot.rotation.y = THREE.MathUtils.lerp(
        wheel.pivot.rotation.y,
        wheel.steerable ? -(target.steer || 0) * 0.48 : 0,
        smoothing
      );
    }

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

  updateExplosions(dt);
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
  const hubMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7c8c0,
    roughness: 0.42,
    metalness: 0.52
  });
  const wheels = [];

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
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.16, z);

      const roller = new THREE.Group();
      pivot.add(roller);

      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 20), tireMaterial);
      wheel.rotation.x = Math.PI / 2;
      wheel.castShadow = true;
      roller.add(wheel);

      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.172, 14), hubMaterial);
      hub.rotation.x = Math.PI / 2;
      hub.castShadow = true;
      roller.add(hub);

      for (const rotation of [0, Math.PI / 2]) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.032, 0.018), hubMaterial);
        spoke.position.z = z > 0 ? 0.09 : -0.09;
        spoke.rotation.z = rotation;
        spoke.castShadow = true;
        roller.add(spoke);
      }

      group.add(pivot);
      wheels.push({
        pivot,
        mesh: roller,
        steerable: x > 0
      });

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
    wheels,
    target: {
      position: worldToScene(player.x, player.y, player.z + 18),
      angle: player.angle,
      boost: player.boost,
      boosting: player.boosting,
      grounded: player.grounded,
      demolished: player.demolished,
      bot: player.bot,
      speed: 0,
      steer: 0,
      velocity: { x: 0, z: 0 },
      previousAngle: player.angle
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

function spawnDemolitionExplosion(demolition) {
  const team = demolition.victimTeam === 'blue' ? 'blue' : 'orange';
  const color = TEAM_COLORS[team];
  const accentColor = TEAM_ACCENTS[team];
  const group = new THREE.Group();
  group.position.copy(worldToScene(demolition.x, demolition.y, 54));

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 32, 16),
    new THREE.MeshBasicMaterial({
      color: 0xfff4ce,
      transparent: true,
      opacity: 1,
      depthWrite: false
    })
  );
  group.add(core);

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 32, 16),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    })
  );
  group.add(shell);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.46, 0.035, 10, 54),
    new THREE.MeshBasicMaterial({
      color: accentColor,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const light = new THREE.PointLight(color, 22, 7);
  group.add(light);

  const sparks = [];
  for (let i = 0; i < 18; i += 1) {
    const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.28;
    const lift = 1.4 + Math.random() * 2.1;
    const speed = 2.2 + Math.random() * 2.8;
    const spark = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.055, 0.22 + Math.random() * 0.16),
      new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? accentColor : 0xffe4a0,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      })
    );
    spark.position.set(0, 0, 0);
    spark.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    group.add(spark);
    sparks.push({
      mesh: spark,
      velocity: new THREE.Vector3(Math.cos(angle) * speed, lift, Math.sin(angle) * speed),
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8)
    });
  }

  scene.add(group);
  state.explosions.push({
    group,
    core,
    shell,
    ring,
    light,
    sparks,
    age: 0,
    duration: DEMOLITION_EFFECT_DURATION
  });
}

function updateExplosions(dt) {
  for (let i = state.explosions.length - 1; i >= 0; i -= 1) {
    const explosion = state.explosions[i];
    explosion.age += dt;
    const progress = THREE.MathUtils.clamp(explosion.age / explosion.duration, 0, 1);
    const fade = 1 - progress;
    const bloom = 1 - Math.pow(1 - progress, 2);

    explosion.core.scale.setScalar(1 + bloom * 2.2);
    explosion.core.material.opacity = fade;
    explosion.shell.scale.setScalar(1 + bloom * 4.4);
    explosion.shell.material.opacity = fade * 0.72;
    explosion.ring.scale.setScalar(1 + bloom * 5.2);
    explosion.ring.rotation.z += dt * 5.4;
    explosion.ring.material.opacity = fade * 0.84;
    explosion.light.intensity = fade * 22;

    for (const spark of explosion.sparks) {
      spark.velocity.y -= 5.6 * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.mesh.rotation.x += spark.spin.x * dt;
      spark.mesh.rotation.y += spark.spin.y * dt;
      spark.mesh.rotation.z += spark.spin.z * dt;
      spark.mesh.material.opacity = fade;
    }

    if (progress >= 1) {
      scene.remove(explosion.group);
      disposeObject3D(explosion.group);
      state.explosions.splice(i, 1);
    }
  }
}

function disposeObject3D(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose());
    } else if (child.material) {
      child.material.dispose();
    }
  });
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
    if (player.demolished) continue;

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
  void startSoundtrack();
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

function estimateSteer(playerObject, angle) {
  const previousAngle = playerObject.target.previousAngle ?? angle;
  const delta = Math.atan2(Math.sin(angle - previousAngle), Math.cos(angle - previousAngle));
  playerObject.target.previousAngle = angle;
  return THREE.MathUtils.clamp(delta * 18, -1, 1);
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
