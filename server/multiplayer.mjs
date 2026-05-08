const MULTIPLAYER_API_PREFIX = '/api/multiplayer';
const START_SIZE = 0.35;
const MAX_LOGICAL_SIZE = 1e24;
const MIN_LOGICAL_SIZE = 0.04;
const MAX_VISUAL_SIZE = 820;
const MAX_WORLD_PHASE = 4;
const PLAYER_EAT_PLAYER_RATIO = 1.08;
const MAX_PLAYER_NAME_LENGTH = 14;
const REQUEST_SIZE_LIMIT = 16 * 1024;
const PLAYER_TTL_MS = 12_000;
const EAT_GRACE_MS = 2_000;
const SNAPSHOT_BROADCAST_DELAY_MS = 70;

const WORLD_PHASES = [
  { label: 'Country', minSize: START_SIZE },
  { label: 'Town', minSize: 4 },
  { label: 'City', minSize: 24 },
  { label: 'Mountains', minSize: 110 },
  { label: 'Globe', minSize: 320 },
];

const players = new Map();
const eventStreams = new Set();
let broadcastTimer = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const safeFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const safeString = (value, fallback = '') => String(value ?? fallback);

const sanitizeId = (value) => safeString(value).replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 96);

const sanitizeName = (value) => {
  const name = safeString(value, 'Player').trim().replace(/\s+/g, ' ').slice(0, MAX_PLAYER_NAME_LENGTH);
  return name || 'Player';
};

const getWorldPhase = (size) => {
  const safeSize = Math.max(MIN_LOGICAL_SIZE, safeFiniteNumber(size, START_SIZE));
  let phase = 0;
  for (let index = 0; index < WORLD_PHASES.length; index += 1) {
    if (safeSize >= WORLD_PHASES[index].minSize) phase = index;
  }
  return clamp(phase, 0, MAX_WORLD_PHASE);
};

const getVisualSize = (size) => {
  const safeSize = Math.max(MIN_LOGICAL_SIZE, safeFiniteNumber(size, START_SIZE));
  if (safeSize <= 60) return safeSize;
  return Math.min(MAX_VISUAL_SIZE, 60 + Math.sqrt(safeSize - 60) * 9.5);
};

const addGrowth = (size, amount) => clamp(safeFiniteNumber(size, START_SIZE) + Math.max(0, safeFiniteNumber(amount, 0)), START_SIZE, MAX_LOGICAL_SIZE);

const addCappedGrowth = (size, amount, ratio = 0.055, minimum = 0.45) => {
  const safeSize = Math.max(START_SIZE, safeFiniteNumber(size, START_SIZE));
  return addGrowth(safeSize, Math.min(Math.max(0, safeFiniteNumber(amount, 0)), Math.max(minimum, safeSize * ratio)));
};

const serializePlayer = (player) => ({
  id: player.id,
  name: player.name,
  x: player.x,
  z: player.z,
  size: player.size,
  phase: player.phase,
  heading: player.heading,
  walkAmount: player.walkAmount,
  munching: player.munching,
  lost: player.lost,
  won: player.won,
  score: player.score,
  tone: player.tone,
  spawnToken: player.spawnToken,
  updatedAt: player.updatedAt,
});

const cleanupPlayers = () => {
  const now = Date.now();
  for (const [id, player] of players) {
    if (now - player.updatedAt > PLAYER_TTL_MS) {
      players.delete(id);
    }
  }
};

const getSnapshot = () => {
  cleanupPlayers();
  return {
    players: [...players.values()].map(serializePlayer),
    serverTime: Date.now(),
  };
};

const sendJson = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(payload));
};

const sendEvent = (stream, event, payload) => {
  try {
    stream.response.write(`event: ${event}\n`);
    stream.response.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    eventStreams.delete(stream);
  }
};

const broadcast = (event, payload) => {
  if (eventStreams.size === 0) return;
  for (const stream of eventStreams) {
    sendEvent(stream, event, payload);
  }
};

const broadcastSnapshot = () => {
  broadcast('snapshot', getSnapshot());
};

const scheduleSnapshotBroadcast = () => {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastSnapshot();
  }, SNAPSHOT_BROADCAST_DELAY_MS);
};

const readRequestJson = async (request) =>
  new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > REQUEST_SIZE_LIMIT) {
        tooLarge = true;
        const error = new Error('Request body is too large.');
        error.statusCode = 413;
        reject(error);
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error('Request body must be valid JSON.');
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on('error', reject);
  });

const upsertPlayer = (body) => {
  const id = sanitizeId(body.id);
  if (!id) {
    const error = new Error('Player id is required.');
    error.statusCode = 400;
    throw error;
  }

  const now = Date.now();
  const existing = players.get(id);
  const spawnToken = sanitizeId(body.spawnToken) || 'default';
  const size = clamp(safeFiniteNumber(body.size, START_SIZE), START_SIZE, MAX_LOGICAL_SIZE);
  const clientLost = Boolean(body.lost);
  const lockedByRecentEat = existing?.lost && existing?.eatenBy && existing.spawnToken === spawnToken && now - existing.eatenAt < EAT_GRACE_MS;
  const lost = lockedByRecentEat ? true : clientLost;

  const player = {
    id,
    name: sanitizeName(body.name),
    x: safeFiniteNumber(body.x, existing?.x ?? 0),
    z: safeFiniteNumber(body.z, existing?.z ?? 0),
    size,
    phase: getWorldPhase(size),
    heading: safeFiniteNumber(body.heading, existing?.heading ?? 0),
    walkAmount: clamp(safeFiniteNumber(body.walkAmount, existing?.walkAmount ?? 0), 0, 1),
    munching: Boolean(body.munching),
    lost,
    won: Boolean(body.won),
    score: Math.max(0, Math.round(safeFiniteNumber(body.score, existing?.score ?? 0))),
    tone: clamp(safeFiniteNumber(body.tone, existing?.tone ?? Math.random()), 0, 1),
    spawnToken,
    updatedAt: now,
    joinedAt: existing?.joinedAt ?? now,
    eatenBy: lost ? existing?.eatenBy ?? null : null,
    eatenAt: lost ? existing?.eatenAt ?? 0 : 0,
  };

  players.set(id, player);
  scheduleSnapshotBroadcast();
  return player;
};

