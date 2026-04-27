import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.GAME_URL ?? 'http://localhost:5173/';
const artifactDir = new URL('../artifacts/', import.meta.url);

const scenarios = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, expectStarterSnack: true, expectRivals: true, expectCameraControls: true },
  { name: 'mobile', width: 390, height: 844, isMobile: true, expectStarterSnack: true, expectRivals: true },
  { name: 'mountain-speed', width: 1440, height: 900, isMobile: false, startSize: '130', expectStarterSnack: false, expectWorld: 'Mountains', expectObjects: true, expectRivals: true, minDistance: 250, maxSize: 180 },
  { name: 'globe-surface', width: 1440, height: 900, isMobile: false, startSize: '340', expectStarterSnack: false, expectWorld: 'Globe', expectGlobeSurface: true, expectGlobeScenery: true, maxSize: 390 },
  { name: 'globe-finale', width: 1440, height: 900, isMobile: false, startSize: '950', expectStarterSnack: false, expectWorld: 'Globe', expectEndPanel: true },
];

await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch();
const failures = [];

for (const viewport of scenarios) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.isMobile ? 2 : 1,
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const url = viewport.startSize ? `${baseUrl}?startSize=${viewport.startSize}` : baseUrl;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(1250);
  const debugBefore = await page.evaluate(() => window.__MONKEY_GAME_DEBUG__ ?? null);

  await page.locator('canvas').click({ position: { x: Math.floor(viewport.width / 2), y: Math.floor(viewport.height / 2) } });
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1650);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(200);
  const debugAfter = await page.evaluate(() => window.__MONKEY_GAME_DEBUG__ ?? null);

  let debugAfterCamera = debugAfter;
  if (viewport.expectCameraControls) {
    await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
    await page.mouse.wheel(0, -520);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(Math.floor(viewport.width / 2) + 180, Math.floor(viewport.height / 2) + 90, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(350);
    debugAfterCamera = await page.evaluate(() => window.__MONKEY_GAME_DEBUG__ ?? null);
  }

  const hudStats = await page.locator('.stat-panel div').evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.map((node) => {
        const label = node.querySelector('span')?.textContent?.trim() ?? '';
        const value = node.querySelector('strong')?.textContent?.trim() ?? '';
        return [label, value];
      }),
    ),
  );
  const hudValues = Object.values(hudStats);
  const versionRef = await page.locator('.version-chip strong').textContent().catch(() => '');
  const bananas = Number(hudStats.Snacks ?? hudStats.Bananas ?? 0);
  const monkeys = Number(hudStats.Critters ?? hudStats.Monkeys ?? 0);
  const objects = Number(hudStats.Objects ?? 0);
  const rivals = Number(hudStats.Rivals ?? 0);
  const world = hudStats.World ?? '';

  const canvasStats = await page.locator('canvas').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return { ok: false, reason: 'No WebGL context' };

    const points = [];
    for (let x = 0.18; x <= 0.82; x += 0.16) {
      for (let y = 0.18; y <= 0.82; y += 0.16) {
        points.push([Math.floor(canvas.width * x), Math.floor(canvas.height * y)]);
      }
    }

    const pixel = new Uint8Array(4);
    const colors = [];
    let nonBlank = 0;
    let alphaPixels = 0;

    for (const [x, y] of points) {
      gl.readPixels(x, canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const [r, g, b, a] = pixel;
      if (a > 0) alphaPixels += 1;
      if (a > 0 && r + g + b > 12) nonBlank += 1;
      colors.push(`${r},${g},${b},${a}`);
    }

    return {
      ok: nonBlank >= Math.floor(points.length * 0.72) && new Set(colors).size >= 2,
      width: canvas.width,
      height: canvas.height,
      nonBlank,
      alphaPixels,
      sampleCount: points.length,
      uniqueColors: new Set(colors).size,
    };
  });

  const screenshotPath = fileURLToPath(new URL(`${viewport.name}.png`, artifactDir));
  await page.screenshot({ path: screenshotPath, fullPage: true });

  if (!canvasStats.ok) {
    failures.push(`${viewport.name}: blank or low-variance canvas ${JSON.stringify(canvasStats)}`);
  }
  if (consoleErrors.length > 0) {
    failures.push(`${viewport.name}: console errors ${consoleErrors.join(' | ')}`);
  }
  if (pageErrors.length > 0) {
    failures.push(`${viewport.name}: page errors ${pageErrors.join(' | ')}`);
  }
  if (viewport.expectStarterSnack && bananas + monkeys < 1) {
    failures.push(`${viewport.name}: movement did not collect a starter target; HUD values ${hudValues.join(', ')}`);
  }
  if (viewport.expectWorld && world !== viewport.expectWorld) {
    failures.push(`${viewport.name}: expected ${viewport.expectWorld} world phase, got ${world}`);
  }
  if (viewport.expectObjects && objects < 1) {
    failures.push(`${viewport.name}: giant player did not eat any scenery objects; HUD values ${hudValues.join(', ')}`);
  }
  if (viewport.expectRivals && rivals < 1) {
    failures.push(`${viewport.name}: expected active rival T-Rex enemies; HUD values ${hudValues.join(', ')}`);
  }
  if (viewport.expectGlobeSurface && debugAfter?.groundMode !== 'globe') {
    failures.push(`${viewport.name}: expected player to use globe surface height, got ${JSON.stringify(debugAfter)}`);
  }
  if (viewport.expectGlobeScenery && debugAfter?.sceneryCount < 1) {
    failures.push(`${viewport.name}: expected globe scenery to render, got scenery count ${debugAfter?.sceneryCount}`);
  }
  if (viewport.minDistance && debugBefore && debugAfter) {
    const distance = Math.hypot(debugAfter.x - debugBefore.x, debugAfter.z - debugBefore.z);
    if (distance < viewport.minDistance) {
      failures.push(`${viewport.name}: giant player moved too slowly; only moved ${distance.toFixed(1)} world units`);
    }
  }
  if (viewport.maxSize && debugAfter?.size > viewport.maxSize) {
    failures.push(`${viewport.name}: growth jumped too far; size ${debugAfter.size.toFixed(2)} exceeded ${viewport.maxSize}`);
  }
  if (!viewport.expectEndPanel && debugAfter?.lost) {
    failures.push(`${viewport.name}: player was eaten during baseline verification by a rival that should not catch them immediately`);
  }
  if (viewport.expectCameraControls && debugBefore && debugAfterCamera) {
    const zoomChanged = Math.abs((debugAfterCamera.cameraZoom ?? 1) - (debugBefore.cameraZoom ?? 1)) > 0.08;
    const yawChanged = Math.abs((debugAfterCamera.cameraYaw ?? 0) - (debugBefore.cameraYaw ?? 0)) > 0.3;
    const pitchChanged = Math.abs((debugAfterCamera.cameraPitch ?? 0) - (debugBefore.cameraPitch ?? 0)) > 0.12;
    if (!zoomChanged || !yawChanged || !pitchChanged) {
      failures.push(
        `${viewport.name}: camera controls did not update enough; before ${JSON.stringify(debugBefore)}, after ${JSON.stringify(debugAfterCamera)}`,
      );
    }
  }
  if (viewport.expectEndPanel && !(await page.locator('.end-panel').isVisible())) {
    failures.push(`${viewport.name}: expected finale panel to be visible`);
  }
  if (hudValues.some((value) => value.length > 12)) {
    failures.push(`${viewport.name}: HUD value is too long after compact formatting: ${hudValues.join(', ')}`);
  }
  if (!/^[0-9a-f]{7,}$/i.test(versionRef ?? '')) {
    failures.push(`${viewport.name}: version chip did not expose a commit ref; text was "${versionRef ?? ''}"`);
  }

  console.log(
      `${viewport.name}: ${canvasStats.width}x${canvasStats.height}, ` +
      `${canvasStats.nonBlank}/${canvasStats.sampleCount} nonblank, ${canvasStats.uniqueColors} sampled colors, ` +
      `${bananas} bananas, ${monkeys} monkeys, ${objects} objects, ${rivals} rivals, ${world}`,
  );

  await context.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
