import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Pause, Play, RotateCcw, Save, Trophy } from 'lucide-react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

const COUNTRY_SIZE = 1800;
const HALF_COUNTRY = COUNTRY_SIZE / 2;
const MAX_WORLD_PHASE = 4;
const MAX_LOGICAL_SIZE = 1e24;
const MAX_VISUAL_SIZE = 820;
const MIN_LOGICAL_SIZE = 0.04;
const START_SIZE = 0.35;
const BASE_ENTITY_COUNT = 92;
const DEFAULT_SPAWN_MULTIPLIER = 2;
const MAX_SPAWN_MULTIPLIER = 20;
const MAX_RIVAL_REX_COUNT = 6;
const FINAL_GLOBE_SIZE = 900;
const MAX_SCENERY_EATS_PER_FRAME = 1;
const ENTITY_GROWTH_CAP_RATIO = 0.045;
const SCENERY_GROWTH_CAP_RATIO = 0.045;
const SPAWN_EDIBLE_SIZE_RATIO = 0.9;
const LEADERBOARD_STORAGE_KEY = 'monkey-madness:top-scores:v1';
const LAST_PLAYER_NAME_KEY = 'monkey-madness:last-player-name';
const MAX_LEADERBOARD_ENTRIES = 8;
const MAX_PLAYER_NAME_LENGTH = 14;
const GLOBE_RADIUS = 8200;
const GLOBE_WORLD_LIMIT = GLOBE_RADIUS * 0.92;
const CAMERA_ZOOM_MIN = 0.42;
const CAMERA_ZOOM_MAX = 2.35;
const CAMERA_PITCH_MIN = -0.34;
const CAMERA_PITCH_MAX = 0.72;
const RIVAL_EAT_PLAYER_RATIO = 1.16;
const PLAYER_EAT_RIVAL_RATIO = 1.08;
const T_REX_MODEL_URL = `${import.meta.env.BASE_URL}assets/trex/poly-pizza-google-trex.glb`;
const T_REX_MODEL_TARGET_LENGTH = 3.2;
const APP_VERSION = typeof __APP_VERSION__ === 'object' && __APP_VERSION__ ? __APP_VERSION__ : { commitRef: 'dev', commitDate: '', buildTime: '' };
const WORLD_PHASES = [
  { label: 'Country', minSize: START_SIZE },
  { label: 'Town', minSize: 4 },
  { label: 'City', minSize: 24 },
  { label: 'Mountains', minSize: 110 },
  { label: 'Globe', minSize: 320 },
];
const TILE_COORDS_BY_PHASE = [
  [[0, 0]],
  [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, 1],
    [1, -1],
  ],
  [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, 1],
    [1, -1],
    [2, 0],
    [2, 1],
    [3, 1],
    [-2, -1],
    [-3, -1],
    [-3, -2],
  ],
  [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, 1],
    [1, -1],
    [2, 0],
    [2, 1],
    [3, 1],
    [3, 2],
    [-2, -1],
    [-3, -1],
    [-3, -2],
    [-4, 1],
    [-4, 2],
    [4, -1],
    [4, -2],
    [0, 3],
    [1, 3],
    [-1, -3],
  ],
];

