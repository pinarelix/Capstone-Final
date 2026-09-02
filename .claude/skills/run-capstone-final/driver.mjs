// Headless-Chromium REPL driver for the Barangay 179 Crime BI web app.
// Mirrors the chromium-cli command vocabulary (nav/wait-for/click/fill/
// press/screenshot/console/eval/quit) since chromium-cli itself is not
// available in this environment. Pipe a script to stdin, one command
// per line. Screenshots land in ./screenshots/<name>.png.
import { chromium } from 'playwright';
import readline from 'node:readline';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCREEN_DIR = join(process.cwd(), 'screenshots');
mkdirSync(SCREEN_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();

const consoleLog = [];
page.on('console', (msg) => consoleLog.push({ type: msg.type(), text: msg.text() }));
page.on('pageerror', (err) => consoleLog.push({ type: 'pageerror', text: String(err) }));

function parseTarget(sel) {
  // "text=Foo" -> getByText locator, otherwise treat as a CSS selector.
  if (sel.startsWith('text=')) return page.getByText(sel.slice(5), { exact: false });
  return page.locator(sel);
}

async function run(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case 'nav': {
      await page.goto(rest[0], { waitUntil: 'load' });
      console.log(`nav -> ${page.url()}`);
      break;
    }
    case 'wait-for': {
      await parseTarget(rest[0]).first().waitFor({ timeout: 15000 });
      console.log(`wait-for ${rest[0]} -> ok`);
      break;
    }
    case 'click': {
      await parseTarget(arg).first().click();
      console.log(`click ${arg} -> ok`);
      break;
    }
    case 'fill': {
      const [sel, ...valueParts] = rest;
      await page.fill(sel, valueParts.join(' '));
      console.log(`fill ${sel} -> ok`);
      break;
    }
    case 'press': {
      await page.keyboard.press(rest[0]);
      console.log(`press ${rest[0]} -> ok`);
      break;
    }
    case 'screenshot': {
      const name = rest[0] || `shot-${Date.now()}`;
      const file = join(SCREEN_DIR, name.endsWith('.png') ? name : `${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`screenshot -> ${file}`);
      break;
    }
    case 'eval': {
      const result = await page.evaluate((code) => eval(code), arg);
      console.log(`eval -> ${JSON.stringify(result)}`);
      break;
    }
    case 'console': {
      const errorsOnly = rest.includes('--errors');
      const rows = errorsOnly
        ? consoleLog.filter((r) => r.type === 'error' || r.type === 'pageerror')
        : consoleLog;
      console.log(JSON.stringify(rows, null, 2));
      break;
    }
    case 'sleep': {
      await new Promise((r) => setTimeout(r, Number(rest[0] || 1000)));
      break;
    }
    case 'quit': {
      await browser.close();
      process.exit(0);
      break;
    }
    default:
      console.log(`unknown command: ${cmd}`);
  }
}

// Lines can arrive faster than `run()` resolves (e.g. a piped heredoc),
// so chain them into one queue instead of racing concurrent commands.
let queue = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  queue = queue.then(() => run(line)).catch((err) => console.log(`error: ${err.message}`));
});
rl.on('close', async () => {
  await queue;
  await browser.close();
  process.exit(0);
});
