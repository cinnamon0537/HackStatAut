import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const server = spawn('node', ['server.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});

server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function waitForServer(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await delay(250);
  }
  throw new Error('Server did not become ready in time');
}

await waitForServer('http://127.0.0.1:3000/api/health');
await mkdir('tmp', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'tmp/hackstataut.png', fullPage: true });
console.log('Screenshot saved to tmp/hackstataut.png');

await browser.close();
server.kill('SIGTERM');