const seeded = (value) => {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const safeNumber = (value, fallback = START_SIZE) => (Number.isFinite(value) ? value : fallback);

let uniqueIdCounter = 0;
const createUniqueId = () => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // Fall back below when randomUUID is blocked or unavailable.
  }

  uniqueIdCounter += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${uniqueIdCounter.toString(36)}`;
};

const getSpawnMultiplierFromKeyCode = (code) => {
  const match = /^(?:Numpad|Digit)(\d)$/.exec(code);
  if (!match) return null;
  const value = Number(match[1]);
  return value === 0 ? MAX_SPAWN_MULTIPLIER : value * 2;
};

const getSpawnMultiplier = (value) => clamp(Math.round(safeNumber(value, DEFAULT_SPAWN_MULTIPLIER)), DEFAULT_SPAWN_MULTIPLIER, MAX_SPAWN_MULTIPLIER);

const getTargetEntityCount = (spawnMultiplier = DEFAULT_SPAWN_MULTIPLIER) => Math.round(BASE_ENTITY_COUNT * getSpawnMultiplier(spawnMultiplier));

const getVisualSize = (size) => {
  const safeSize = Math.max(MIN_LOGICAL_SIZE, safeNumber(size));
  if (safeSize <= 60) return safeSize;
  return Math.min(MAX_VISUAL_SIZE, 60 + Math.sqrt(safeSize - 60) * 9.5);
};

const getRelativeVisualSize = (size, referenceSize) => {
  const safeSize = Math.max(MIN_LOGICAL_SIZE, safeNumber(size));
  const safeReference = Math.max(MIN_LOGICAL_SIZE, safeNumber(referenceSize));
  if (safeReference <= 60) return getVisualSize(safeSize);

  const referenceVisual = getVisualSize(safeReference);
  if (safeSize >= safeReference) return Math.min(getVisualSize(safeSize), referenceVisual * 1.05);

  const ratio = clamp(safeSize / safeReference, 0.006, 1);
  return clamp(referenceVisual * ratio ** 0.92, 0.35, referenceVisual * 0.48);
};

const getRivalVisualSize = (size, playerSize) => {
  const safeSize = Math.max(MIN_LOGICAL_SIZE, safeNumber(size));
  const safePlayerSize = Math.max(MIN_LOGICAL_SIZE, safeNumber(playerSize));
  const playerVisual = getVisualSize(safePlayerSize);

  if (safeSize >= safePlayerSize) {
    const ratio = clamp(safeSize / safePlayerSize, 1, 2.6);
    return clamp(playerVisual * ratio ** 0.72, playerVisual * 1.02, playerVisual * 1.82);
  }

  return getRelativeVisualSize(safeSize, safePlayerSize);
};

const getWorldPhase = (size) => {
  const safeSize = Math.max(MIN_LOGICAL_SIZE, safeNumber(size));
  let phase = 0;
  for (let index = 0; index < WORLD_PHASES.length; index += 1) {
    if (safeSize >= WORLD_PHASES[index].minSize) phase = index;
  }
  return clamp(phase, 0, MAX_WORLD_PHASE);
};

const getPhaseLabel = (phase) => WORLD_PHASES[clamp(phase, 0, MAX_WORLD_PHASE)]?.label ?? 'Globe';

const getTileSeed = (tx, tz) => tx * 1009 + tz * 917 + 13;

const getTileRadiusForPhase = (phase) => {
  const safePhase = clamp(phase, 0, MAX_WORLD_PHASE);
  if (safePhase >= 4) return Math.ceil(GLOBE_WORLD_LIMIT / COUNTRY_SIZE);

  const coords = TILE_COORDS_BY_PHASE[safePhase] ?? TILE_COORDS_BY_PHASE[TILE_COORDS_BY_PHASE.length - 1];
  return Math.max(0, ...coords.map(([tx, tz]) => Math.max(Math.abs(tx), Math.abs(tz))));
};

const getTilesForPhase = (phase) => {
  const safePhase = clamp(phase, 0, MAX_WORLD_PHASE);
  const coords = TILE_COORDS_BY_PHASE[Math.min(safePhase, TILE_COORDS_BY_PHASE.length - 1)] ?? TILE_COORDS_BY_PHASE[0];

  return coords.map(([tx, tz]) => ({
    id: `${tx}:${tz}`,
    tx,
    tz,
    tileSeed: getTileSeed(tx, tz),
    offsetX: tx * COUNTRY_SIZE,
    offsetZ: tz * COUNTRY_SIZE,
  }));
};

const getWorldLimit = (phase) => {
  if (phase >= 4) return GLOBE_WORLD_LIMIT;

  const radius = getTileRadiusForPhase(phase);
  return HALF_COUNTRY * 1.42 + radius * COUNTRY_SIZE;
};

const getMoveSpeed = (size, phase = 0) => {
  const safeSize = Math.max(MIN_LOGICAL_SIZE, safeNumber(size));
  const visualSize = getVisualSize(safeSize);
  const phaseBoost = 1 + clamp(phase, 0, MAX_WORLD_PHASE) * 0.18;
  const speed = 13.5 + visualSize * 1.08 * phaseBoost + Math.log1p(safeSize) * 3.9;
  return Math.min(1400, speed);
};

const addGrowth = (size, amount) => clamp(safeNumber(size) + Math.max(0, safeNumber(amount, 0)), START_SIZE, MAX_LOGICAL_SIZE);

const addCappedGrowth = (size, amount, ratio = 0.035, minimum = 0.25) => {
  const safeSize = Math.max(START_SIZE, safeNumber(size));
  return addGrowth(safeSize, Math.min(Math.max(0, safeNumber(amount, 0)), Math.max(minimum, safeSize * ratio)));
};

const getGrowthCapRatio = (size) => {
  const safeSize = Math.max(START_SIZE, safeNumber(size));
  if (safeSize < WORLD_PHASES[1].minSize) return ENTITY_GROWTH_CAP_RATIO;
  if (safeSize < WORLD_PHASES[2].minSize) return 0.035;
  if (safeSize < WORLD_PHASES[3].minSize) return 0.026;
  if (safeSize < WORLD_PHASES[4].minSize) return 0.018;
  return 0.014;
};

const getFrameGrowthLimit = (size) => {
  const safeSize = Math.max(START_SIZE, safeNumber(size));
  return Math.max(0.06, safeSize * (getGrowthCapRatio(safeSize) + 0.004));
};

const getSpawnEdibleSizeRatio = (playerSize) => {
  const safeSize = Math.max(START_SIZE, safeNumber(playerSize));
  if (safeSize < WORLD_PHASES[1].minSize) return SPAWN_EDIBLE_SIZE_RATIO;
  if (safeSize < WORLD_PHASES[2].minSize) return 0.86;
  if (safeSize < WORLD_PHASES[3].minSize) return 0.8;
  return 0.74;
};

const getSceneryEatCooldown = (kind, playerSize) => {
  const phase = getWorldPhase(playerSize);
  if (kind === 'mountain') return phase >= 3 ? 0.82 : 0.68;
  if (kind === 'tower') return phase >= 3 ? 0.64 : 0.5;
  if (kind === 'building') return phase >= 3 ? 0.52 : 0.42;
  if (kind === 'house' || kind === 'tank') return 0.28;
  return 0.16;
};

const getPlayerEatCooldown = (kind, playerSize) => {
  const baseCooldown = {
    ant: 0.06,
    worm: 0.07,
    flower: 0.08,
    brush: 0.1,
    signpost: 0.11,
    banana: 0.12,
    sapling: 0.14,
    monkey: 0.16,
    tree: 0.2,
    car: 0.24,
    house: 0.28,
    tank: 0.34,
    building: 0.52,
    tower: 0.64,
    mountain: 0.82,
    rival: 0.9,
  }[kind] ?? 0.16;

  return Math.max(baseCooldown, getSceneryEatCooldown(kind, playerSize) * 0.75);
};

const getEatScore = (kind, targetSize, eaterSize, growth = 0) => {
  const kindBonus = {
    ant: 4,
    worm: 5,
    flower: 6,
    brush: 7,
    signpost: 8,
    banana: 9,
    sapling: 11,
    monkey: 14,
    tree: 18,
    car: 24,
    house: 32,
    tank: 38,
    building: 52,
    tower: 64,
    mountain: 85,
    rival: 120,
  }[kind] ?? 10;
  const sizeScore = Math.sqrt(Math.max(MIN_LOGICAL_SIZE, safeNumber(targetSize))) * 18;
  const growthScore = Math.max(0, safeNumber(growth, 0)) * 95;
  const phaseScore = getWorldPhase(eaterSize) * 22;
  return Math.max(1, Math.round(kindBonus + sizeScore + growthScore + phaseScore));
};

const getSceneryGrowth = (object, playerSize) => {
  const safeSize = Math.max(MIN_LOGICAL_SIZE, safeNumber(playerSize));
  const kindMultiplier = {
    tree: 0.68,
    house: 0.72,
    car: 0.52,
    tank: 0.62,
    building: 0.58,
    tower: 0.48,
    mountain: 0.82,
  }[object.kind] ?? 0.3;
  const rawGrowth = Math.max(0.01, safeNumber(object.growth, 0.2) * kindMultiplier);
  const perObjectCap = Math.max(0.05, safeSize * Math.min(SCENERY_GROWTH_CAP_RATIO, getGrowthCapRatio(safeSize)));
  return Math.min(rawGrowth, perObjectCap);
};

const getEntityGrowth = (entity, eaterSize) => {
  const safeEaterSize = Math.max(MIN_LOGICAL_SIZE, safeNumber(eaterSize));
  const multiplier = ['ant', 'worm'].includes(entity.kind) ? 0.42 : ['flower', 'brush', 'signpost'].includes(entity.kind) ? 0.34 : 0.24;
  const rawGrowth = Math.max(0.006, entity.size * multiplier);
  return Math.min(rawGrowth, Math.max(0.014, safeEaterSize * getGrowthCapRatio(safeEaterSize)));
};

const getRivalMoveSpeed = (size, phase = 0) => getMoveSpeed(size, phase) * (0.58 + clamp(phase, 0, MAX_WORLD_PHASE) * 0.035);

const getRivalThreat = (rivalSize, playerSize) => Math.max(0, safeNumber(rivalSize) / Math.max(MIN_LOGICAL_SIZE, safeNumber(playerSize)) - 1);

const getRivalCountForPhase = (phase) => (phase >= 4 ? 0 : Math.min(3, MAX_RIVAL_REX_COUNT));

const formatMagnitude = (value, digits = 2) => {
  const safeValue = Math.max(0, safeNumber(value, 0));
  if (safeValue < 1000) return safeValue.toFixed(safeValue < 10 ? digits : 1);

  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
  const exponent = Math.floor(Math.log10(safeValue));
  const unitIndex = Math.floor(exponent / 3);

  if (unitIndex < units.length) {
    const scaled = safeValue / 10 ** (unitIndex * 3);
    return `${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : digits)}${units[unitIndex]}`;
  }

  return `${(safeValue / 10 ** exponent).toFixed(2)}e${exponent}`;
};

const formatScore = (value) => {
  const safeValue = Math.max(0, Math.round(safeNumber(value, 0)));
  if (safeValue < 1000) return `${safeValue}`;
  return formatMagnitude(safeValue, 1);
};

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(safeNumber(seconds, 0)));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const paddedSeconds = String(remainingSeconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  return `${minutes}:${paddedSeconds}`;
};

const formatVersionTime = (value) => {
  const text = String(value ?? '');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?/.exec(text);
  if (!match) return text;
  return `${match[1]} ${match[2]}${match[3] ? ` ${match[3]}` : ''}`;
};

const sanitizePlayerName = (name) => {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, MAX_PLAYER_NAME_LENGTH);
};

const rankLeaderboard = (entries) =>
  [...entries]
    .filter((entry) => Number.isFinite(entry.points) && Number.isFinite(entry.durationSeconds))
    .sort((left, right) => right.points - left.points || left.durationSeconds - right.durationSeconds || (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))
    .slice(0, MAX_LEADERBOARD_ENTRIES);

const loadLeaderboard = () => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEADERBOARD_STORAGE_KEY) ?? '[]');
    return rankLeaderboard(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
};

const saveLeaderboard = (entries) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(rankLeaderboard(entries)));
};

const loadLastPlayerName = () => {
  if (typeof window === 'undefined') return '';
  return sanitizePlayerName(window.localStorage.getItem(LAST_PLAYER_NAME_KEY) ?? '');
};

const saveLastPlayerName = (name) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_PLAYER_NAME_KEY, name);
};

const getPlayerSummary = (player) => ({
  points: Math.round(safeNumber(player.score, 0)),
  durationSeconds: safeNumber(player.elapsedSeconds, 0),
  size: safeNumber(player.size),
  snacks: player.bananas,
  critters: player.monkeys,
  objects: player.objects,
  eaten: player.eaten,
  world: getPhaseLabel(getWorldPhase(player.size)),
});

const getRequestedStartSize = () => {
  if (typeof window === 'undefined') return START_SIZE;
  const value = Number(new URLSearchParams(window.location.search).get('startSize'));
  return Number.isFinite(value) ? clamp(value, START_SIZE, MAX_LOGICAL_SIZE) : START_SIZE;
};

const terrainHeight = (x, z) => {
  const low = Math.sin(x * 0.006) * 3.4 + Math.cos(z * 0.005) * 2.7;
  const ripple = Math.sin((x + z) * 0.018) * 0.9;
  return low + ripple;
};

const getGlobeSurfaceHeight = (x, z) => {
  const distanceSq = x * x + z * z;
  const surface = Math.sqrt(Math.max(0, GLOBE_RADIUS * GLOBE_RADIUS - distanceSq));
  return -GLOBE_RADIUS + 8 + surface;
};

const getGroundHeight = (x, z, phase = 0) => (phase >= 4 ? getGlobeSurfaceHeight(x, z) : terrainHeight(x, z));

const constrainToWorld = (x, z, phase = 0) => {
  if (phase < 4) {
    const worldLimit = getWorldLimit(phase);
    return {
      x: clamp(x, -worldLimit, worldLimit),
      z: clamp(z, -worldLimit, worldLimit),
    };
  }

  const distance = Math.hypot(x, z);
  if (distance <= GLOBE_WORLD_LIMIT) return { x, z };

  const scale = GLOBE_WORLD_LIMIT / Math.max(distance, 0.001);
  return { x: x * scale, z: z * scale };
};

const getLocalTilePosition = (x, z, offsetX = 0, offsetZ = 0) => ({
  x: x - offsetX,
  z: z - offsetZ,
});

const getLandScore = (x, z, offsetX = 0, offsetZ = 0, tileSeed = 0) => {
  const local = getLocalTilePosition(x, z, offsetX, offsetZ);
  const nx = local.x / HALF_COUNTRY;
  const nz = local.z / HALF_COUNTRY;
  const radius = Math.hypot(nx * 1.02, nz * 0.94);
  const angle = Math.atan2(nz, nx);
  const coastline =
    0.83 +
    Math.sin(angle * 3.1 + tileSeed * 0.17) * 0.09 +
    Math.cos(angle * 5.2 - tileSeed * 0.11) * 0.06 +
    Math.sin((local.x + tileSeed * 37) * 0.006) * 0.035 +
    Math.cos((local.z - tileSeed * 19) * 0.005) * 0.035;
  const centerRoadReserve = Math.max(Math.abs(local.x), Math.abs(local.z)) < 130 ? 0.22 : 0;
  return coastline + centerRoadReserve - radius;
};

const isLandAt = (x, z, offsetX = 0, offsetZ = 0, tileSeed = 0) => getLandScore(x, z, offsetX, offsetZ, tileSeed) > 0;

const findLandPosition = (offsetX, offsetZ, tileSeed, seed, radius = COUNTRY_SIZE * 0.65) => {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const angle = seeded(seed + attempt * 17) * Math.PI * 2;
    const distance = seeded(seed + attempt * 29) * radius;
    const x = offsetX + Math.cos(angle) * distance;
    const z = offsetZ + Math.sin(angle) * distance;
    if (isLandAt(x, z, offsetX, offsetZ, tileSeed)) return { x, z };
  }

  return { x: offsetX, z: offsetZ };
};

const isStartCameraKeepout = (x, z, tx, tz) => tx === 0 && tz === 0 && Math.abs(x) < 430 && z > -250 && z < 380;

const canPlaceSceneryAt = (x, z, tx, tz, offsetX, offsetZ, tileSeed) =>
  !isStartCameraKeepout(x, z, tx, tz) && isLandAt(x, z, offsetX, offsetZ, tileSeed);

const getTileAtPosition = (x, z, phase) =>
  getTilesForPhase(phase).find((tile) => Math.abs(x - tile.offsetX) <= HALF_COUNTRY && Math.abs(z - tile.offsetZ) <= HALF_COUNTRY);

const isLandInPhase = (x, z, phase) => {
  if (phase >= 4) return true;
  const tile = getTileAtPosition(x, z, phase);
  return tile ? isLandAt(x, z, tile.offsetX, tile.offsetZ, tile.tileSeed) : false;
};

const findPhaseSpawnPosition = (phase, seed, origin = new THREE.Vector3(), minRadius = 160, maxRadius = 520) => {
  const worldLimit = getWorldLimit(phase);
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const angle = seeded(seed + attempt * 17.7) * Math.PI * 2;
    const distance = minRadius + seeded(seed + attempt * 31.1) * (maxRadius - minRadius);
    const x = clamp(origin.x + Math.cos(angle) * distance, -worldLimit, worldLimit);
    const z = clamp(origin.z + Math.sin(angle) * distance, -worldLimit, worldLimit);
    if (isLandInPhase(x, z, phase) && !isStartCameraKeepout(x, z, 0, 0)) return new THREE.Vector3(x, 0, z);
  }

  const tiles = getTilesForPhase(phase);
  const fallbackTile = tiles[Math.floor(seeded(seed + 901) * tiles.length)] ?? tiles[0];
  const fallback = fallbackTile ? findLandPosition(fallbackTile.offsetX, fallbackTile.offsetZ, fallbackTile.tileSeed, seed + 1031, COUNTRY_SIZE * 0.62) : { x: 0, z: 0 };
  return new THREE.Vector3(fallback.x, 0, fallback.z);
};

const randomRange = (min, max) => min + Math.random() * (max - min);

const ENTITY_PROGRESSION_STAGES = [
  {
    label: 'Worm Trail',
    minSize: START_SIZE,
    catalog: [
      { kind: 'ant', size: 0.08, weight: 8 },
      { kind: 'worm', size: 0.12, weight: 7 },
      { kind: 'flower', size: 0.2, weight: 5 },
      { kind: 'brush', size: 0.3, weight: 3 },
      { kind: 'signpost', size: 0.34, weight: 2 },
    ],
  },
  {
    label: 'Garden Snacks',
    minSize: 0.55,
    catalog: [
      { kind: 'flower', size: 0.24, weight: 4 },
      { kind: 'brush', size: 0.4, weight: 5 },
      { kind: 'signpost', size: 0.48, weight: 5 },
      { kind: 'banana', size: 0.5, weight: 4 },
      { kind: 'sapling', size: 0.52, weight: 2 },
    ],
  },
  {
    label: 'Sapling Grove',
    minSize: 0.85,
    catalog: [
      { kind: 'brush', size: 0.55, weight: 3 },
      { kind: 'signpost', size: 0.68, weight: 4 },
      { kind: 'banana', size: 0.72, weight: 4 },
      { kind: 'sapling', size: 0.76, weight: 5 },
      { kind: 'monkey', size: 0.78, weight: 3 },
    ],
  },
  {
    label: 'Monkey Grove',
    minSize: 1.25,
    catalog: [
      { kind: 'banana', size: 0.86, weight: 3 },
      { kind: 'sapling', size: 1.02, weight: 5 },
      { kind: 'monkey', size: 1.08, weight: 5 },
      { kind: 'tree', size: 1.12, weight: 4 },
      { kind: 'car', size: 1.16, weight: 1 },
    ],
  },
  {
    label: 'Little Trees',
    minSize: 2,
    catalog: [
      { kind: 'sapling', size: 1.35, weight: 3 },
      { kind: 'monkey', size: 1.58, weight: 3 },
      { kind: 'tree', size: 1.76, weight: 6 },
      { kind: 'car', size: 1.84, weight: 4 },
      { kind: 'house', size: 1.88, weight: 1 },
    ],
  },
  {
    label: 'Town Edge',
    minSize: 3.5,
    catalog: [
      { kind: 'tree', size: 2.8, weight: 4 },
      { kind: 'car', size: 3.05, weight: 6 },
      { kind: 'house', size: 3.18, weight: 5 },
      { kind: 'tank', size: 3.22, weight: 2 },
      { kind: 'building', size: 3.28, weight: 1 },
    ],
  },
  {
    label: 'Town Core',
    minSize: 5.5,
    catalog: [
      { kind: 'car', size: 4.3, weight: 3 },
      { kind: 'tree', size: 4.5, weight: 3 },
      { kind: 'house', size: 4.9, weight: 6 },
      { kind: 'tank', size: 5.0, weight: 4 },
      { kind: 'building', size: 5.1, weight: 2 },
    ],
  },
  {
    label: 'City Blocks',
    minSize: 8.5,
    catalog: [
      { kind: 'house', size: 7.0, weight: 4 },
      { kind: 'tank', size: 7.5, weight: 4 },
      { kind: 'building', size: 7.7, weight: 7 },
      { kind: 'tower', size: 7.9, weight: 4 },
    ],
  },
  {
    label: 'Skyline',
    minSize: 13,
    catalog: [
      { kind: 'house', size: 10.3, weight: 2 },
      { kind: 'tank', size: 11.2, weight: 3 },
      { kind: 'building', size: 11.8, weight: 8 },
      { kind: 'tower', size: 12.1, weight: 6 },
    ],
  },
  {
    label: 'Continental Scale',
    minSize: 18,
    catalog: [
      { kind: 'tank', size: 14.5, weight: 2 },
      { kind: 'building', size: 16.2, weight: 8 },
      { kind: 'tower', size: 16.7, weight: 7 },
    ],
  },
  {
    label: 'Mountain Line',
    minSize: 28,
    catalog: [
      { kind: 'building', size: 24.5, weight: 7 },
      { kind: 'tower', size: 25.6, weight: 8 },
      { kind: 'tank', size: 26.0, weight: 2 },
    ],
  },
  {
    label: 'Range Runner',
    minSize: 44,
    catalog: [
      { kind: 'building', size: 37.5, weight: 5 },
      { kind: 'tower', size: 39.5, weight: 6 },
      { kind: 'mountain', size: 41.0, weight: 3 },
    ],
  },
  {
    label: 'Planet Approach',
    minSize: 72,
    catalog: [
      { kind: 'building', size: 58, weight: 5 },
      { kind: 'tower', size: 64, weight: 6 },
      { kind: 'mountain', size: 67, weight: 4 },
    ],
  },
  {
    label: 'Planet Giants',
    minSize: 110,
    catalog: [
      { kind: 'building', size: 92, weight: 4 },
      { kind: 'tower', size: 99, weight: 5 },
      { kind: 'mountain', size: 103, weight: 8 },
    ],
  },
  {
    label: 'Globe Ramp',
    minSize: 160,
    catalog: [
      { kind: 'building', size: 134, weight: 4 },
      { kind: 'tower', size: 144, weight: 5 },
      { kind: 'mountain', size: 150, weight: 8 },
    ],
  },
  {
    label: 'Globe Surface',
    minSize: 220,
    catalog: [
      { kind: 'building', size: 184, weight: 4 },
      { kind: 'tower', size: 198, weight: 5 },
      { kind: 'mountain', size: 206, weight: 8 },
    ],
  },
  {
    label: 'Endgame',
    minSize: 320,
    catalog: [
      { kind: 'building', size: 270, weight: 4 },
      { kind: 'tower', size: 290, weight: 5 },
      { kind: 'mountain', size: 300, weight: 8 },
    ],
  },
  {
    label: 'Final Feast',
    minSize: 460,
    catalog: [
      { kind: 'building', size: 388, weight: 4 },
      { kind: 'tower', size: 414, weight: 5 },
      { kind: 'mountain', size: 430, weight: 8 },
    ],
  },
];

const MOVING_ENTITY_KINDS = new Set(['ant', 'worm', 'monkey']);
const CRITTER_ENTITY_KINDS = new Set(['ant', 'worm', 'monkey']);
const FLOATING_ENTITY_KINDS = new Set(['banana']);

const getEntityProgressionStage = (playerSize) => {
  const safeSize = Math.max(START_SIZE, safeNumber(playerSize));
  let stage = ENTITY_PROGRESSION_STAGES[0];
  for (const candidate of ENTITY_PROGRESSION_STAGES) {
    if (safeSize >= candidate.minSize) stage = candidate;
  }
  return stage;
};

const pickEntityDefinition = (playerSize) => {
  const catalog = getEntityProgressionStage(playerSize).catalog;
  const total = catalog.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of catalog) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return catalog[catalog.length - 1];
};

const getEntityBaseRadius = (entity) => {
  const radiusByKind = {
    ant: 0.08,
    worm: 0.12,
    flower: 0.16,
    brush: 0.22,
    signpost: 0.28,
    banana: 0.34,
    sapling: 0.45,
    car: 1.35,
    tree: 1.5,
    house: 2.4,
    tank: 2.7,
    building: 5.5,
    tower: 5.2,
    mountain: 18,
    monkey: 0.45,
  };
  return radiusByKind[entity.kind] ?? Math.max(0.08, entity.size * 0.28);
};

const getEntityRenderScale = (entity, referenceSize) => {
  const visualSize = getRelativeVisualSize(entity.size, referenceSize);
  const baseSize = Math.max(MIN_LOGICAL_SIZE, entity.baseSize ?? entity.size);
  return Math.max(0.04, visualSize / baseSize);
};

const isEntityEdibleBy = (entity, eaterSize) => entity.size <= Math.max(MIN_LOGICAL_SIZE, safeNumber(eaterSize)) * 0.98;

const randAround = (origin, minRadius, maxRadius, worldLimit = HALF_COUNTRY * 1.35) => {
  const angle = Math.random() * Math.PI * 2;
  const radius = randomRange(minRadius, maxRadius);
  const x = origin.x + Math.cos(angle) * radius;
  const z = origin.z + Math.sin(angle) * radius;
  return new THREE.Vector3(
    clamp(x, -worldLimit, worldLimit),
    0,
    clamp(z, -worldLimit, worldLimit),
  );
};

const makeEntity = (kindOrDefinition, playerPosition, playerSize, idPrefix = '', worldLimit = HALF_COUNTRY * 1.35, phase = 0) => {
  const definition = typeof kindOrDefinition === 'string' ? { kind: kindOrDefinition, size: START_SIZE } : kindOrDefinition;
  const kind = definition.kind;
  const visualSize = getVisualSize(playerSize);
  const distance = Math.max(38, visualSize * 4.2);
  const pos = randAround(playerPosition, distance, distance * 2.6, worldLimit);
  const constrained = constrainToWorld(pos.x, pos.z, phase);
  pos.set(constrained.x, 0, constrained.z);
  const maxEdibleSize = Math.max(MIN_LOGICAL_SIZE, safeNumber(playerSize) * getSpawnEdibleSizeRatio(playerSize));
  const size = clamp(definition.size * randomRange(0.92, 1.08), MIN_LOGICAL_SIZE, maxEdibleSize);

  return {
    id: `${idPrefix}${kind}-${createUniqueId()}`,
    kind,
    size,
    baseSize: definition.size,
    position: pos,
    angle: Math.random() * Math.PI * 2,
    speed: MOVING_ENTITY_KINDS.has(kind) ? randomRange(0.12, 0.55) : 0,
    pulse: Math.random() * Math.PI * 2,
  };
};

const placedEntity = (kind, x, z, size, idPrefix = 'starter-') => ({
  id: `${idPrefix}${kind}-${createUniqueId()}`,
  kind,
  size,
  baseSize: size,
  position: new THREE.Vector3(x, 0, z),
  angle: Math.random() * Math.PI * 2,
  speed: MOVING_ENTITY_KINDS.has(kind) ? randomRange(0.12, 0.28) : 0,
  pulse: Math.random() * Math.PI * 2,
});

const initialEntities = (phase = 0, playerSize = WORLD_PHASES[phase]?.minSize ?? START_SIZE) => {
  const origin = new THREE.Vector3(0, 0, 0);
  const entities =
    phase === 0
      ? [
          placedEntity('ant', 0, -8, 0.08),
          placedEntity('ant', 0, -13, 0.08),
          placedEntity('worm', -8, -15, 0.12),
          placedEntity('worm', 7, -18, 0.12),
          placedEntity('flower', 11, -23, 0.2),
          placedEntity('brush', 24, -34, 0.3),
        ]
      : [];

  for (let i = entities.length; i < 66; i += 1) {
    entities.push(makeEntity(pickEntityDefinition(playerSize), origin, Math.max(START_SIZE, playerSize), 'initial-', getWorldLimit(phase), phase));
  }

  return entities;
};

const makeRivalRex = (index, playerPosition, playerSize, phase) => {
  const safePhase = clamp(phase, 0, MAX_WORLD_PHASE);
  const safePlayerSize = Math.max(START_SIZE, safeNumber(playerSize));
  const visualSize = getVisualSize(playerSize);
  const minRadius = Math.max(260, visualSize * 8.5);
  const maxRadius = Math.max(minRadius + 220, visualSize * 13.5);
  const seed = performance.now() * 0.001 + index * 719 + safePlayerSize * 3.1 + safePhase * 101;
  const sizeBand = [0.52, 0.64, 0.76, 0.84, 0.9, 0.7][index % 6];
  const minSpawnSize = Math.max(START_SIZE * 0.62, safePlayerSize * 0.42);
  const maxSpawnSize = Math.max(START_SIZE * 0.82, safePlayerSize * 0.92);
  const size = clamp(safePlayerSize * sizeBand * (0.96 + seeded(seed + 11) * 0.08), minSpawnSize, maxSpawnSize);

  return {
    id: `rival-rex-${createUniqueId()}`,
    size,
    position: findPhaseSpawnPosition(safePhase, seed, playerPosition, minRadius, maxRadius),
    heading: seeded(seed + 3) * Math.PI * 2,
    walkAmount: 0,
    munchUntil: 0,
    eatCooldown: 0.35 + seeded(seed + 5) * 0.45,
    wanderAngle: seeded(seed + 7) * Math.PI * 2,
    wanderTimer: 0.4 + seeded(seed + 13) * 1.6,
    variantSeed: seeded(seed + 17),
    aggression: 0.62 + seeded(seed + 23) * 0.32,
    eaten: 0,
  };
};

const initialRivals = (playerSize = START_SIZE, phase = 0) => {
  const count = getRivalCountForPhase(phase);
  const origin = new THREE.Vector3(0, 0, 0);
  return Array.from({ length: count }, (_, index) => makeRivalRex(index, origin, playerSize, phase));
};

const createGlobeScenery = () => {
  const items = [];
  const maxRadius = GLOBE_RADIUS * 0.58;

  for (let i = 0; i < 44; i += 1) {
    const seed = 8000 + i * 97;
    const angle = seeded(seed) * Math.PI * 2;
    const distance = maxRadius * Math.sqrt(seeded(seed + 17));
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const roll = seeded(seed + 31);

    if (roll < 0.22) {
      const radius = 34 + seeded(seed + 3) * 62;
      const height = 70 + seeded(seed + 5) * 150;
      items.push(makeMountainObject(`globe:mountain:${i}`, x, z, radius, height, seed));
    } else if (roll < 0.48) {
      items.push(makeBuildingObject(`globe:building:${i}`, x, z, seed, 0.95 + seeded(seed + 7) * 0.25));
    } else if (roll < 0.66) {
      items.push(makeTowerObject(`globe:tower:${i}`, x, z, seed, 0.95 + seeded(seed + 11) * 0.25));
    } else if (roll < 0.82) {
      items.push(makeHouseObject(`globe:house:${i}`, x, z, seed));
    } else {
      items.push(makeTreeObject(`globe:tree:${i}`, x, z, 1.2 + seeded(seed + 13) * 1.9, seed));
    }
  }

  return items;
};

const makeTreeObject = (id, x, z, scale, seed) => ({
  id,
  kind: 'tree',
  x,
  z,
  y: terrainHeight(x, z),
  scale,
  size: 5.2 * scale,
  radius: 3.4 * scale,
  growth: 0.42 * scale,
  hue: seeded(seed),
});

const makeHouseObject = (id, x, z, seed) => {
  const jitter = seeded(seed);
  return {
    id,
    kind: 'house',
    x,
    z,
    y: terrainHeight(x, z),
    size: 8.8,
    radius: 6.7,
    growth: 1.45,
    color: ['#f2d28b', '#d88b6b', '#d8ede6', '#c6d38b'][Math.floor(jitter * 4)],
    roof: ['#9d3f34', '#384c6c', '#6b5345'][Math.floor(seeded(seed + 55) * 3)],
    angle: seeded(seed + 101) * Math.PI,
  };
};

const makeMountainObject = (id, x, z, radius, height, seed) => ({
  id,
  kind: 'mountain',
  x,
  z,
  y: terrainHeight(x, z),
  radius,
  height,
  size: Math.max(radius * 0.9, height * 0.7),
  growth: Math.max(2.4, height * 0.035),
  angle: seeded(seed + 5) * Math.PI,
});

const makeBuildingObject = (id, x, z, seed, tier = 1) => {
  const height = (16 + seeded(seed + 1) * 32) * tier;
  const width = (8 + seeded(seed + 2) * 8) * Math.min(1.18, tier);
  const depth = (8 + seeded(seed + 3) * 8) * Math.min(1.18, tier);
  return {
    id,
    kind: 'building',
    x,
    z,
    y: terrainHeight(x, z),
    width,
    depth,
    height,
    size: height * 0.9,
    radius: Math.max(width, depth) * 0.82,
    growth: height * 0.12,
    color: ['#6d8fab', '#9aa3a8', '#c0b184', '#7b8794', '#b08d76'][Math.floor(seeded(seed + 4) * 5)],
    windowColor: seeded(seed + 5) > 0.45 ? '#ffd36a' : '#d6f4ff',
    angle: seeded(seed + 6) * Math.PI,
  };
};

const makeCarObject = (id, x, z, seed, tier = 1) => ({
  id,
  kind: 'car',
  x,
  z,
  y: terrainHeight(x, z),
  size: 4.2 * tier,
  radius: 4.8 * tier,
  scale: tier,
  growth: 0.85 * tier,
  color: ['#d84d3f', '#3d76c2', '#f0c14b', '#2f8e5b', '#f2f2eb'][Math.floor(seeded(seed + 1) * 5)],
  angle: seeded(seed + 2) * Math.PI * 2,
});

const makeTowerObject = (id, x, z, seed, tier = 1) => {
  const height = (28 + seeded(seed + 1) * 36) * tier;
  return {
    id,
    kind: 'tower',
    x,
    z,
    y: terrainHeight(x, z),
    height,
    radius: 5.8 * tier,
    size: height * 0.92,
    growth: height * 0.1,
    color: seeded(seed + 2) > 0.5 ? '#b7c0c7' : '#a1876d',
    cap: seeded(seed + 3) > 0.5 ? '#a43e32' : '#43617f',
  };
};

const makeTankObject = (id, x, z, seed, tier = 1) => ({
  id,
  kind: 'tank',
  x,
  z,
  y: terrainHeight(x, z),
  size: 10 * tier,
  radius: 7.2 * tier,
  scale: tier,
  growth: 2.2 * tier,
  color: seeded(seed + 1) > 0.5 ? '#6f8a5a' : '#8b866b',
  angle: seeded(seed + 2) * Math.PI * 2,
});

const createSceneryForTile = (tile) => {
  const { tx, tz, offsetX, offsetZ, tileSeed = getTileSeed(tx, tz) } = tile;
  const tileDistance = Math.abs(tx) + Math.abs(tz);
  const items = [];

  const treeCount = tileDistance === 0 ? 96 : tileDistance <= 2 ? 56 : 36;
  for (let i = 0; i < treeCount; i += 1) {
    const sideBias = seeded(tileSeed + i * 11.3);
    const x = offsetX + (seeded(tileSeed + i * 3.7) - 0.5) * COUNTRY_SIZE * (sideBias > 0.35 ? 0.92 : 0.65);
    const z = offsetZ + (seeded(tileSeed + i * 8.1) - 0.5) * COUNTRY_SIZE * (sideBias > 0.45 ? 0.92 : 0.72);
    if ((tx === 0 && tz === 0 && Math.abs(x) < 48 && Math.abs(z) < 48) || !canPlaceSceneryAt(x, z, tx, tz, offsetX, offsetZ, tileSeed)) continue;
    items.push(makeTreeObject(`tree:${tx}:${tz}:${i}`, x, z, 0.5 + seeded(tileSeed + i * 5.5) * 0.9, tileSeed + i * 12.5));
  }

  if (tx === 0 && tz === 0) {
    [
      [-56, -95, 0.58],
      [-38, -138, 0.68],
      [64, -118, 0.6],
      [94, -82, 0.64],
      [146, -155, 0.72],
      [-260, 96, 0.56],
      [310, 118, 0.58],
      [320, -190, 0.64],
    ].forEach(([x, z, scale], index) => {
      if (!canPlaceSceneryAt(x, z, tx, tz, offsetX, offsetZ, tileSeed)) return;
      items.push(makeTreeObject(`tree:landmark:${index}`, x, z, scale, tileSeed + index * 71));
    });
  }

  const villages = [
    { x: -255, z: -210, rows: 2, cols: 3 },
    { x: 230, z: -230, rows: 2, cols: 3 },
    { x: 230, z: 170, rows: 3, cols: 3 },
    { x: -410, z: 310, rows: 2, cols: 4 },
    { x: 390, z: -280, rows: 2, cols: 5 },
  ];

  villages.forEach((village, villageIndex) => {
    for (let row = 0; row < village.rows; row += 1) {
      for (let col = 0; col < village.cols; col += 1) {
        const seed = tileSeed + villageIndex * 200 + row * 31 + col * 17;
        const x = offsetX + village.x + (col - village.cols / 2) * 34 + seeded(seed) * 8;
        const z = offsetZ + village.z + (row - village.rows / 2) * 32 + seeded(seed + 173) * 8;
        if (!canPlaceSceneryAt(x, z, tx, tz, offsetX, offsetZ, tileSeed)) continue;
        items.push(makeHouseObject(`house:${tx}:${tz}:${villageIndex}:${row}:${col}`, x, z, seed));
      }
    }
  });

  const districtCount = tileDistance === 0 ? 2 : tileDistance <= 2 ? 2 : 1;
  for (let district = 0; district < districtCount; district += 1) {
    const districtCenter = findLandPosition(offsetX, offsetZ, tileSeed, tileSeed + district * 41, COUNTRY_SIZE * 0.58);
    const centerX = districtCenter.x;
    const centerZ = districtCenter.z;
    const tier = 0.85 + seeded(tileSeed + district * 53) * 0.35;
    const buildingCount = 5 + Math.floor(seeded(tileSeed + district * 61) * (tileDistance === 0 ? 7 : 5));

    for (let i = 0; i < buildingCount; i += 1) {
      const seed = tileSeed + district * 500 + i * 29;
      const blockX = centerX + ((i % 4) - 1.5) * 30 + seeded(seed + 7) * 9;
      const blockZ = centerZ + (Math.floor(i / 4) - 1.5) * 34 + seeded(seed + 11) * 9;
      if (!canPlaceSceneryAt(blockX, blockZ, tx, tz, offsetX, offsetZ, tileSeed)) continue;
      items.push(makeBuildingObject(`building:${tx}:${tz}:${district}:${i}`, blockX, blockZ, seed, tier));
    }

    const carCount = tileDistance === 0 ? 8 : 5;
    for (let i = 0; i < carCount; i += 1) {
      const seed = tileSeed + district * 700 + i * 17;
      const roadX = centerX + (seeded(seed + 13) - 0.5) * 190;
      const roadZ = centerZ + (seeded(seed + 19) - 0.5) * 170;
      if (!canPlaceSceneryAt(roadX, roadZ, tx, tz, offsetX, offsetZ, tileSeed)) continue;
      items.push(makeCarObject(`car:${tx}:${tz}:${district}:${i}`, roadX, roadZ, seed, 0.85 + seeded(seed + 31) * 0.25));
    }

    if (seeded(tileSeed + district * 83) > 0.35) {
      const seed = tileSeed + district * 900;
      const towerX = centerX + 78;
      const towerZ = centerZ - 54;
      if (canPlaceSceneryAt(towerX, towerZ, tx, tz, offsetX, offsetZ, tileSeed)) {
        items.push(makeTowerObject(`tower:${tx}:${tz}:${district}`, towerX, towerZ, seed, 0.9 + seeded(seed + 41) * 0.25));
      }
    }

    if (Math.abs(tx) + Math.abs(tz) > 1 && seeded(tileSeed + district * 97) > 0.58) {
      const seed = tileSeed + district * 1100;
      const tankX = centerX - 74;
      const tankZ = centerZ + 62;
      if (canPlaceSceneryAt(tankX, tankZ, tx, tz, offsetX, offsetZ, tileSeed)) {
        items.push(makeTankObject(`tank:${tx}:${tz}:${district}`, tankX, tankZ, seed, 0.95 + seeded(seed + 47) * 0.18));
      }
    }
  }

  const mountainCount = tileDistance === 0 ? 12 : 8;
  for (let i = 0; i < mountainCount; i += 1) {
    const along = (i / 11 - 0.5) * COUNTRY_SIZE;
    const edge = i % 2 === 0 ? -1 : 1;
    let x = i % 3 === 0 ? offsetX + edge * (HALF_COUNTRY * 0.78 + seeded(tileSeed + i) * 90) : offsetX + along;
    let z = i % 3 === 0 ? offsetZ + along : offsetZ + edge * (HALF_COUNTRY * 0.78 + seeded(tileSeed + i * 4) * 90);
    for (let attempt = 0; attempt < 5 && !canPlaceSceneryAt(x, z, tx, tz, offsetX, offsetZ, tileSeed); attempt += 1) {
      const replacement = findLandPosition(offsetX, offsetZ, tileSeed, tileSeed + i * 211 + attempt * 1007, COUNTRY_SIZE * 0.72);
      x = replacement.x;
      z = replacement.z;
    }
    if (!canPlaceSceneryAt(x, z, tx, tz, offsetX, offsetZ, tileSeed)) continue;
    const radius = 38 + seeded(tileSeed + i * 8) * 62;
    const height = 55 + seeded(tileSeed + i * 13) * 135;
    items.push(makeMountainObject(`mountain:${tx}:${tz}:${i}`, x, z, radius, height, tileSeed + i * 53));
  }

  return items;
};

const createSceneryForPhase = (phase) => (phase >= 4 ? createGlobeScenery() : getTilesForPhase(phase).flatMap(createSceneryForTile));

function useKeyboardInput(inputRef) {
  useEffect(() => {
    const pressed = new Set();

    const onKeyDown = (event) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
        pressed.add(event.code);
        event.preventDefault();
      }

      const spawnMultiplier = getSpawnMultiplierFromKeyCode(event.code);
      if (spawnMultiplier !== null) {
        inputRef.current.spawnMultiplier = spawnMultiplier;
        inputRef.current.spawnCheatChangedAt = performance.now();
        event.preventDefault();
      }
    };

    const onKeyUp = (event) => {
      pressed.delete(event.code);
    };

    let raf = 0;
    const sync = () => {
      const horizontal =
        (pressed.has('ArrowRight') || pressed.has('KeyD') ? 1 : 0) -
        (pressed.has('ArrowLeft') || pressed.has('KeyA') ? 1 : 0);
      const vertical =
        (pressed.has('ArrowDown') || pressed.has('KeyS') ? 1 : 0) -
        (pressed.has('ArrowUp') || pressed.has('KeyW') ? 1 : 0);
      inputRef.current.keyboard.set(horizontal, vertical);
      raf = requestAnimationFrame(sync);
    };

    raf = requestAnimationFrame(sync);
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [inputRef]);
}

function HUD({ stats, isPaused, onPauseToggle, onReset }) {
  return (
    <div className="hud" aria-live="polite">
      <div className="hud-panel stat-panel">
        <div>
          <span>Size</span>
          <strong>{stats.sizeLabel}</strong>
        </div>
        <div>
          <span>Strength</span>
          <strong>{stats.strength}</strong>
        </div>
        <div>
          <span>Score</span>
          <strong>{stats.score}</strong>
        </div>
        <div>
          <span>Time</span>
          <strong>{stats.time}</strong>
        </div>
        <div>
          <span>Snacks</span>
          <strong>{stats.bananas}</strong>
        </div>
        <div>
          <span>Critters</span>
          <strong>{stats.monkeys}</strong>
        </div>
        <div>
          <span>Objects</span>
          <strong>{stats.objects}</strong>
        </div>
        <div>
          <span>Rivals</span>
          <strong>{stats.rivals}</strong>
        </div>
        <div>
          <span>Spawns</span>
          <strong>{stats.spawnDensity}</strong>
        </div>
        <div>
          <span>World</span>
          <strong>{stats.world}</strong>
        </div>
      </div>

      <div className="hud-actions">
        <button className="icon-button" type="button" onClick={onPauseToggle} aria-label={isPaused ? 'Resume' : 'Pause'}>
          {isPaused ? <Play size={18} /> : <Pause size={18} />}
        </button>
        <button className="icon-button" type="button" onClick={onReset} aria-label="Restart">
          <RotateCcw size={18} />
        </button>
      </div>
    </div>
  );
}

function TouchJoystick({ inputRef }) {
  const shellRef = useRef(null);
  const pointerIdRef = useRef(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });

  const updateFromEvent = useCallback(
    (event) => {
      const shell = shellRef.current;
      if (!shell) return;

      const rect = shell.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const max = rect.width * 0.34;
      const dx = clamp(event.clientX - centerX, -max, max);
      const dy = clamp(event.clientY - centerY, -max, max);

      inputRef.current.touch.set(dx / max, dy / max);
      setKnob({ x: dx, y: dy, active: true });
    },
    [inputRef],
  );

  const onPointerDown = (event) => {
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromEvent(event);
  };

  const onPointerMove = (event) => {
    if (pointerIdRef.current === event.pointerId) updateFromEvent(event);
  };

  const endTouch = (event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    inputRef.current.touch.set(0, 0);
    setKnob({ x: 0, y: 0, active: false });
  };

  return (
    <div
      ref={shellRef}
      className={`touch-joystick${knob.active ? ' active' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endTouch}
      onPointerCancel={endTouch}
      aria-label="Move"
      role="application"
    >
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.86} />
      <directionalLight position={[90, 160, 80]} intensity={2.25} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048}>
        <orthographicCamera attach="shadow-camera" args={[-260, 260, 260, -260, 1, 600]} />
      </directionalLight>
      <hemisphereLight args={['#cfeeff', '#5d6a34', 1.2]} />
    </>
  );
}

