import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values: { scenario = 'auto' } } = parseArgs({
  options: { scenario: { type: 'string' } }
});
if (!['auto', 'cat', 'cluster', 'empty'].includes(scenario)) throw new Error('Unknown encounter');

const html = await readFile('build/site/index.html');
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const raw = await mkdtemp(join(tmpdir(), 'havi-grid-'));
const encoder = process.env.FFMPEG || 'ffmpeg';

async function ffmpeg(args) {
  const child = spawn(encoder, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  const [status] = await once(child, 'close');
  if (status !== 0) throw new Error('FFmpeg failed to encode the contribution GIF');
}

async function capture() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/?capture=1`);
    await page.waitForFunction(() => Boolean(window.gridCapture));
    const info = await page.evaluate(scene => window.gridCapture.start(scene), scenario);
    const fps = info.duration > 135 ? 20 : 24;
    const total = Math.ceil(info.duration * fps);
    for (let index = 0; index < total; index += 32) {
      const frames = await page.evaluate(({ index, fps, count }) =>
        Array.from({ length: count }, (_, i) =>
          window.gridCapture.frame((index + i) / fps)), { index, fps, count: Math.min(32, total - index) });
      await Promise.all(frames.map((frame, i) =>
        writeFile(join(raw, frameName(index + i)), Buffer.from(frame, 'base64'))
      ));
    }
    console.log(`${info.encounter} encounter, ${info.cells} cells, ${total} frames at ${fps} FPS`);
    return fps;
  } finally {
    await browser.close();
  }
}

function frameName(index) {
  return `${String(index).padStart(6, '0')}.png`;
}

try {
  const fps = await capture();
  const input = ['-framerate', String(fps), '-i', join(raw, '%06d.png')];
  const palette = join(raw, 'palette.png');
  const gif = join(raw, 'contribution-grid.gif');
  let acceptable = false;
  for (const width of [864, 640, 432]) {
    const scale = `scale=${width}:-1:flags=neighbor`;
    await ffmpeg([...input, '-vf', `fps=3,${scale},palettegen=stats_mode=diff`, '-frames:v', '1', '-update', '1', palette]);
    await ffmpeg([...input, '-i', palette, '-lavfi', `[0:v]${scale}[frame];[frame][1:v]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0', gif]);
    if ((await stat(gif)).size < 48 * 1024 * 1024) {
      acceptable = true;
      break;
    }
  }
  if (!acceptable) throw new Error('The GIF exceeded the repository size limit for this project');
  await mkdir('output', { recursive: true });
  await writeFile('output/.contribution-grid.gif', await readFile(gif));
  await rename('output/.contribution-grid.gif', 'output/contribution-grid.gif');
} finally {
  server.close();
  await rm(raw, { recursive: true, force: true });
}