const resolveEat = (body) => {
  const eaterId = sanitizeId(body.eaterId);
  const targetId = sanitizeId(body.targetId);
  if (!eaterId || !targetId || eaterId === targetId) {
    const error = new Error('Valid eater and target ids are required.');
    error.statusCode = 400;
    throw error;
  }

  cleanupPlayers();
  const eater = players.get(eaterId);
  const target = players.get(targetId);
  if (!eater || !target || eater.lost || target.lost || eater.won || target.won) {
    const error = new Error('Player is no longer available.');
    error.statusCode = 409;
    throw error;
  }

  if (eater.phase !== target.phase) {
    const error = new Error('Players are not in the same phase.');
    error.statusCode = 409;
    throw error;
  }

  if (eater.size < target.size * PLAYER_EAT_PLAYER_RATIO) {
    const error = new Error('Target is too large to eat.');
    error.statusCode = 409;
    throw error;
  }

  const eaterRadius = Math.max(0.55, getVisualSize(eater.size) * 0.68);
  const targetRadius = Math.max(0.55, getVisualSize(target.size) * 0.68);
  const distance = Math.hypot(eater.x - target.x, eater.z - target.z);
  const allowedDistance = Math.max((eaterRadius + targetRadius) * 1.28, eaterRadius + targetRadius + 18);
  if (distance > allowedDistance) {
    const error = new Error('Players are too far apart.');
    error.statusCode = 409;
    throw error;
  }

  const now = Date.now();
  const targetSize = target.size;
  const growth = Math.min(targetSize * 0.28, Math.max(0.45, eater.size * 0.055));
  eater.size = addCappedGrowth(eater.size, targetSize * 0.28, 0.055, 0.45);
  eater.phase = getWorldPhase(eater.size);
  eater.munching = true;
  eater.updatedAt = now;
  target.lost = true;
  target.eatenBy = eater.id;
  target.eatenAt = now;
  target.updatedAt = now;

  const result = {
    eaterId: eater.id,
    eaterName: eater.name,
    targetId: target.id,
    targetName: target.name,
    phase: target.phase,
    targetSize,
    growth,
    eaterSize: eater.size,
    targetSpawnToken: target.spawnToken,
    eatenAt: now,
  };

  broadcast('eaten', result);
  scheduleSnapshotBroadcast();
  return result;
};

const handleEventStream = (request, response) => {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  response.flushHeaders?.();
  response.write(': connected\n\n');

  const stream = { response };
  eventStreams.add(stream);
  sendEvent(stream, 'snapshot', getSnapshot());

  const keepAlive = setInterval(() => {
    try {
      response.write(': keep-alive\n\n');
    } catch {
      clearInterval(keepAlive);
      eventStreams.delete(stream);
    }
  }, 15_000);

  request.on('close', () => {
    clearInterval(keepAlive);
    eventStreams.delete(stream);
  });
};

export const handleMultiplayerApi = async (request, response) => {
  const url = new URL(request.originalUrl || request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith(MULTIPLAYER_API_PREFIX)) return false;

  try {
    if (request.method === 'OPTIONS') {
      response.setHeader('allow', 'GET, POST, OPTIONS');
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (request.method === 'GET' && url.pathname === `${MULTIPLAYER_API_PREFIX}/events`) {
      handleEventStream(request, response);
      return true;
    }

    if (request.method === 'GET' && url.pathname === `${MULTIPLAYER_API_PREFIX}/snapshot`) {
      sendJson(response, 200, getSnapshot());
      return true;
    }

    if (request.method === 'POST' && url.pathname === `${MULTIPLAYER_API_PREFIX}/state`) {
      const player = upsertPlayer(await readRequestJson(request));
      sendJson(response, 200, { ok: true, player: serializePlayer(player) });
      return true;
    }

    if (request.method === 'POST' && url.pathname === `${MULTIPLAYER_API_PREFIX}/eat`) {
      const result = resolveEat(await readRequestJson(request));
      sendJson(response, 200, { ok: true, result });
      return true;
    }

    if (request.method === 'POST' && url.pathname === `${MULTIPLAYER_API_PREFIX}/leave`) {
      const body = await readRequestJson(request);
      const id = sanitizeId(body.id);
      if (id) {
        players.delete(id);
        scheduleSnapshotBroadcast();
      }
      sendJson(response, 200, { ok: true });
      return true;
    }

    response.setHeader('allow', 'GET, POST, OPTIONS');
    sendJson(response, 404, { error: 'Multiplayer endpoint not found.' });
    return true;
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.statusCode ? error.message : 'Multiplayer service failed.',
    });
    return true;
  }
};