function Terrain({ offsetX = 0, offsetZ = 0, tileSeed = 0 }) {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(COUNTRY_SIZE, COUNTRY_SIZE, 120, 120);
    geo.rotateX(-Math.PI / 2);
    const position = geo.attributes.position;
    const colors = [];
    const color = new THREE.Color();

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i) + offsetX;
      const z = position.getZ(i) + offsetZ;
      const land = isLandAt(x, z, offsetX, offsetZ, tileSeed);
      const y = land ? terrainHeight(x, z) : -2.8 + Math.sin((x + z) * 0.006) * 0.18;
      position.setX(i, x);
      position.setY(i, y);
      position.setZ(i, z);

      const mix = clamp((y + 8) / 22, 0, 1);
      color.set(land ? (mix > 0.65 ? '#8ba64b' : '#63a456') : '#5db5cf');
      colors.push(color.r, color.g, color.b);
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [offsetX, offsetZ, tileSeed]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.98} metalness={0} />
    </mesh>
  );
}

function RoadsAndFields({ offsetX = 0, offsetZ = 0, tileSeed = 0, showBorder = false }) {
  const roads = useMemo(() => {
    const centerTile = offsetX === 0 && offsetZ === 0;
    if (centerTile) {
      return [
        { id: 'east-west', length: COUNTRY_SIZE * 0.7, width: 18, centerX: offsetX, centerZ: offsetZ, angle: 0, color: '#d7bb78' },
        { id: 'north-south', length: COUNTRY_SIZE * 0.64, width: 16, centerX: offsetX, centerZ: offsetZ, angle: Math.PI / 2, color: '#d7bb78' },
        { id: 'diagonal', length: COUNTRY_SIZE * 0.48, width: 12, centerX: offsetX - 210, centerZ: offsetZ + 210, angle: Math.PI / 4, color: '#cfae70' },
        { id: 'river', length: COUNTRY_SIZE * 0.55, width: 34, centerX: offsetX, centerZ: offsetZ - 315, angle: -0.13, color: '#4da3c4', lift: 0.22 },
      ];
    }

    const town = findLandPosition(offsetX, offsetZ, tileSeed, tileSeed * 31, COUNTRY_SIZE * 0.48);
    return [
      {
        id: 'local-road-a',
        length: COUNTRY_SIZE * (0.24 + seeded(tileSeed + 1) * 0.18),
        width: 12,
        centerX: town.x,
        centerZ: town.z,
        angle: seeded(tileSeed + 2) * Math.PI,
        color: '#d7bb78',
      },
      {
        id: 'local-road-b',
        length: COUNTRY_SIZE * (0.18 + seeded(tileSeed + 3) * 0.14),
        width: 10,
        centerX: town.x + (seeded(tileSeed + 4) - 0.5) * 120,
        centerZ: town.z + (seeded(tileSeed + 5) - 0.5) * 120,
        angle: seeded(tileSeed + 6) * Math.PI,
        color: '#cfae70',
      },
    ];
  }, [offsetX, offsetZ, tileSeed]);
  const fields = useMemo(() => {
    const list = [];
    for (let row = -2; row <= 2; row += 1) {
      for (let col = -2; col <= 2; col += 1) {
        const seed = tileSeed * 97 + row * 29 + col * 13;
        const x = offsetX + col * 165 + seeded(seed + 7) * 35;
        const z = offsetZ + row * 145 + seeded(seed + 19) * 40;
        if (Math.abs(row) + Math.abs(col) < 2 || seeded(seed) < 0.34 || !isLandAt(x, z, offsetX, offsetZ, tileSeed)) continue;
        list.push({
          id: `${row}-${col}`,
          x,
          z,
          w: 68 + seeded(seed + 31) * 40,
          h: 54 + seeded(seed + 43) * 41,
          color: seeded(seed + 59) > 0.5 ? '#c4b84f' : '#6e9f46',
        });
      }
    }
    return list;
  }, [offsetX, offsetZ, tileSeed]);

  return (
    <group>
      {roads.map((road) => (
        <SurfaceStrip key={road.id} {...road} />
      ))}

      {fields.map((field) => (
        <SurfacePatch
          key={field.id}
          width={field.w}
          depth={field.h}
          centerX={field.x}
          centerZ={field.z}
          angle={seeded(field.x + field.z) * Math.PI}
          color={field.color}
        />
      ))}

      {showBorder && offsetX === 0 && offsetZ === 0 && <CountryBorder offsetX={offsetX} offsetZ={offsetZ} />}
    </group>
  );
}

function SurfaceStrip({ length, width, centerX, centerZ, angle, color, lift = 0.16 }) {
  const geometry = useMemo(() => {
    const segments = 96;
    const geo = new THREE.BufferGeometry();
    const vertices = [];
    const indices = [];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    for (let i = 0; i <= segments; i += 1) {
      const along = -length / 2 + (i / segments) * length;
      for (const across of [-width / 2, width / 2]) {
        const x = centerX + along * cos - across * sin;
        const z = centerZ + along * sin + across * cos;
        vertices.push(x, terrainHeight(x, z) + lift, z);
      }
    }

    for (let i = 0; i < segments; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [angle, centerX, centerZ, length, lift, width]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.95} metalness={0} />
    </mesh>
  );
}

function SurfacePatch({ width, depth, centerX, centerZ, angle, color }) {
  const geometry = useMemo(() => {
    const segments = 5;
    const geo = new THREE.BufferGeometry();
    const vertices = [];
    const indices = [];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    for (let row = 0; row <= segments; row += 1) {
      for (let col = 0; col <= segments; col += 1) {
        const localX = -width / 2 + (col / segments) * width;
        const localZ = -depth / 2 + (row / segments) * depth;
        const x = centerX + localX * cos - localZ * sin;
        const z = centerZ + localX * sin + localZ * cos;
        vertices.push(x, terrainHeight(x, z) + 0.18, z);
      }
    }

    for (let row = 0; row < segments; row += 1) {
      for (let col = 0; col < segments; col += 1) {
        const a = row * (segments + 1) + col;
        indices.push(a, a + 1, a + segments + 1, a + 1, a + segments + 2, a + segments + 1);
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [angle, centerX, centerZ, depth, width]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
}

function CountryBorder({ offsetX = 0, offsetZ = 0 }) {
  const strip = 7;
  const wallHeight = 2.2;

  return (
    <group position={[offsetX, 2.2, offsetZ]}>
      <mesh position={[0, 0, HALF_COUNTRY]} castShadow receiveShadow>
        <boxGeometry args={[COUNTRY_SIZE, wallHeight, strip]} />
        <meshStandardMaterial color="#efe0a8" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0, -HALF_COUNTRY]} castShadow receiveShadow>
        <boxGeometry args={[COUNTRY_SIZE, wallHeight, strip]} />
        <meshStandardMaterial color="#efe0a8" roughness={0.8} />
      </mesh>
      <mesh position={[HALF_COUNTRY, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[strip, wallHeight, COUNTRY_SIZE]} />
        <meshStandardMaterial color="#efe0a8" roughness={0.8} />
      </mesh>
      <mesh position={[-HALF_COUNTRY, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[strip, wallHeight, COUNTRY_SIZE]} />
        <meshStandardMaterial color="#efe0a8" roughness={0.8} />
      </mesh>
    </group>
  );
}

function Trees({ scenery }) {
  const treeData = useMemo(() => scenery.filter((item) => item.kind === 'tree'), [scenery]);
  const trunkRefs = useRef();
  const crownRefs = useRef();

  useEffect(() => {
    if (!trunkRefs.current || !crownRefs.current) return;
    const trunkObject = new THREE.Object3D();
    const crownObject = new THREE.Object3D();

    treeData.forEach((tree, index) => {
      trunkObject.position.set(tree.x, tree.y + 2.2 * tree.scale, tree.z);
      trunkObject.scale.set(tree.scale, tree.scale, tree.scale);
      trunkObject.updateMatrix();
      trunkRefs.current.setMatrixAt(index, trunkObject.matrix);

      crownObject.position.set(tree.x, tree.y + 6.4 * tree.scale, tree.z);
      crownObject.scale.set(tree.scale * 1.02, tree.scale * 1.12, tree.scale * 1.02);
      crownObject.updateMatrix();
      crownRefs.current.setMatrixAt(index, crownObject.matrix);
      crownRefs.current.setColorAt(index, new THREE.Color(tree.hue > 0.55 ? '#2d8a4c' : '#3d9c3b'));
    });

    trunkRefs.current.instanceMatrix.needsUpdate = true;
    crownRefs.current.instanceMatrix.needsUpdate = true;
    if (crownRefs.current.instanceColor) crownRefs.current.instanceColor.needsUpdate = true;
  }, [treeData]);

  return (
    <group>
      <instancedMesh ref={trunkRefs} args={[undefined, undefined, treeData.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.8, 1.1, 4.8, 7]} />
        <meshStandardMaterial color="#7d5234" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={crownRefs} args={[undefined, undefined, treeData.length]} castShadow receiveShadow>
        <coneGeometry args={[3.5, 7.8, 9]} />
        <meshStandardMaterial vertexColors color="#348d42" roughness={0.9} />
      </instancedMesh>
    </group>
  );
}

function Houses({ scenery }) {
  const houses = useMemo(() => scenery.filter((item) => item.kind === 'house'), [scenery]);
  return (
    <group>
      {houses.map((house) => (
        <group key={house.id} position={[house.x, house.y + 2.25, house.z]} rotation={[0, house.angle, 0]}>
          <HouseModel object={house} />
        </group>
      ))}
    </group>
  );
}

function HouseModel({ object }) {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[8.2, 4.5, 7.2]} />
        <meshStandardMaterial color={object.color} roughness={0.84} />
      </mesh>
      <mesh position={[0, 3.85, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[6.1, 3.9, 4]} />
        <meshStandardMaterial color={object.roof} roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.8, -3.8]}>
        <boxGeometry args={[1.9, 2.7, 0.35]} />
        <meshStandardMaterial color="#5f412d" roughness={0.9} />
      </mesh>
    </group>
  );
}

function CityObjects({ scenery }) {
  const cityObjects = useMemo(() => scenery.filter((item) => ['building', 'car', 'tower', 'tank'].includes(item.kind)), [scenery]);

  return (
    <group>
      {cityObjects.map((object) => (
        <group key={object.id} position={[object.x, object.y, object.z]} rotation={[0, object.angle ?? 0, 0]}>
          {object.kind === 'building' && <BuildingModel object={object} />}
          {object.kind === 'car' && <CarModel object={object} />}
          {object.kind === 'tower' && <TowerModel object={object} />}
          {object.kind === 'tank' && <TankModel object={object} />}
        </group>
      ))}
    </group>
  );
}

function BuildingModel({ object }) {
  const windowRows = clamp(Math.floor(object.height / 8), 2, 9);
  const windowCols = clamp(Math.floor(object.width / 4), 2, 5);
  const windows = [];

  for (let row = 0; row < windowRows; row += 1) {
    for (let col = 0; col < windowCols; col += 1) {
      windows.push({ row, col });
    }
  }

  return (
    <group>
      <mesh position={[0, object.height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[object.width, object.height, object.depth]} />
        <meshStandardMaterial color={object.color} roughness={0.76} />
      </mesh>
      <mesh position={[0, object.height + 1.2, 0]} castShadow>
        <boxGeometry args={[object.width * 0.82, 2.4, object.depth * 0.82]} />
        <meshStandardMaterial color="#4b5563" roughness={0.7} />
      </mesh>
      {windows.map((window) => (
        <mesh
          key={`${window.row}-${window.col}`}
          position={[
            -object.width * 0.32 + (window.col / Math.max(1, windowCols - 1)) * object.width * 0.64,
            5 + window.row * Math.max(3.4, object.height / (windowRows + 1)),
            -object.depth / 2 - 0.05,
          ]}
        >
          <boxGeometry args={[1.35, 1.7, 0.12]} />
          <meshStandardMaterial color={object.windowColor} emissive={object.windowColor} emissiveIntensity={0.18} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function CarModel({ object }) {
  const scale = object.scale;

  return (
    <group scale={scale}>
      <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[6.8, 1.7, 3.5]} />
        <meshStandardMaterial color={object.color} roughness={0.7} />
      </mesh>
      <mesh position={[0.5, 2.25, 0]} castShadow>
        <boxGeometry args={[3.3, 1.45, 2.75]} />
        <meshStandardMaterial color="#cfeeff" roughness={0.28} metalness={0.05} />
      </mesh>
      {[-2.25, 2.25].map((x) =>
        [-1.85, 1.85].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.35, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.58, 0.58, 0.42, 14]} />
            <meshStandardMaterial color="#1f2428" roughness={0.65} />
          </mesh>
        )),
      )}
    </group>
  );
}

function TowerModel({ object }) {
  return (
    <group>
      <mesh position={[0, object.height / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[object.radius * 0.55, object.radius * 0.78, object.height, 10]} />
        <meshStandardMaterial color={object.color} roughness={0.78} />
      </mesh>
      <mesh position={[0, object.height + object.radius * 0.5, 0]} castShadow>
        <sphereGeometry args={[object.radius * 0.95, 18, 12]} />
        <meshStandardMaterial color={object.cap} roughness={0.6} />
      </mesh>
      <mesh position={[0, object.height * 0.78, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <torusGeometry args={[object.radius * 0.95, object.radius * 0.08, 8, 28]} />
        <meshStandardMaterial color="#eef4f8" roughness={0.48} />
      </mesh>
    </group>
  );
}

function TankModel({ object }) {
  const scale = object.scale;

  return (
    <group scale={scale}>
      <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[7.4, 2.1, 4.6]} />
        <meshStandardMaterial color={object.color} roughness={0.85} />
      </mesh>
      <mesh position={[0.2, 2.55, 0]} castShadow>
        <boxGeometry args={[3.5, 1.65, 3.2]} />
        <meshStandardMaterial color={object.color} roughness={0.82} />
      </mesh>
      <mesh position={[3.8, 2.75, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 5.4, 10]} />
        <meshStandardMaterial color="#3f4735" roughness={0.78} />
      </mesh>
      <mesh position={[0, 0.35, -2.25]} castShadow>
        <boxGeometry args={[8, 0.55, 0.55]} />
        <meshStandardMaterial color="#263025" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.35, 2.25]} castShadow>
        <boxGeometry args={[8, 0.55, 0.55]} />
        <meshStandardMaterial color="#263025" roughness={0.8} />
      </mesh>
    </group>
  );
}

function LandmarkTrees() {
  const trees = useMemo(
    () => [
      { x: -56, z: -95, scale: 0.58 },
      { x: -38, z: -138, scale: 0.68 },
      { x: 64, z: -118, scale: 0.6 },
      { x: 94, z: -82, scale: 0.64 },
      { x: 146, z: -155, scale: 0.72 },
      { x: -118, z: 54, scale: 0.56 },
      { x: 152, z: 62, scale: 0.58 },
      { x: 210, z: -36, scale: 0.64 },
    ],
    [],
  );

  return (
    <group>
      {trees.map((tree) => (
        <group key={`${tree.x}-${tree.z}`} position={[tree.x, terrainHeight(tree.x, tree.z), tree.z]} scale={tree.scale}>
          <mesh position={[0, 2.8, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.8, 1.05, 4.8, 7]} />
            <meshStandardMaterial color="#7d5234" roughness={0.9} />
          </mesh>
          <mesh position={[0, 7.4, 0]} castShadow receiveShadow>
            <coneGeometry args={[3.4, 7.2, 9]} />
            <meshStandardMaterial color="#2f8744" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Mountains({ scenery }) {
  const mountains = useMemo(() => scenery.filter((item) => item.kind === 'mountain'), [scenery]);
  return (
    <group>
      {mountains.map((mountain) => (
        <group key={mountain.id} position={[mountain.x, mountain.y, mountain.z]} rotation={[0, mountain.angle, 0]}>
          <mesh position={[0, mountain.height / 2, 0]} castShadow receiveShadow>
            <coneGeometry args={[mountain.radius, mountain.height, 7]} />
            <meshStandardMaterial color="#6f775e" roughness={1} />
          </mesh>
          <mesh position={[0, mountain.height * 0.86, 0]} castShadow>
            <coneGeometry args={[mountain.radius * 0.34, mountain.height * 0.28, 7]} />
            <meshStandardMaterial color="#f5f2df" roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Banana({ entityRef, playerSize }) {
  const entity = entityRef.current;
  const scale = getRelativeVisualSize(entity.size, playerSize);
  return (
    <group scale={scale}>
      <mesh rotation={[Math.PI / 2, 0.2, 0.45]} castShadow>
        <torusGeometry args={[0.82, 0.13, 10, 28, Math.PI * 1.32]} />
        <meshStandardMaterial color="#ffd84c" roughness={0.58} />
      </mesh>
      <mesh position={[0.58, 0.46, 0]} rotation={[0, 0, 0.3]} castShadow>
        <sphereGeometry args={[0.12, 10, 8]} />
        <meshStandardMaterial color="#6a4c2b" roughness={0.9} />
      </mesh>
      <mesh position={[-0.64, -0.38, 0]} castShadow>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#6a4c2b" roughness={0.9} />
      </mesh>
    </group>
  );
}

function TinyEntityModel({ entity, playerSize }) {
  const scale = getEntityRenderScale(entity, playerSize);
  const phase = entity.pulse ?? 0;

  if (entity.kind === 'ant') {
    return (
      <group scale={scale}>
        <mesh position={[-0.12, 0.07, 0]} castShadow>
          <sphereGeometry args={[0.09, 8, 6]} />
          <meshStandardMaterial color="#1f1712" roughness={0.82} />
        </mesh>
        <mesh position={[0.02, 0.08, 0]} castShadow>
          <sphereGeometry args={[0.11, 8, 6]} />
          <meshStandardMaterial color="#2b1d15" roughness={0.84} />
        </mesh>
        <mesh position={[0.17, 0.07, 0]} castShadow>
          <sphereGeometry args={[0.075, 8, 6]} />
          <meshStandardMaterial color="#19110d" roughness={0.85} />
        </mesh>
        {[-1, 1].flatMap((side) =>
          [-0.08, 0.03, 0.13].map((x, index) => (
            <mesh key={`${side}-${index}`} position={[x, 0.03, side * 0.09]} rotation={[0.8, 0, side * (0.8 + Math.sin(phase + index) * 0.1)]} castShadow>
              <boxGeometry args={[0.018, 0.018, 0.18]} />
              <meshStandardMaterial color="#15100d" roughness={0.9} />
            </mesh>
          )),
        )}
      </group>
    );
  }

  if (entity.kind === 'worm') {
    return (
      <group scale={scale} rotation={[0, Math.sin(phase) * 0.18, 0]}>
        <mesh position={[0, 0.08, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <capsuleGeometry args={[0.08, 0.56, 8, 12]} />
          <meshStandardMaterial color="#b96f72" roughness={0.84} />
        </mesh>
      </group>
    );
  }

  if (entity.kind === 'flower') {
    return (
      <group scale={scale}>
        <mesh position={[0, 0.32, 0]} castShadow>
          <cylinderGeometry args={[0.025, 0.035, 0.62, 6]} />
          <meshStandardMaterial color="#3c8a3d" roughness={0.8} />
        </mesh>
        {[0, 1, 2, 3, 4].map((index) => (
          <mesh key={index} position={[Math.cos(index * 1.256) * 0.1, 0.68, Math.sin(index * 1.256) * 0.1]} castShadow>
            <sphereGeometry args={[0.075, 8, 6]} />
            <meshStandardMaterial color={index % 2 ? '#f08ab1' : '#ffe16a'} roughness={0.68} />
          </mesh>
        ))}
        <mesh position={[0, 0.68, 0]} castShadow>
          <sphereGeometry args={[0.055, 8, 6]} />
          <meshStandardMaterial color="#9a5b1f" roughness={0.7} />
        </mesh>
      </group>
    );
  }

  if (entity.kind === 'brush') {
    return (
      <group scale={scale}>
        {[
          [-0.16, 0.22, 0],
          [0.06, 0.28, -0.08],
          [0.17, 0.2, 0.09],
          [-0.02, 0.34, 0.12],
        ].map(([x, y, z], index) => (
          <mesh key={index} position={[x, y, z]} castShadow receiveShadow>
            <sphereGeometry args={[0.22, 9, 7]} />
            <meshStandardMaterial color={index % 2 ? '#438f3e' : '#327a36'} roughness={0.92} />
          </mesh>
        ))}
      </group>
    );
  }

  if (entity.kind === 'signpost') {
    return (
      <group scale={scale}>
        <mesh position={[0, 0.48, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.065, 0.96, 7]} />
          <meshStandardMaterial color="#7a5437" roughness={0.9} />
        </mesh>
        <mesh position={[0.22, 0.86, 0]} castShadow>
          <boxGeometry args={[0.54, 0.22, 0.06]} />
          <meshStandardMaterial color="#d8b36a" roughness={0.82} />
        </mesh>
      </group>
    );
  }

  if (entity.kind === 'sapling' || entity.kind === 'tree') {
    return (
      <group scale={scale}>
        <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.16, 0.22, 1.4, 7]} />
          <meshStandardMaterial color="#7d5234" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.9, 0]} castShadow receiveShadow>
          <coneGeometry args={[0.86, 1.9, 9]} />
          <meshStandardMaterial color="#348d42" roughness={0.9} />
        </mesh>
      </group>
    );
  }

  if (entity.kind === 'car') {
    return <group scale={scale * 0.28}><CarModel object={{ color: '#d84d3f', scale: 1 }} /></group>;
  }

  if (entity.kind === 'house') {
    return <group scale={scale * 0.22} position={[0, 0.5 * scale, 0]}><HouseModel object={{ color: '#d8ede6', roof: '#9d3f34' }} /></group>;
  }

  if (entity.kind === 'tank') {
    return <group scale={scale * 0.25}><TankModel object={{ color: '#6f8a5a', scale: 1 }} /></group>;
  }

  if (entity.kind === 'building') {
    const visualSize = getRelativeVisualSize(entity.size, playerSize);
    return (
      <BuildingModel
        object={{
          width: Math.max(1.8, visualSize * 0.3),
          depth: Math.max(1.8, visualSize * 0.3),
          height: Math.max(4, visualSize * 0.9),
          color: '#7b8794',
          windowColor: '#ffd36a',
        }}
      />
    );
  }

  if (entity.kind === 'tower') {
    const visualSize = getRelativeVisualSize(entity.size, playerSize);
    return (
      <TowerModel
        object={{
          height: Math.max(5, visualSize * 0.96),
          radius: Math.max(0.9, visualSize * 0.13),
          color: '#b7c0c7',
          cap: '#43617f',
        }}
      />
    );
  }

  if (entity.kind === 'mountain') {
    return (
      <group scale={scale}>
        <mesh position={[0, 34, 0]} castShadow receiveShadow>
          <coneGeometry args={[25, 68, 7]} />
          <meshStandardMaterial color="#6f775e" roughness={1} />
        </mesh>
        <mesh position={[0, 60, 0]} castShadow>
          <coneGeometry args={[8.8, 18, 7]} />
          <meshStandardMaterial color="#f5f2df" roughness={0.85} />
        </mesh>
      </group>
    );
  }

  return <Banana entityRef={{ current: entity }} playerSize={playerSize} />;
}

function MonkeyModel({ size = 1, variant = 'player', motionRef = null }) {
  const player = variant === 'player';
  const fur = player ? '#744122' : '#6a4a31';
  const face = player ? '#e0a86f' : '#c68e5e';
  const accent = player ? '#f2d155' : '#af7151';
  const bodyRef = useRef(null);
  const headRef = useRef(null);
  const faceRef = useRef(null);
  const mouthRef = useRef(null);
  const leftArmRef = useRef(null);
  const rightArmRef = useRef(null);
  const leftLegRef = useRef(null);
  const rightLegRef = useRef(null);
  const tailRef = useRef(null);
  const crownRef = useRef(null);
  const tailCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.58, 0.88, 0.28),
        new THREE.Vector3(-1.2, 1.3, 0.75),
        new THREE.Vector3(-1.02, 2.05, 0.62),
        new THREE.Vector3(-0.36, 1.88, 0.1),
      ]),
    [],
  );

  useFrame((state) => {
    if (!player || !motionRef?.current) return;

    const motion = motionRef.current;
    const walk = clamp(motion.walkAmount ?? 0, 0, 1);
    const phase = state.clock.elapsedTime * (5.8 + walk * 3.4);
    const step = Math.sin(phase) * walk;
    const counterStep = Math.sin(phase + Math.PI) * walk;
    const munchAge = Math.max(0, (motion.munchUntil ?? 0) - state.clock.elapsedTime);
    const munch = clamp(munchAge / 0.42, 0, 1);
    const chew = Math.sin((1 - munch) * Math.PI * 7) * munch;

    if (bodyRef.current) {
      bodyRef.current.rotation.x = walk * 0.045 * Math.sin(phase * 2);
      bodyRef.current.scale.set(1 + munch * 0.035, 1 - munch * 0.025, 1 + munch * 0.035);
    }
    if (headRef.current) {
      headRef.current.rotation.x = -walk * 0.06 + chew * 0.13;
      headRef.current.position.y = 1.95 + munch * 0.05;
    }
    if (faceRef.current) {
      faceRef.current.scale.set(1 + Math.abs(chew) * 0.12, 1 - Math.abs(chew) * 0.08, 1 + Math.abs(chew) * 0.18);
      faceRef.current.position.z = -0.43 - Math.abs(chew) * 0.04;
    }
    if (mouthRef.current) {
      mouthRef.current.rotation.x = Math.PI / 2 + Math.abs(chew) * 0.38;
      mouthRef.current.scale.set(1 + Math.abs(chew) * 0.15, 1 + Math.abs(chew) * 0.4, 1);
    }
    if (leftArmRef.current) leftArmRef.current.rotation.set(0.28 + counterStep * 0.38, 0, -0.38 - step * 0.24);
    if (rightArmRef.current) rightArmRef.current.rotation.set(0.28 + step * 0.38, 0, 0.38 - counterStep * 0.24);
    if (leftLegRef.current) leftLegRef.current.rotation.set(0.1 + step * 0.42, 0.05, 0.1);
    if (rightLegRef.current) rightLegRef.current.rotation.set(0.1 + counterStep * 0.42, -0.05, -0.1);
    if (tailRef.current) tailRef.current.rotation.y = step * 0.12;
    if (crownRef.current) crownRef.current.position.y = 2.53 + munch * 0.05 + walk * Math.abs(Math.sin(phase)) * 0.02;
  });

  return (
    <group scale={size}>
      <mesh ref={bodyRef} position={[0, 1.08, 0]} castShadow receiveShadow>
        <sphereGeometry args={[0.72, 22, 18]} />
        <meshStandardMaterial color={fur} roughness={0.82} />
      </mesh>
      <mesh ref={headRef} position={[0, 1.95, -0.04]} castShadow>
        <sphereGeometry args={[0.54, 24, 18]} />
        <meshStandardMaterial color={fur} roughness={0.8} />
      </mesh>
      <mesh ref={faceRef} position={[0, 1.84, -0.43]} castShadow>
        <sphereGeometry args={[0.33, 18, 12]} />
        <meshStandardMaterial color={face} roughness={0.72} />
      </mesh>
      <mesh position={[-0.42, 2.0, -0.03]} castShadow>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial color={fur} roughness={0.86} />
      </mesh>
      <mesh position={[0.42, 2.0, -0.03]} castShadow>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial color={fur} roughness={0.86} />
      </mesh>
      <mesh position={[-0.17, 2.03, -0.49]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color="#171511" roughness={0.5} />
      </mesh>
      <mesh position={[0.17, 2.03, -0.49]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color="#171511" roughness={0.5} />
      </mesh>
      <mesh ref={mouthRef} position={[0, 1.62, -0.68]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.13, 0.016, 6, 16, Math.PI]} />
        <meshStandardMaterial color="#3b1e18" roughness={0.75} />
      </mesh>
      <mesh ref={leftArmRef} position={[-0.64, 1.05, -0.02]} rotation={[0.28, 0, -0.38]} castShadow>
        <capsuleGeometry args={[0.12, 0.72, 6, 12]} />
        <meshStandardMaterial color={fur} roughness={0.82} />
      </mesh>
      <mesh ref={rightArmRef} position={[0.64, 1.05, -0.02]} rotation={[0.28, 0, 0.38]} castShadow>
        <capsuleGeometry args={[0.12, 0.72, 6, 12]} />
        <meshStandardMaterial color={fur} roughness={0.82} />
      </mesh>
      <mesh ref={leftLegRef} position={[-0.28, 0.34, 0.03]} rotation={[0.1, 0.05, 0.1]} castShadow>
        <capsuleGeometry args={[0.15, 0.68, 6, 12]} />
        <meshStandardMaterial color={fur} roughness={0.82} />
      </mesh>
      <mesh ref={rightLegRef} position={[0.28, 0.34, 0.03]} rotation={[0.1, -0.05, -0.1]} castShadow>
        <capsuleGeometry args={[0.15, 0.68, 6, 12]} />
        <meshStandardMaterial color={fur} roughness={0.82} />
      </mesh>
      <mesh ref={tailRef} castShadow>
        <tubeGeometry args={[tailCurve, 18, 0.055, 8, false]} />
        <meshStandardMaterial color={fur} roughness={0.82} />
      </mesh>
      {player && (
        <mesh ref={crownRef} position={[0, 2.53, -0.03]} rotation={[0.04, 0, 0]} castShadow>
          <coneGeometry args={[0.27, 0.36, 5]} />
          <meshStandardMaterial color={accent} roughness={0.62} />
        </mesh>
      )}
    </group>
  );
}

function ProceduralTRexModel({ size = 1, motionRef = null, variant = 'player', tone = 0 }) {
  const enemy = variant === 'enemy';
  const palette = useMemo(() => {
    const enemyPalettes = [
      { hide: '#65402f', dark: '#3d261d', mid: '#825437', light: '#bd8b59', belly: '#d0a66b', ridge: '#c56c3d', eye: '#f3d36c' },
      { hide: '#5e4b35', dark: '#31271d', mid: '#75613f', light: '#a58b55', belly: '#c7ad75', ridge: '#b85b38', eye: '#f1c95e' },
      { hide: '#6c352f', dark: '#351c19', mid: '#88483a', light: '#b46f54', belly: '#d19a74', ridge: '#dc8150', eye: '#ffe080' },
    ];
    if (enemy) return enemyPalettes[Math.floor(clamp(tone, 0, 0.999) * enemyPalettes.length)];
    return { hide: '#476f43', dark: '#27472d', mid: '#598d4d', light: '#83a85d', belly: '#c5b67a', ridge: '#d8b64f', eye: '#ffe176' };
  }, [enemy, tone]);
  const bodyRef = useRef(null);
  const chestRef = useRef(null);
  const hipRef = useRef(null);
  const neckRef = useRef(null);
  const headRef = useRef(null);
  const jawRef = useRef(null);
  const leftThighRef = useRef(null);
  const rightThighRef = useRef(null);
  const leftShinRef = useRef(null);
  const rightShinRef = useRef(null);
  const leftFootRef = useRef(null);
  const rightFootRef = useRef(null);
  const leftArmRef = useRef(null);
  const rightArmRef = useRef(null);
  const tailRef = useRef(null);
  const spineRef = useRef(null);
  const tailCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.22, 0.84),
        new THREE.Vector3(0, 1.12, 1.75),
        new THREE.Vector3(0, 0.9, 2.82),
        new THREE.Vector3(0, 0.56, 4.12),
      ]),
    [],
  );
  const dorsalSpines = useMemo(
    () => [
      { x: 0, y: 2.14, z: -1.58, h: 0.2, r: 0.08 },
      { x: 0, y: 2.04, z: -1.13, h: 0.28, r: 0.1 },
      { x: 0, y: 1.93, z: -0.62, h: 0.34, r: 0.12 },
      { x: 0, y: 1.82, z: -0.08, h: 0.33, r: 0.12 },
      { x: 0, y: 1.67, z: 0.47, h: 0.29, r: 0.1 },
      { x: 0, y: 1.48, z: 1.03, h: 0.23, r: 0.08 },
      { x: 0, y: 1.25, z: 1.68, h: 0.16, r: 0.06 },
    ],
    [],
  );
  const flankStripes = useMemo(
    () =>
      [-1, 1].flatMap((side) =>
        [-0.74, -0.34, 0.08, 0.5, 0.92].map((z, index) => ({
          side,
          z,
          y: 1.62 - Math.max(0, z) * 0.22,
          length: 0.42 - index * 0.025,
          angle: side * (0.38 + index * 0.035),
        })),
      ),
    [],
  );

  useFrame((state) => {
    const motion = motionRef?.current;
    if (!motion) return;

    const walk = clamp(motion.walkAmount ?? 0, 0, 1);
    const phase = state.clock.elapsedTime * (4.4 + walk * 3.2);
    const stride = Math.sin(phase) * walk;
    const counterStride = Math.sin(phase + Math.PI) * walk;
    const munchAge = Math.max(0, (motion.munchUntil ?? 0) - state.clock.elapsedTime);
    const munch = clamp(munchAge / 0.5, 0, 1);
    const snap = Math.abs(Math.sin((1 - munch) * Math.PI * 6)) * munch;

    if (bodyRef.current) {
      bodyRef.current.rotation.x = -0.08 + Math.sin(phase * 2) * walk * 0.025;
      bodyRef.current.position.y = 1.34 + Math.abs(stride) * 0.055;
      bodyRef.current.scale.set(0.82 + munch * 0.04, 0.6 - munch * 0.015, 1.36 + munch * 0.03);
    }
    if (chestRef.current) chestRef.current.rotation.x = -0.1 + walk * Math.sin(phase * 2.1) * 0.025;
    if (hipRef.current) hipRef.current.rotation.x = 0.05 - walk * Math.sin(phase * 2.1) * 0.018;
    if (neckRef.current) neckRef.current.rotation.x = -0.58 + snap * 0.11 - walk * 0.035;
    if (headRef.current) {
      headRef.current.rotation.x = -0.05 + snap * 0.15 - walk * 0.025;
      headRef.current.position.y = 2.18 + snap * 0.07;
    }
    if (jawRef.current) jawRef.current.rotation.x = 0.1 + snap * 0.58;
    if (leftThighRef.current) leftThighRef.current.rotation.x = 0.16 + stride * 0.48;
    if (rightThighRef.current) rightThighRef.current.rotation.x = 0.16 + counterStride * 0.48;
    if (leftShinRef.current) leftShinRef.current.rotation.x = -0.28 - stride * 0.28;
    if (rightShinRef.current) rightShinRef.current.rotation.x = -0.28 - counterStride * 0.28;
    if (leftFootRef.current) leftFootRef.current.rotation.x = 0.08 - stride * 0.18;
    if (rightFootRef.current) rightFootRef.current.rotation.x = 0.08 - counterStride * 0.18;
    if (leftArmRef.current) leftArmRef.current.rotation.x = -0.5 + counterStride * 0.18 + snap * 0.14;
    if (rightArmRef.current) rightArmRef.current.rotation.x = -0.5 + stride * 0.18 + snap * 0.14;
    if (tailRef.current) tailRef.current.rotation.y = -stride * 0.08 + Math.sin(phase * 0.5) * 0.02;
    if (spineRef.current) spineRef.current.position.y = snap * 0.025;
  });

  return (
    <group scale={size}>
      <mesh ref={bodyRef} position={[0, 1.34, 0.12]} scale={[0.82, 0.6, 1.36]} castShadow receiveShadow>
        <sphereGeometry args={[1, 34, 22]} />
        <meshStandardMaterial color={palette.hide} roughness={0.84} />
      </mesh>
      <mesh ref={chestRef} position={[0, 1.5, -0.86]} scale={[0.58, 0.66, 0.72]} castShadow receiveShadow>
        <sphereGeometry args={[1, 30, 18]} />
        <meshStandardMaterial color={palette.mid} roughness={0.82} />
      </mesh>
      <mesh ref={hipRef} position={[0, 1.2, 0.94]} scale={[0.78, 0.54, 0.72]} castShadow receiveShadow>
        <sphereGeometry args={[1, 28, 18]} />
        <meshStandardMaterial color={palette.hide} roughness={0.86} />
      </mesh>
      <mesh position={[0, 1.0, -0.18]} scale={[0.46, 0.18, 1.04]} castShadow>
        <sphereGeometry args={[1, 22, 12]} />
        <meshStandardMaterial color={palette.belly} roughness={0.88} />
      </mesh>
      <mesh ref={neckRef} position={[0, 1.82, -1.22]} rotation={[-0.58, 0, 0]} scale={[0.84, 1, 1]} castShadow receiveShadow>
        <capsuleGeometry args={[0.24, 0.9, 12, 22]} />
        <meshStandardMaterial color={palette.mid} roughness={0.82} />
      </mesh>
      <group ref={headRef} position={[0, 2.18, -1.86]}>
        <mesh position={[0, 0.02, 0.1]} scale={[0.5, 0.34, 0.58]} castShadow receiveShadow>
          <sphereGeometry args={[1, 30, 18]} />
          <meshStandardMaterial color={palette.mid} roughness={0.78} />
        </mesh>
        <mesh position={[0, -0.05, -0.46]} scale={[0.4, 0.2, 0.72]} castShadow receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={palette.light} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.14, -0.82]} scale={[0.33, 0.16, 0.42]} castShadow receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={palette.light} roughness={0.82} />
        </mesh>
        <mesh position={[0, 0.22, -0.34]} scale={[0.48, 0.09, 0.35]} castShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={palette.dark} roughness={0.82} />
        </mesh>
        <mesh ref={jawRef} position={[0, -0.23, -0.58]} rotation={[0.1, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.7, 0.18, 0.9]} />
          <meshStandardMaterial color={palette.belly} roughness={0.78} />
        </mesh>
        {[-0.26, -0.13, 0, 0.13, 0.26].map((x, index) => (
          <mesh key={`top-tooth-${index}`} position={[x, -0.2, -0.86]} rotation={[Math.PI, 0, 0]} castShadow>
            <coneGeometry args={[0.032, 0.18, 7]} />
            <meshStandardMaterial color="#fff4d6" roughness={0.58} />
          </mesh>
        ))}
        {[-0.22, -0.07, 0.08, 0.23].map((x, index) => (
          <mesh key={`lower-tooth-${index}`} position={[x, -0.31, -0.9]} castShadow>
            <coneGeometry args={[0.027, 0.14, 7]} />
            <meshStandardMaterial color="#fff4d6" roughness={0.58} />
          </mesh>
        ))}
        {[-0.26, 0.26].map((x) => (
          <group key={`eye-${x}`}>
            <mesh position={[x, 0.17, -0.36]} castShadow>
              <sphereGeometry args={[0.07, 14, 10]} />
              <meshStandardMaterial color={palette.eye} roughness={0.34} emissive={palette.eye} emissiveIntensity={0.08} />
            </mesh>
            <mesh position={[x, 0.2, -0.41]} scale={[1, 0.68, 0.35]} castShadow>
              <sphereGeometry args={[0.032, 10, 8]} />
              <meshStandardMaterial color="#10130d" roughness={0.42} />
            </mesh>
            <mesh position={[x * 0.98, 0.28, -0.32]} rotation={[0.1, 0, x > 0 ? -0.32 : 0.32]} castShadow>
              <boxGeometry args={[0.24, 0.045, 0.08]} />
              <meshStandardMaterial color={palette.dark} roughness={0.86} />
            </mesh>
          </group>
        ))}
        {[-0.14, 0.14].map((x) => (
          <mesh key={`nostril-${x}`} position={[x, 0.09, -1.04]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.026, 0.026, 0.018, 8]} />
            <meshStandardMaterial color="#151811" roughness={0.65} />
          </mesh>
        ))}
      </group>
      <mesh ref={tailRef} castShadow>
        <tubeGeometry args={[tailCurve, 36, 0.15, 12, false]} />
        <meshStandardMaterial color={palette.dark} roughness={0.84} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={`leg-${side}`}>
          <group ref={side < 0 ? leftThighRef : rightThighRef} position={[side * 0.34, 0.78, 0.24]} rotation={[0.16, 0, side * 0.07]}>
            <mesh position={[0, 0.16, 0]} scale={[1.08, 1, 0.82]} castShadow receiveShadow>
              <capsuleGeometry args={[0.22, 0.72, 10, 18]} />
              <meshStandardMaterial color={palette.dark} roughness={0.84} />
            </mesh>
          </group>
          <mesh
            ref={side < 0 ? leftShinRef : rightShinRef}
            position={[side * 0.36, 0.33, -0.06]}
            rotation={[-0.28, 0, side * 0.03]}
            castShadow
            receiveShadow
          >
            <capsuleGeometry args={[0.13, 0.72, 8, 16]} />
            <meshStandardMaterial color={palette.hide} roughness={0.86} />
          </mesh>
          <group ref={side < 0 ? leftFootRef : rightFootRef} position={[side * 0.36, 0.06, -0.38]} rotation={[0.08, 0, side * 0.02]}>
            <mesh position={[0, 0, -0.08]} castShadow receiveShadow>
              <boxGeometry args={[0.3, 0.14, 0.72]} />
              <meshStandardMaterial color={palette.dark} roughness={0.86} />
            </mesh>
            {[-0.1, 0, 0.1].map((toeX, index) => (
              <mesh key={`toe-${index}`} position={[toeX, -0.01, -0.48]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <coneGeometry args={[0.035, 0.2, 7]} />
                <meshStandardMaterial color="#1f2119" roughness={0.62} />
              </mesh>
            ))}
          </group>
        </group>
      ))}
      {[-1, 1].map((side) => (
        <group key={`arm-${side}`} ref={side < 0 ? leftArmRef : rightArmRef} position={[side * 0.45, 1.5, -0.74]} rotation={[-0.5, side * 0.12, side * 0.38]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.055, 0.38, 6, 12]} />
            <meshStandardMaterial color={palette.dark} roughness={0.86} />
          </mesh>
          <mesh position={[side * 0.03, -0.24, -0.12]} rotation={[Math.PI / 2, 0, side * 0.15]} castShadow>
            <coneGeometry args={[0.025, 0.16, 6]} />
            <meshStandardMaterial color="#1f2119" roughness={0.62} />
          </mesh>
        </group>
      ))}
      <group ref={spineRef}>
        {dorsalSpines.map((spine, index) => (
          <mesh key={`spine-${index}`} position={[spine.x, spine.y, spine.z]} rotation={[0.22, 0, 0]} castShadow>
            <coneGeometry args={[spine.r, spine.h, 5]} />
            <meshStandardMaterial color={palette.ridge} roughness={0.66} />
          </mesh>
        ))}
      </group>
      {flankStripes.map((stripe, index) => (
        <mesh key={`stripe-${index}`} position={[stripe.side * 0.58, stripe.y, stripe.z]} rotation={[0, stripe.side * 0.32, stripe.angle]} castShadow>
          <boxGeometry args={[0.04, stripe.length, 0.12]} />
          <meshStandardMaterial color={palette.dark} roughness={0.9} />
        </mesh>
      ))}
      {[-1, 1].flatMap((side) =>
        [-0.52, -0.1, 0.35, 0.72].map((z, index) => (
          <mesh key={`scale-${side}-${index}`} position={[side * 0.43, 1.25 + index * 0.08, z]} scale={[1, 0.5, 0.35]} castShadow>
            <sphereGeometry args={[0.045, 8, 6]} />
            <meshStandardMaterial color={palette.light} roughness={0.94} />
          </mesh>
        )),
      )}
      {enemy && (
        <mesh position={[0, 2.72, -0.05]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.46, 0.54, 28]} />
          <meshBasicMaterial color="#ff5b3d" transparent opacity={0.78} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function AssetTRexModel({ size = 1, motionRef = null, variant = 'player', tone = 0 }) {
  const enemy = variant === 'enemy';
  const gltf = useLoader(GLTFLoader, T_REX_MODEL_URL);
  const groupRef = useRef(null);
  const mixerRef = useRef(null);
  const actionRef = useRef(null);

  const { model, normalizeScale } = useMemo(() => {
    const cloned = cloneSkeleton(gltf.scene);
    const tint = enemy
      ? new THREE.Color().setHSL(0.04 + clamp(tone, 0, 1) * 0.08, 0.55, 0.42)
      : new THREE.Color('#b7d879');

    cloned.traverse((child) => {
      if (!child.isMesh) return;

      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const clonedMaterials = materials.map((material) => {
        const next = material?.clone ? material.clone() : new THREE.MeshStandardMaterial({ color: '#7a9d4b' });
        if (next.color) next.color.lerp(tint, enemy ? 0.34 : 0.12);
        if ('roughness' in next) next.roughness = Math.max(0.68, next.roughness ?? 0.8);
        if ('metalness' in next) next.metalness = 0;
        return next;
      });
      child.material = Array.isArray(child.material) ? clonedMaterials : clonedMaterials[0];
    });

    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const dimensions = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z, 0.001);
    const center = box.getCenter(new THREE.Vector3());
    cloned.position.set(cloned.position.x - center.x, cloned.position.y - box.min.y, cloned.position.z - center.z);

    return {
      model: cloned,
      normalizeScale: T_REX_MODEL_TARGET_LENGTH / maxDimension,
    };
  }, [enemy, gltf.scene, tone]);

  useEffect(() => {
    const clips = gltf.animations ?? [];
    if (clips.length === 0) {
      mixerRef.current = null;
      actionRef.current = null;
      return undefined;
    }

    const mixer = new THREE.AnimationMixer(model);
    const clip =
      clips.find((candidate) => /walk|run|move/i.test(candidate.name)) ??
      clips.find((candidate) => /idle|take/i.test(candidate.name)) ??
      clips[0];
    const action = mixer.clipAction(clip);
    action.reset().fadeIn(0.15).play();
    mixerRef.current = mixer;
    actionRef.current = action;

    return () => {
      action.stop();
      mixer.stopAllAction();
    };
  }, [gltf.animations, model]);

  useFrame((state, delta) => {
    const motion = motionRef?.current;
    const walk = clamp(motion?.walkAmount ?? 0, 0, 1);
    const phase = state.clock.elapsedTime * (4.8 + walk * 3.4);
    const munchAge = Math.max(0, (motion?.munchUntil ?? 0) - state.clock.elapsedTime);
    const munch = clamp(munchAge / 0.52, 0, 1);
    const chew = Math.abs(Math.sin((1 - munch) * Math.PI * 7)) * munch;

    if (mixerRef.current) {
      if (actionRef.current) actionRef.current.timeScale = 0.42 + walk * 1.25 + chew * 0.9;
      mixerRef.current.update(delta);
    }

    if (groupRef.current) {
      groupRef.current.position.y = Math.abs(Math.sin(phase)) * walk * 0.075 + chew * 0.035;
      groupRef.current.rotation.x = -0.025 + Math.sin(phase * 2) * walk * 0.018 + chew * 0.04;
      groupRef.current.scale.set(normalizeScale * (1 + chew * 0.028), normalizeScale * (1 - chew * 0.012), normalizeScale * (1 + chew * 0.04));
    }
  });

  return (
    <group scale={size} rotation={[0, Math.PI, 0]}>
      <group ref={groupRef} scale={normalizeScale}>
        <primitive object={model} />
      </group>
      {enemy && (
        <mesh position={[0, 3.15, -0.05]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.46, 0.54, 28]} />
          <meshBasicMaterial color="#ff5b3d" transparent opacity={0.78} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function TRexModel(props) {
  return (
    <Suspense fallback={<ProceduralTRexModel {...props} />}>
      <AssetTRexModel {...props} />
    </Suspense>
  );
}

function FloatingEntity({ entity, registerEntityRef, playerSize, worldPhase }) {
  const groupRef = useRef(null);
  const entityRef = useRef(entity);
  entityRef.current = entity;

  useEffect(() => {
    registerEntityRef(entity.id, groupRef);
    return () => registerEntityRef(entity.id, null);
  }, [entity.id, registerEntityRef]);

  return (
    <group ref={groupRef} position={[entity.position.x, getGroundHeight(entity.position.x, entity.position.z, worldPhase), entity.position.z]} rotation={[0, entity.angle, 0]}>
      {entity.kind === 'monkey' ? <MonkeyModel size={getRelativeVisualSize(entity.size, playerSize)} variant="wild" /> : <TinyEntityModel entity={entityRef.current} playerSize={playerSize} />}
    </group>
  );
}

function RivalRex({ rival, playerSize, worldPhase }) {
  const groupRef = useRef(null);
  const rivalRef = useRef(rival);
  rivalRef.current = rival;

  useFrame((state) => {
    if (!groupRef.current) return;

    const visualSize = getRivalVisualSize(rival.size, playerSize);
    const ground = getGroundHeight(rival.position.x, rival.position.z, worldPhase);
    const bob = Math.sin(state.clock.elapsedTime * 5.4 + rival.variantSeed * 8) * 0.025 * visualSize * (rival.walkAmount ?? 0);
    groupRef.current.position.set(rival.position.x, ground + bob, rival.position.z);
    groupRef.current.scale.setScalar(visualSize);
    groupRef.current.rotation.y = rival.heading + Math.PI;
  });

  return (
    <group ref={groupRef}>
      <TRexModel size={0.74} motionRef={rivalRef} variant="enemy" tone={rival.variantSeed} />
    </group>
  );
}

function Player({ playerRef, worldPhase }) {
  const groupRef = useRef(null);

  useFrame((state) => {
    const player = playerRef.current;
    if (!groupRef.current) return;

    const visualSize = getVisualSize(player.size);
    const ground = getGroundHeight(player.position.x, player.position.z, worldPhase);
    const bob = Math.sin(state.clock.elapsedTime * 6) * 0.03 * visualSize * (player.walkAmount ?? 0);
    groupRef.current.position.set(player.position.x, ground + bob, player.position.z);
    groupRef.current.scale.setScalar(visualSize);
    groupRef.current.rotation.y = player.heading + Math.PI;
  });

  return (
    <group ref={groupRef}>
      <TRexModel size={0.82} motionRef={playerRef} variant="player" />
    </group>
  );
}

function EatBurst({ burst, worldPhase }) {
  const ref = useRef(null);
  const visualSize = getVisualSize(burst.size);

  useFrame((state) => {
    if (!ref.current) return;
    const age = state.clock.elapsedTime - burst.createdAt;
    const alpha = clamp(1 - age / 0.7, 0, 1);
    ref.current.scale.setScalar(1 + age * 3);
    ref.current.material.opacity = alpha;
  });

  return (
    <mesh ref={ref} position={[burst.x, getGroundHeight(burst.x, burst.z, worldPhase) + burst.y, burst.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.5 * visualSize, 0.72 * visualSize, 32]} />
      <meshBasicMaterial color={burst.kind === 'banana' ? '#ffe373' : '#f09a58'} transparent opacity={0.75} depthWrite={false} />
    </mesh>
  );
}

function SkyDome() {
  return (
    <mesh scale={62000}>
      <sphereGeometry args={[1, 32, 16]} />
      <meshBasicMaterial color="#9fd7f7" side={THREE.BackSide} />
    </mesh>
  );
}

function GlobeWorld({ won }) {
  const radius = GLOBE_RADIUS;
  const geometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(radius, 96, 48);
    const position = geo.attributes.position;
    const colors = [];
    const color = new THREE.Color();

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i) / radius;
      const y = position.getY(i) / radius;
      const z = position.getZ(i) / radius;
      const lat = Math.asin(y);
      const lon = Math.atan2(z, x);
      const landScore =
        Math.sin(lon * 3.1 + lat * 2.3) +
        Math.cos(lon * 5.4 - lat * 1.7) * 0.72 +
        Math.sin((lon + lat) * 8.2) * 0.38;

      if (landScore > 0.18) {
        color.set(y > 0.62 ? '#d8e4cf' : y > 0.18 ? '#80a960' : '#6da758');
      } else {
        color.set(y > 0.58 ? '#8fcfe4' : '#4faac9');
      }
      colors.push(color.r, color.g, color.b);
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <group position={[0, -radius + 8, 0]}>
      <mesh geometry={geometry} receiveShadow castShadow>
        <meshStandardMaterial vertexColors roughness={0.88} metalness={0.01} />
      </mesh>
      <mesh scale={1.012}>
        <sphereGeometry args={[radius, 64, 32]} />
        <meshBasicMaterial color={won ? '#fff4b8' : '#b9ecff'} transparent opacity={won ? 0.22 : 0.12} side={THREE.BackSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function GlobeScenery({ scenery }) {
  const globeObjects = useMemo(() => scenery.filter((item) => ['tree', 'house', 'building', 'tower', 'mountain'].includes(item.kind)), [scenery]);

  return (
    <group>
      {globeObjects.map((object) => {
        const y = getGlobeSurfaceHeight(object.x, object.z);
        const angle = object.angle ?? seeded(object.x + object.z) * Math.PI * 2;

        return (
          <group key={object.id} position={[object.x, y, object.z]} rotation={[0, angle, 0]} scale={9.5}>
            {object.kind === 'tree' && (
              <group scale={object.scale}>
                <mesh position={[0, 2.4, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[0.65, 0.9, 4.8, 7]} />
                  <meshStandardMaterial color="#7d5234" roughness={0.9} />
                </mesh>
                <mesh position={[0, 7.2, 0]} castShadow receiveShadow>
                  <coneGeometry args={[3.3, 7.4, 9]} />
                  <meshStandardMaterial color={object.hue > 0.55 ? '#2d8a4c' : '#3d9c3b'} roughness={0.9} />
                </mesh>
              </group>
            )}
            {object.kind === 'house' && (
              <group position={[0, 2.25, 0]}>
                <HouseModel object={object} />
              </group>
            )}
            {object.kind === 'building' && <BuildingModel object={object} />}
            {object.kind === 'tower' && <TowerModel object={object} />}
            {object.kind === 'mountain' && (
              <group scale={0.9}>
                <mesh position={[0, object.height / 2, 0]} castShadow receiveShadow>
                  <coneGeometry args={[object.radius, object.height, 7]} />
                  <meshStandardMaterial color="#6f775e" roughness={1} />
                </mesh>
                <mesh position={[0, object.height * 0.86, 0]} castShadow>
                  <coneGeometry args={[object.radius * 0.34, object.height * 0.28, 7]} />
                  <meshStandardMaterial color="#f5f2df" roughness={0.85} />
                </mesh>
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}

function WorldTiles({ phase, won }) {
  const tiles = useMemo(() => getTilesForPhase(phase), [phase]);
  const waterSize = COUNTRY_SIZE * (getTileRadiusForPhase(phase) * 2 + 1) + 900;

  if (phase >= 4) return <GlobeWorld won={won} />;

  return (
    <group>
      <mesh position={[0, -2.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[waterSize, waterSize]} />
        <meshStandardMaterial color="#4da3c4" roughness={0.55} metalness={0.02} />
      </mesh>
      {tiles.map((tile) => (
        <group key={tile.id}>
          <Terrain offsetX={tile.offsetX} offsetZ={tile.offsetZ} tileSeed={tile.tileSeed} />
          <RoadsAndFields offsetX={tile.offsetX} offsetZ={tile.offsetZ} tileSeed={tile.tileSeed} showBorder={phase === 0} />
        </group>
      ))}
    </group>
  );
}

function GameScene({ inputRef, pausedRef, resetToken, startSize, onStats, onWin, onLose, gameWon, gameLost }) {
  const { camera, gl } = useThree();
  const playerRef = useRef({
    position: new THREE.Vector3(0, 0, 0),
    size: START_SIZE,
    heading: 0,
    bananas: 0,
    monkeys: 0,
    objects: 0,
    eaten: 0,
    score: 0,
    elapsedSeconds: 0,
    walkAmount: 0,
    munchUntil: 0,
    eatCooldown: 0,
    sceneryEatCooldown: 0,
    won: false,
    lost: false,
  });
  const entitiesRef = useRef(initialEntities());
  const sceneryRef = useRef(createSceneryForPhase(0));
  const rivalsRef = useRef(initialRivals());
  const worldPhaseRef = useRef(0);
  const entityObjectRefs = useRef(new Map());
  const burstsRef = useRef([]);
  const [entitiesVersion, setEntitiesVersion] = useState(0);
  const [sceneryVersion, setSceneryVersion] = useState(0);
  const [rivalsVersion, setRivalsVersion] = useState(0);
  const [burstsVersion, setBurstsVersion] = useState(0);
  const [worldPhase, setWorldPhase] = useState(0);
  const lastStatsRef = useRef(0);
  const tempVector = useMemo(() => new THREE.Vector3(), []);
  const targetVector = useMemo(() => new THREE.Vector3(), []);
  const cameraOffset = useMemo(() => new THREE.Vector3(), []);

  const publishStats = useCallback(
    (force = false) => {
      const player = playerRef.current;
      const now = performance.now();
      if (!force && now - lastStatsRef.current < 140) return;
      lastStatsRef.current = now;

      const size = player.size;
      const phase = getWorldPhase(size);
      const strength = Math.max(1, Math.pow(Math.max(1, safeNumber(size)), 1.42) * 12);
      onStats({
        sizeLabel: `${formatMagnitude(size)}x`,
        strength: formatMagnitude(strength, 1),
        score: formatScore(player.score),
        time: formatDuration(player.elapsedSeconds),
        bananas: player.bananas,
        monkeys: player.monkeys,
        objects: player.objects,
        rivals: rivalsRef.current.length,
        spawnDensity: `${getSpawnMultiplier(inputRef.current.spawnMultiplier)}x`,
        world: getPhaseLabel(phase),
      });
    },
    [inputRef, onStats],
  );

  const registerEntityRef = useCallback((id, objectRef) => {
    if (objectRef) {
      entityObjectRefs.current.set(id, objectRef);
    } else {
      entityObjectRefs.current.delete(id);
    }
  }, []);

  const refillEntities = useCallback(() => {
    const entities = entitiesRef.current;
    const player = playerRef.current;
    const worldLimit = getWorldLimit(worldPhaseRef.current);
    const targetEntityCount = getTargetEntityCount(inputRef.current.spawnMultiplier);

    while (entities.length < targetEntityCount) {
      entities.push(makeEntity(pickEntityDefinition(player.size), player.position, player.size, '', worldLimit, worldPhaseRef.current));
    }
  }, [inputRef]);

  const ensureSceneryForPhase = useCallback((phase) => {
    const existingIds = new Set(sceneryRef.current.map((item) => item.id));
    const additions = createSceneryForPhase(phase).filter((item) => !existingIds.has(item.id));
    if (additions.length === 0) return;

    sceneryRef.current = [...sceneryRef.current, ...additions];
    setSceneryVersion((value) => value + 1);
  }, []);

  const ensureRivalsForPhase = useCallback((phase) => {
    const desiredCount = getRivalCountForPhase(phase);
    if (rivalsRef.current.length >= desiredCount) return;

    const player = playerRef.current;
    const additions = [];
    for (let index = rivalsRef.current.length; index < desiredCount; index += 1) {
      additions.push(makeRivalRex(index, player.position, player.size, phase));
    }

    rivalsRef.current = [...rivalsRef.current, ...additions];
    setRivalsVersion((value) => value + 1);
  }, []);

  const resetGame = useCallback(() => {
    const requestedStartSize = Number.isFinite(startSize) ? clamp(startSize, START_SIZE, MAX_LOGICAL_SIZE) : getRequestedStartSize();
    const startPhase = getWorldPhase(requestedStartSize);
    playerRef.current = {
      position: new THREE.Vector3(0, 0, 0),
      size: requestedStartSize,
      heading: 0,
      bananas: 0,
      monkeys: 0,
      objects: 0,
      eaten: 0,
      score: 0,
      elapsedSeconds: 0,
      walkAmount: 0,
      munchUntil: 0,
      eatCooldown: 0,
      sceneryEatCooldown: 0,
      won: false,
      lost: false,
    };
    entitiesRef.current = initialEntities(startPhase, requestedStartSize);
    sceneryRef.current = createSceneryForPhase(startPhase);
    rivalsRef.current = initialRivals(requestedStartSize, startPhase);
    worldPhaseRef.current = startPhase;
    burstsRef.current = [];
    setWorldPhase(startPhase);
    setEntitiesVersion((value) => value + 1);
    setSceneryVersion((value) => value + 1);
    setRivalsVersion((value) => value + 1);
    setBurstsVersion((value) => value + 1);
    publishStats(true);
  }, [publishStats, startSize]);

  useEffect(() => {
    resetGame();
  }, [resetGame, resetToken]);

  useEffect(() => {
    gl.setClearColor('#9fd7f7', 1);
  }, [gl]);

  useFrame((state, delta) => {
    const player = playerRef.current;
    const dt = Math.min(delta, 0.28);
    if (!pausedRef.current && !player.won && !player.lost) {
      player.elapsedSeconds = safeNumber(player.elapsedSeconds, 0) + dt;
    }
    const activePhase = getWorldPhase(player.size);
    if (activePhase > worldPhaseRef.current) {
      worldPhaseRef.current = activePhase;
      ensureSceneryForPhase(activePhase);
      ensureRivalsForPhase(activePhase);
      setWorldPhase(activePhase);
      publishStats(true);
    }
    if (!player.won && activePhase >= 4 && player.size >= FINAL_GLOBE_SIZE) {
      player.won = true;
      player.munchUntil = state.clock.elapsedTime + 0.8;
      onWin(getPlayerSummary(player));
      publishStats(true);
    }

    const targetEntityCount = getTargetEntityCount(inputRef.current.spawnMultiplier);
    if (!player.lost && entitiesRef.current.length < targetEntityCount) {
      refillEntities();
      setEntitiesVersion((value) => value + 1);
      publishStats(true);
    } else if (entitiesRef.current.length > targetEntityCount * 1.08) {
      entitiesRef.current = entitiesRef.current.slice(0, targetEntityCount);
      setEntitiesVersion((value) => value + 1);
      publishStats(true);
    }

    if (!pausedRef.current && !player.lost) {
      const keyboard = inputRef.current.keyboard;
      const touch = inputRef.current.touch;
      const dx = Math.abs(touch.x) > 0.04 || Math.abs(touch.y) > 0.04 ? touch.x : keyboard.x;
      const dz = Math.abs(touch.x) > 0.04 || Math.abs(touch.y) > 0.04 ? touch.y : keyboard.y;
      const cameraControls = inputRef.current.camera;
      const cameraYaw = safeNumber(cameraControls?.yaw, 0);

      tempVector.set(dx, 0, dz);
      const moving = tempVector.lengthSq() > 0.002;
      player.walkAmount = moving ? Math.min(1, (player.walkAmount ?? 0) + dt * 5.5) : Math.max(0, (player.walkAmount ?? 0) - dt * 4.2);
      if (moving) {
        tempVector.normalize();
        tempVector.set(
          tempVector.x * Math.cos(cameraYaw) + tempVector.z * Math.sin(cameraYaw),
          0,
          -tempVector.x * Math.sin(cameraYaw) + tempVector.z * Math.cos(cameraYaw),
        );
        const speed = getMoveSpeed(player.size, worldPhaseRef.current);
        const nextPosition = constrainToWorld(player.position.x + tempVector.x * speed * dt, player.position.z + tempVector.z * speed * dt, worldPhaseRef.current);
        player.position.x = nextPosition.x;
        player.position.z = nextPosition.z;
        player.heading = Math.atan2(tempVector.x, tempVector.z);
      }

      let ateSomething = false;
      let entitiesChanged = false;
      let sceneryChanged = false;
      let rivalsChanged = false;
      let playerWasEaten = false;
      const worldLimit = getWorldLimit(worldPhaseRef.current);
      const playerRadius = Math.max(0.55, getVisualSize(player.size) * 0.68);
      let sceneryEatenThisFrame = 0;
      let growthThisFrame = 0;
      player.eatCooldown = Math.max(0, (player.eatCooldown ?? 0) - dt);
      player.sceneryEatCooldown = Math.max(0, (player.sceneryEatCooldown ?? 0) - dt);

      for (const entity of entitiesRef.current) {
        if (MOVING_ENTITY_KINDS.has(entity.kind)) {
          entity.angle += Math.sin(state.clock.elapsedTime * 0.7 + entity.size) * dt * 0.45;
          const entityVisualSize = getRelativeVisualSize(entity.size, player.size);
          const nextEntityPosition = constrainToWorld(
            entity.position.x + Math.sin(entity.angle) * entity.speed * dt * Math.max(0.35, entityVisualSize),
            entity.position.z + Math.cos(entity.angle) * entity.speed * dt * Math.max(0.35, entityVisualSize),
            worldPhaseRef.current,
          );
          entity.position.x = nextEntityPosition.x;
          entity.position.z = nextEntityPosition.z;
        } else {
          entity.pulse += dt * 2.4;
        }

        const objectRef = entityObjectRefs.current.get(entity.id);
        if (objectRef?.current) {
          const y = getGroundHeight(entity.position.x, entity.position.z, worldPhaseRef.current);
          const visualEntitySize = getRelativeVisualSize(entity.size, player.size);
          const float = FLOATING_ENTITY_KINDS.has(entity.kind) ? Math.sin(entity.pulse) * visualEntitySize * 0.18 + visualEntitySize * 0.9 : 0;
          objectRef.current.position.set(entity.position.x, y + float, entity.position.z);
          objectRef.current.rotation.y += (FLOATING_ENTITY_KINDS.has(entity.kind) ? 1.35 : 0.12) * dt;
        }
      }

      let workingEntities = entitiesRef.current;
      let workingScenery = sceneryRef.current;

      if (worldPhaseRef.current >= 4 && rivalsRef.current.length > 0) {
        rivalsRef.current = [];
        rivalsChanged = true;
      }

      if (worldPhaseRef.current < 4) {
        for (const rival of rivalsRef.current) {
          const rivalVisualSize = getVisualSize(rival.size);
          const rivalRadius = Math.max(1.1, rivalVisualSize * 0.88);
          const playerDistance = rival.position.distanceTo(player.position);
          const threat = getRivalThreat(rival.size, player.size);
          const aggression = safeNumber(rival.aggression, 0.9);
          const detectRadius = Math.max(240, rivalVisualSize * (10.2 + aggression * 3.2 + threat * 6));
          let desiredX = 0;
          let desiredZ = 0;
          let hasTarget = false;
          let chaseBoost = 1;

          rival.eatCooldown = Math.max(0, (rival.eatCooldown ?? 0) - dt);
          rival.wanderTimer = Math.max(0, (rival.wanderTimer ?? 0) - dt);

          if (!player.won && playerDistance < detectRadius) {
            const rivalCanEatPlayer = rival.size >= player.size * RIVAL_EAT_PLAYER_RATIO;
            const playerCanEatRival = player.size >= rival.size * PLAYER_EAT_RIVAL_RATIO;
            if (rivalCanEatPlayer) {
              desiredX = player.position.x - rival.position.x;
              desiredZ = player.position.z - rival.position.z;
              hasTarget = true;
              chaseBoost = 1.2 + aggression * 0.18 + clamp(threat, 0, 0.8) * 0.22;
            } else if (playerCanEatRival && playerDistance < detectRadius * 0.72) {
              desiredX = rival.position.x - player.position.x;
              desiredZ = rival.position.z - player.position.z;
              hasTarget = true;
              chaseBoost = 1.08 + aggression * 0.08;
            } else if (playerDistance < detectRadius * 0.42) {
              desiredX = rival.position.x - player.position.x;
              desiredZ = rival.position.z - player.position.z;
              hasTarget = true;
              chaseBoost = 0.82;
            }
          }

          if (!hasTarget) {
            let bestTarget = null;
            let bestScore = Infinity;

            for (const entity of workingEntities) {
              const edible = isEntityEdibleBy(entity, rival.size * 0.92);
              if (!edible) continue;

              const distance = rival.position.distanceTo(entity.position);
              if (distance > detectRadius * 1.25) continue;
              const score = distance / Math.max(0.35, entity.size) + (rival.size > player.size ? playerDistance * 0.08 : 0);
              if (score < bestScore) {
                bestScore = score;
                bestTarget = entity.position;
              }
            }

            if (!bestTarget) {
              for (const object of workingScenery) {
                if (object.size > rival.size * 0.94) continue;

                const distance = Math.hypot(object.x - rival.position.x, object.z - rival.position.z);
                if (distance > detectRadius) continue;
                const score = distance / Math.max(1, object.growth);
                if (score < bestScore) {
                  bestScore = score;
                  bestTarget = { x: object.x, z: object.z };
                }
              }
            }

            if (bestTarget) {
              desiredX = bestTarget.x - rival.position.x;
              desiredZ = bestTarget.z - rival.position.z;
              hasTarget = true;
            }
          }

          if (!hasTarget || Math.hypot(desiredX, desiredZ) < 0.01) {
            if (rival.wanderTimer <= 0) {
              rival.wanderAngle += -0.8 + seeded(state.clock.elapsedTime + rival.variantSeed * 1000) * 1.6;
              rival.wanderTimer = 0.7 + seeded(state.clock.elapsedTime * 3.1 + rival.variantSeed * 97) * 1.6;
            }
            desiredX = Math.sin(rival.wanderAngle);
            desiredZ = Math.cos(rival.wanderAngle);
            chaseBoost = 0.72;
          }

          const desiredLength = Math.hypot(desiredX, desiredZ);
          if (desiredLength > 0.001) {
            desiredX /= desiredLength;
            desiredZ /= desiredLength;
            const oldX = rival.position.x;
            const oldZ = rival.position.z;
            const speed = getRivalMoveSpeed(rival.size, worldPhaseRef.current) * chaseBoost;
            const nextX = clamp(rival.position.x + desiredX * speed * dt, -worldLimit, worldLimit);
            const nextZ = clamp(rival.position.z + desiredZ * speed * dt, -worldLimit, worldLimit);

            if (isLandInPhase(nextX, nextZ, worldPhaseRef.current)) {
              rival.position.x = nextX;
              rival.position.z = nextZ;
              rival.heading = Math.atan2(desiredX, desiredZ);
              rival.walkAmount = Math.min(1, (rival.walkAmount ?? 0) + dt * 4.4);
            } else {
              rival.position.x = oldX;
              rival.position.z = oldZ;
              rival.wanderAngle += Math.PI * 0.72;
              rival.walkAmount = Math.max(0, (rival.walkAmount ?? 0) - dt * 3.2);
            }
          }

          if ((rival.eatCooldown ?? 0) <= 0) {
            const entityIndex = workingEntities.findIndex((entity) => {
              const edible = isEntityEdibleBy(entity, rival.size * 0.92);
              if (!edible) return false;

              const entityRadius = Math.max(0.16, getRelativeVisualSize(entity.size, rival.size) * 0.45);
              return rival.position.distanceTo(entity.position) < rivalRadius + entityRadius;
            });

            if (entityIndex >= 0) {
              if (!entitiesChanged) workingEntities = [...workingEntities];
              const [entity] = workingEntities.splice(entityIndex, 1);
              entitiesChanged = true;
              rivalsChanged = true;
              rival.size = addCappedGrowth(rival.size, getEntityGrowth(entity, rival.size) * 0.82, 0.03, 0.12);
              rival.eaten += 1;
              rival.munchUntil = state.clock.elapsedTime + 0.46;
              rival.eatCooldown = 0.28;
              burstsRef.current.push({
                id: `${rival.id}-${entity.id}-burst-${rival.eaten}`,
                x: entity.position.x,
                z: entity.position.z,
                y: Math.max(1.5, entity.size * 1.2),
                size: entity.size,
                kind: entity.kind,
                createdAt: state.clock.elapsedTime,
              });
            } else {
              const sceneryIndex = workingScenery.findIndex((object) => {
                if (object.size > rival.size * 0.94) return false;

                const distance = Math.hypot(object.x - rival.position.x, object.z - rival.position.z);
                return distance < rivalRadius + object.radius;
              });

              if (sceneryIndex >= 0) {
                if (!sceneryChanged) workingScenery = [...workingScenery];
                const [object] = workingScenery.splice(sceneryIndex, 1);
                sceneryChanged = true;
                rivalsChanged = true;
                rival.size = addCappedGrowth(rival.size, getSceneryGrowth(object, rival.size) * 0.74, 0.026, 0.14);
                rival.eaten += 1;
                rival.munchUntil = state.clock.elapsedTime + 0.5;
                rival.eatCooldown = ['building', 'tower', 'mountain'].includes(object.kind) ? 0.34 : 0.22;
                burstsRef.current.push({
                  id: `${rival.id}-${object.id}-burst-${rival.eaten}`,
                  x: object.x,
                  z: object.z,
                  y: Math.max(2, getVisualSize(object.size) * 1.1),
                  size: object.size,
                  kind: object.kind,
                  createdAt: state.clock.elapsedTime,
                });
              }
            }
          }
        }
      }

      const nextEntities = [];
      for (const entity of workingEntities) {

        const dist = entity.position.distanceTo(player.position);
        const entityRadius = Math.max(0.16, getRelativeVisualSize(entity.size, player.size) * 0.45);
        const edible = isEntityEdibleBy(entity, player.size);
        const collision = dist < playerRadius + entityRadius;
        const canEatEntity = (player.eatCooldown ?? 0) <= 0;

        if (edible && collision && canEatEntity) {
          const growth = getEntityGrowth(entity, player.size);
          if (growthThisFrame + growth > getFrameGrowthLimit(player.size)) {
            nextEntities.push(entity);
            continue;
          }

          player.score = Math.round(safeNumber(player.score, 0) + getEatScore(entity.kind, entity.size, player.size, growth));
          player.size = addGrowth(player.size, growth);
          growthThisFrame += growth;
          player.eaten += 1;
          player.munchUntil = state.clock.elapsedTime + 0.42;
          player.eatCooldown = getPlayerEatCooldown(entity.kind, player.size);
          if (CRITTER_ENTITY_KINDS.has(entity.kind)) player.monkeys += 1;
          else player.bananas += 1;
          burstsRef.current.push({
            id: `${entity.id}-burst-${player.eaten}`,
            x: entity.position.x,
            z: entity.position.z,
            y: Math.max(1.8, entity.size * 1.4),
            size: entity.size,
            kind: entity.kind,
            createdAt: state.clock.elapsedTime,
          });
          ateSomething = true;
          entitiesChanged = true;
        } else {
          nextEntities.push(entity);
        }
      }

      const nextScenery = [];
      for (const object of workingScenery) {
        const dxToObject = object.x - player.position.x;
        const dzToObject = object.z - player.position.z;
        const dist = Math.hypot(dxToObject, dzToObject);
        const edible = object.size <= player.size * 0.95;
        const collision = dist < playerRadius + object.radius;

        const canEatScenery = (player.sceneryEatCooldown ?? 0) <= 0 && (player.eatCooldown ?? 0) <= 0;

        if (edible && collision && canEatScenery && sceneryEatenThisFrame < MAX_SCENERY_EATS_PER_FRAME) {
          const growth = getSceneryGrowth(object, player.size);
          const frameGrowthLimit = getFrameGrowthLimit(player.size);
          if (growthThisFrame + growth > frameGrowthLimit) {
            nextScenery.push(object);
            continue;
          }

          player.score = Math.round(safeNumber(player.score, 0) + getEatScore(object.kind, object.size, player.size, growth));
          player.size = addGrowth(player.size, growth);
          growthThisFrame += growth;
          sceneryEatenThisFrame += 1;
          player.eaten += 1;
          player.objects += 1;
          player.munchUntil = state.clock.elapsedTime + 0.5;
          player.sceneryEatCooldown = getSceneryEatCooldown(object.kind, player.size);
          player.eatCooldown = getPlayerEatCooldown(object.kind, player.size);
          burstsRef.current.push({
            id: `${object.id}-burst-${player.eaten}`,
            x: object.x,
            z: object.z,
            y: Math.max(2, getVisualSize(object.size) * 1.2),
            size: object.size,
            kind: object.kind,
            createdAt: state.clock.elapsedTime,
          });
          ateSomething = true;
          sceneryChanged = true;
        } else {
          nextScenery.push(object);
        }
      }

      if (sceneryChanged) {
        sceneryRef.current = nextScenery;
        setSceneryVersion((value) => value + 1);
      }

      if (!player.won && !playerWasEaten) {
        const nextRivals = [];
        for (const rival of rivalsRef.current) {
          const rivalRadius = Math.max(1.1, getRivalVisualSize(rival.size, player.size) * 0.82);
          const dist = rival.position.distanceTo(player.position);
          const collision = dist < (playerRadius + rivalRadius) * 0.78;
          const playerCanEat = player.size >= rival.size * PLAYER_EAT_RIVAL_RATIO;
          const rivalCanEatPlayer = rival.size >= player.size * RIVAL_EAT_PLAYER_RATIO;
          const canEatRival = (player.eatCooldown ?? 0) <= 0;

          if (collision && playerCanEat && canEatRival) {
            const growth = Math.min(rival.size * 0.28, Math.max(0.45, player.size * 0.055));
            player.score = Math.round(safeNumber(player.score, 0) + getEatScore('rival', rival.size, player.size, growth));
            player.size = addCappedGrowth(player.size, rival.size * 0.28, 0.055, 0.45);
            player.eaten += 1;
            player.objects += 1;
            player.munchUntil = state.clock.elapsedTime + 0.62;
            player.eatCooldown = getPlayerEatCooldown('rival', player.size);
            ateSomething = true;
            rivalsChanged = true;
            burstsRef.current.push({
              id: `${rival.id}-eaten-burst-${player.eaten}`,
              x: rival.position.x,
              z: rival.position.z,
              y: Math.max(2.2, getVisualSize(rival.size) * 1.2),
              size: rival.size,
              kind: 'rival',
              createdAt: state.clock.elapsedTime,
            });
          } else if (collision && rivalCanEatPlayer) {
            player.lost = true;
            playerWasEaten = true;
            rival.size = addCappedGrowth(rival.size, player.size * 0.2, 0.04, 0.4);
            rival.munchUntil = state.clock.elapsedTime + 0.8;
            rivalsChanged = true;
            burstsRef.current.push({
              id: `${rival.id}-player-burst`,
              x: player.position.x,
              z: player.position.z,
              y: Math.max(2.4, getVisualSize(player.size) * 1.3),
              size: player.size,
              kind: 'player',
              createdAt: state.clock.elapsedTime,
            });
            onLose(getPlayerSummary(player));
            publishStats(true);
            nextRivals.push(rival);
            break;
          } else if (collision) {
            const fallbackAngle = rival.variantSeed * Math.PI * 2;
            const awayX = dist > 0.001 ? (rival.position.x - player.position.x) / dist : Math.sin(fallbackAngle);
            const awayZ = dist > 0.001 ? (rival.position.z - player.position.z) / dist : Math.cos(fallbackAngle);
            const pushDistance = Math.max(6, (playerRadius + rivalRadius) * 0.16);
            const nextPosition = constrainToWorld(rival.position.x + awayX * pushDistance, rival.position.z + awayZ * pushDistance, worldPhaseRef.current);
            if (isLandInPhase(nextPosition.x, nextPosition.z, worldPhaseRef.current)) {
              rival.position.x = nextPosition.x;
              rival.position.z = nextPosition.z;
              rival.heading = Math.atan2(awayX, awayZ);
              rival.walkAmount = Math.min(1, (rival.walkAmount ?? 0) + dt * 3.5);
              rivalsChanged = true;
            }
            nextRivals.push(rival);
          } else {
            nextRivals.push(rival);
          }
        }

        if (!playerWasEaten && nextRivals.length !== rivalsRef.current.length) {
          rivalsRef.current = nextRivals;
          rivalsChanged = true;
        }
      }

      if (rivalsChanged) {
        setRivalsVersion((value) => value + 1);
      }

      entitiesRef.current = nextEntities;
      if (ateSomething || entitiesChanged || sceneryChanged || rivalsChanged) {
        refillEntities();
        setEntitiesVersion((value) => value + 1);
        setBurstsVersion((value) => value + 1);
        publishStats(true);
      } else {
        publishStats();
      }

      const activeBursts = burstsRef.current.filter((burst) => state.clock.elapsedTime - burst.createdAt < 0.78);
      if (activeBursts.length !== burstsRef.current.length) {
        burstsRef.current = activeBursts;
        setBurstsVersion((value) => value + 1);
      }
    }

    const visualSize = getVisualSize(player.size);
    const worldLimit = getWorldLimit(worldPhaseRef.current);
    const cameraControls = inputRef.current.camera;
    const zoom = clamp(safeNumber(cameraControls?.zoom, 1), CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    const yaw = safeNumber(cameraControls?.yaw, 0);
    const pitchOffset = clamp(safeNumber(cameraControls?.pitch, 0), CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
    const baseHeight = Math.max(22, visualSize * 6.2);
    const baseDistance = Math.max(38, visualSize * 9);
    const orbitDistance = Math.hypot(baseHeight, baseDistance) * zoom;
    const pitch = clamp(Math.atan2(baseHeight, baseDistance) + pitchOffset, 0.18, 1.18);
    const horizontalDistance = Math.cos(pitch) * orbitDistance;
    const verticalDistance = Math.sin(pitch) * orbitDistance;
    const playerGround = getGroundHeight(player.position.x, player.position.z, worldPhaseRef.current);
    targetVector.set(player.position.x, playerGround + visualSize * 1.25, player.position.z);
    cameraOffset.set(Math.sin(yaw) * horizontalDistance, verticalDistance, Math.cos(yaw) * horizontalDistance);
    camera.position.lerp(targetVector.clone().add(cameraOffset), 1 - Math.exp(-dt * 2.8));
    camera.lookAt(targetVector);
    camera.near = clamp(visualSize * 0.018, 0.1, 500);
    camera.far = Math.min(260000, Math.max(7200, worldLimit * 4 + visualSize * 80));
    camera.updateProjectionMatrix();

    if (import.meta.env.DEV) {
      window.__MONKEY_GAME_DEBUG__ = {
        x: player.position.x,
        z: player.position.z,
        size: player.size,
        speed: getMoveSpeed(player.size, worldPhaseRef.current),
        worldPhase: getPhaseLabel(worldPhaseRef.current),
        groundMode: worldPhaseRef.current >= 4 ? 'globe' : 'terrain',
        groundY: playerGround,
        sceneryCount: sceneryRef.current.length,
        entityCount: entitiesRef.current.length,
        targetEntityCount: getTargetEntityCount(inputRef.current.spawnMultiplier),
        spawnMultiplier: getSpawnMultiplier(inputRef.current.spawnMultiplier),
        rivals: rivalsRef.current.length,
        largestRivalSize: rivalsRef.current.reduce((largest, rival) => Math.max(largest, rival.size), 0),
        lost: player.lost,
        cameraZoom: zoom,
        cameraYaw: yaw,
        cameraPitch: pitchOffset,
      };
    }
  });

  const entities = entitiesRef.current;
  const scenery = sceneryRef.current;
  const rivals = rivalsRef.current;
  const bursts = burstsRef.current;
  void entitiesVersion;
  void sceneryVersion;
  void rivalsVersion;
  void burstsVersion;

  return (
    <>
      <SkyDome />
      <SceneLighting />
      <WorldTiles phase={worldPhase} won={gameWon} />
      {worldPhase < 4 && <Trees scenery={scenery} />}
      {worldPhase < 4 && <Houses scenery={scenery} />}
      {worldPhase < 4 && <CityObjects scenery={scenery} />}
      {worldPhase < 4 && <Mountains scenery={scenery} />}
      {worldPhase >= 4 && <GlobeScenery scenery={scenery} />}
      {entities.map((entity) => (
        <FloatingEntity key={entity.id} entity={entity} registerEntityRef={registerEntityRef} playerSize={playerRef.current.size} worldPhase={worldPhase} />
      ))}
      {worldPhase < 4 && rivals.map((rival) => <RivalRex key={rival.id} rival={rival} playerSize={playerRef.current.size} worldPhase={worldPhase} />)}
      {bursts.map((burst) => (
        <EatBurst key={burst.id} burst={burst} worldPhase={worldPhase} />
      ))}
      <Player playerRef={playerRef} worldPhase={worldPhase} />
    </>
  );
}

function LeaderboardTable({ entries, compact = false }) {
  if (entries.length === 0) {
    return <p className="leaderboard-empty">No finished runs yet</p>;
  }

  return (
    <table className={`leaderboard-table${compact ? ' compact' : ''}`}>
      <thead>
        <tr>
          <th>#</th>
          <th>Name</th>
          <th>Points</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr key={entry.id ?? `${entry.name}-${entry.completedAt}-${index}`}>
            <td>{index + 1}</td>
            <td>{entry.name}</td>
            <td>{formatScore(entry.points)}</td>
            <td>{formatDuration(entry.durationSeconds)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LeaderboardPanel({ entries }) {
  return (
    <aside className="leaderboard-panel" aria-label="Top scores">
      <div className="leaderboard-title">
        <Trophy size={16} />
        <strong>Top Scores</strong>
      </div>
      <LeaderboardTable entries={entries.slice(0, 5)} compact />
    </aside>
  );
}

function RunSummary({ result }) {
  if (!result) return null;

  return (
    <div className="run-summary">
      <div>
        <span>Points</span>
        <strong>{formatScore(result.points)}</strong>
      </div>
      <div>
        <span>Time</span>
        <strong>{formatDuration(result.durationSeconds)}</strong>
      </div>
      <div>
        <span>Eaten</span>
        <strong>{result.eaten}</strong>
      </div>
    </div>
  );
}

function WinPanel({ result, playerName, scoreSaved, leaderboard, onNameChange, onSaveScore, onRestart }) {
  const cleanName = sanitizePlayerName(playerName);

  return (
    <div className="end-panel win-panel" role="dialog" aria-modal="true" aria-labelledby="win-title">
      <strong id="win-title">YOU WON</strong>
      <span>Globe consumed</span>
      <RunSummary result={result} />

      {!scoreSaved ? (
        <form className="score-form" onSubmit={onSaveScore}>
          <label htmlFor="player-name">Name</label>
          <div className="score-form-row">
            <input
              id="player-name"
              type="text"
              value={playerName}
              maxLength={MAX_PLAYER_NAME_LENGTH}
              autoComplete="off"
              autoFocus
              onChange={(event) => onNameChange(event.target.value)}
            />
            <button className="primary-button" type="submit" disabled={!cleanName}>
              <Save size={16} />
              Save
            </button>
          </div>
        </form>
      ) : (
        <button className="primary-button restart-button" type="button" onClick={onRestart}>
          <RotateCcw size={16} />
          Play Again
        </button>
      )}

      <div className="end-leaderboard">
        <div className="leaderboard-title">
          <Trophy size={16} />
          <strong>Top Scores</strong>
        </div>
        <LeaderboardTable entries={leaderboard.slice(0, 5)} compact />
      </div>
    </div>
  );
}

function LosePanel({ result, onRestart }) {
  return (
    <div className="end-panel danger" role="dialog" aria-modal="true" aria-labelledby="lose-title">
      <strong id="lose-title">YOU WERE EATEN</strong>
      <span>A larger rival T-Rex got you</span>
      <RunSummary result={result} />
      <button className="primary-button restart-button" type="button" onClick={onRestart}>
        <RotateCcw size={16} />
        Restart
      </button>
    </div>
  );
}

function VersionBadge() {
  const commitRef = APP_VERSION.commitRef || 'unknown';
  const commitTime = formatVersionTime(APP_VERSION.commitDate || APP_VERSION.buildTime);
  const buildTime = formatVersionTime(APP_VERSION.buildTime);

  return (
    <div className="version-chip" title={`Commit ${commitRef}${commitTime ? `\nCommit time ${commitTime}` : ''}${buildTime ? `\nBuilt ${buildTime}` : ''}`} aria-label={`Version ${commitRef}`}>
      <span>Version</span>
      <strong>{commitRef}</strong>
      {commitTime && <time dateTime={APP_VERSION.commitDate || APP_VERSION.buildTime}>{commitTime}</time>}
    </div>
  );
}

function App() {
  const initialStartSizeRef = useRef(getRequestedStartSize());
  const inputRef = useRef({
    keyboard: new THREE.Vector2(),
    touch: new THREE.Vector2(),
    spawnMultiplier: DEFAULT_SPAWN_MULTIPLIER,
    spawnCheatChangedAt: 0,
    camera: {
      zoom: 1,
      yaw: 0,
      pitch: 0,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0,
    },
  });
  const [stats, setStats] = useState({
    sizeLabel: '1.00x',
    strength: '12',
    score: '0',
    time: '0:00',
    bananas: 0,
    monkeys: 0,
    objects: 0,
    rivals: 3,
    spawnDensity: `${DEFAULT_SPAWN_MULTIPLIER}x`,
    world: 'Country',
  });
  const [paused, setPaused] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [gameLost, setGameLost] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState(() => loadLeaderboard());
  const [playerName, setPlayerName] = useState(() => loadLastPlayerName());
  const [scoreSaved, setScoreSaved] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const pausedRef = useRef(false);

  useKeyboardInput(inputRef);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const togglePause = () => {
    setPaused((value) => !value);
  };

  const reset = () => {
    inputRef.current.keyboard.set(0, 0);
    inputRef.current.touch.set(0, 0);
    inputRef.current.spawnMultiplier = DEFAULT_SPAWN_MULTIPLIER;
    inputRef.current.spawnCheatChangedAt = 0;
    Object.assign(inputRef.current.camera, {
      zoom: 1,
      yaw: 0,
      pitch: 0,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0,
    });
    setPaused(false);
    setGameWon(false);
    setGameLost(false);
    setRunResult(null);
    setScoreSaved(false);
    pausedRef.current = false;
    setResetToken((value) => value + 1);
  };

  const handleWin = (result) => {
    setRunResult(result);
    setGameWon(true);
    setGameLost(false);
    setPaused(true);
    pausedRef.current = true;
  };

  const handleLose = (result) => {
    setRunResult(result);
    setGameLost(true);
    setGameWon(false);
    setPaused(true);
    pausedRef.current = true;
  };

  const handlePlayerNameChange = (value) => {
    setPlayerName(value.slice(0, MAX_PLAYER_NAME_LENGTH));
  };

  const saveScore = (event) => {
    event.preventDefault();
    if (!runResult) return;

    const cleanName = sanitizePlayerName(playerName);
    if (!cleanName) return;

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: cleanName,
      points: Math.round(runResult.points),
      durationSeconds: runResult.durationSeconds,
      completedAt: new Date().toISOString(),
    };
    const nextLeaderboard = rankLeaderboard([...leaderboard, entry]);
    saveLeaderboard(nextLeaderboard);
    saveLastPlayerName(cleanName);
    setPlayerName(cleanName);
    setLeaderboard(nextLeaderboard);
    setScoreSaved(true);
  };

  const onWheel = (event) => {
    const controls = inputRef.current.camera;
    controls.zoom = clamp(controls.zoom + event.deltaY * 0.0011, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
  };

  const onPointerDown = (event) => {
    if (event.button !== 2) return;
    event.preventDefault();
    const controls = inputRef.current.camera;
    controls.dragging = true;
    controls.pointerId = event.pointerId;
    controls.lastX = event.clientX;
    controls.lastY = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const controls = inputRef.current.camera;
    if (!controls.dragging || controls.pointerId !== event.pointerId) return;

    const dx = event.clientX - controls.lastX;
    const dy = event.clientY - controls.lastY;
    controls.lastX = event.clientX;
    controls.lastY = event.clientY;
    controls.yaw -= dx * 0.0052;
    controls.pitch = clamp(controls.pitch + dy * 0.0044, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
  };

  const endCameraDrag = (event) => {
    const controls = inputRef.current.camera;
    if (controls.pointerId !== event.pointerId) return;

    controls.dragging = false;
    controls.pointerId = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <main
      className="game-shell"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endCameraDrag}
      onPointerCancel={endCameraDrag}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Canvas
        shadows
        camera={{ position: [0, 28, 46], fov: 46, near: 0.1, far: 6000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        dpr={[1, 1.8]}
      >
        <GameScene
          inputRef={inputRef}
          pausedRef={pausedRef}
          resetToken={resetToken}
          startSize={resetToken === 0 ? initialStartSizeRef.current : START_SIZE}
          onStats={setStats}
          onWin={handleWin}
          onLose={handleLose}
          gameWon={gameWon}
          gameLost={gameLost}
        />
      </Canvas>
      <HUD stats={stats} isPaused={paused} onPauseToggle={togglePause} onReset={reset} />
      <LeaderboardPanel entries={leaderboard} />
      <VersionBadge />
      <TouchJoystick inputRef={inputRef} />
      {paused && <div className="pause-scrim" aria-hidden="true" />}
      {gameWon && (
        <WinPanel
          result={runResult}
          playerName={playerName}
          scoreSaved={scoreSaved}
          leaderboard={leaderboard}
          onNameChange={handlePlayerNameChange}
          onSaveScore={saveScore}
          onRestart={reset}
        />
      )}
      {gameLost && (
        <LosePanel result={runResult} onRestart={reset} />
      )}
    </main>
  );
}

export default App;
