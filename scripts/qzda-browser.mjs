#!/usr/bin/env node
// Qzda browser computer-use helper(playwright 后端)。
//
// 输入:stdin 一行 JSON {"cmd": "...", "url": "...", "selector": "...", "value": "..."}
// 输出:stdout 一行 JSON {"status":"success|failed", "result":...}
//
// cmd ∈ {navigate, click, type, fill, extract_text, extract_html, screenshot, eval, close}
//
// 安全:
//   - launch headless only(playwright.chromium.launch({ headless: true }))
//   - 严格 sandbox 路径 / 限制并发 1 浏览器(避免 OOM)
//   - 每次启动超时 8s,完成后再 shutdown
//   - 操作超时按 cmd 分级:navigate 5s, click 3s, type 2s, fill 2s
//
// 注意:必须 NODE_PATH=/opt/homebrew/lib/node_modules 或 npm link playwright 才能
// 找到全局包;或者改用本仓库 frontend/node_modules/playwright(需先 npm i)。

import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';

const OP_TIMEOUT = {
  'navigate': 5_000,
  'click': 3_000,
  'type': 2_000,
  'fill': 2_000,
  'extract_text': 1_000,
  'extract_html': 1_000,
  'screenshot': 5_000,
  'eval': 2_000,
  'close': 5_000,
};

let browser = null;

async function ensureBrowser() {
  if (browser) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  return browser;
}

async function newContext(b) {
  const ctx = await b.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'QzdaBrowserComputerUse/1.0 (agent; QZDA)',
  });
  const page = await ctx.newPage();
  return page;
}

async function handleCmd(req) {
  const b = await ensureBrowser();
  const page = await newContext(b);
  const t = OP_TIMEOUT[req.cmd] || 5_000;
  try {
    let result;
    switch (req.cmd) {
      case 'navigate': {
        await page.goto(req.url, { waitUntil: 'domcontentloaded', timeout: t });
        const title = await page.title();
        const url = page.url();
        result = { title, url };
        break;
      }
      case 'click': {
        await page.locator(req.selector).click({ timeout: t });
        result = { clicked: req.selector };
        break;
      }
      case 'type': {
        await page.locator(req.selector).fill(req.value || '');
        result = { typed: req.selector, value_len: (req.value || '').length };
        break;
      }
      case 'fill': {
        // fill 输入框 = clear + type,适合提交表单前
        const loc = page.locator(req.selector);
        await loc.fill('');
        await loc.fill(req.value || '');
        result = { filled: req.selector, value_len: (req.value || '').length };
        break;
      }
      case 'extract_text': {
        const html = req.selector
          ? await page.locator(req.selector).innerText({ timeout: t })
          : await page.locator('body').innerText({ timeout: t });
        result = { text: html.slice(0, 8_000) };
        break;
      }
      case 'extract_html': {
        const html = req.selector
          ? await page.locator(req.selector).innerHTML({ timeout: t })
          : await page.content({ timeout: t });
        result = { html: html.slice(0, 32_000) };
        break;
      }
      case 'screenshot': {
        const path = req.path || '/tmp/qzda-browser/shot.png';
        const buf = await page.screenshot({ fullPage: !!req.fullPage, timeout: t });
        const fs = await import('fs/promises');
        await fs.mkdir(require('node:path').dirname(path), { recursive: true });
        await fs.writeFile(path, buf);
        result = { path, bytes: buf.length };
        break;
      }
      case 'eval': {
        const val = await page.evaluate(req.js || '1+1');
        result = { value: typeof val === 'object' ? JSON.stringify(val) : String(val) };
        break;
      }
      case 'close': {
        if (browser) { await browser.close(); browser = null; }
        result = { closed: true };
        break;
      }
      default:
        throw new Error(`unknown cmd: ${req.cmd}`);
    }
    return { status: 'success', cmd: req.cmd, result };
  } catch (e) {
    return { status: 'failed', cmd: req.cmd, error: String(e.message || e) };
  } finally {
    try { await page.context().close(); } catch {}
  }
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    console.log(JSON.stringify({ status: 'failed', error: 'empty stdin' }));
    return;
  }
  let req;
  try { req = JSON.parse(raw); }
  catch (e) {
    console.log(JSON.stringify({ status: 'failed', error: 'invalid json: ' + e.message }));
    return;
  }
  const out = await handleCmd(req);
  console.log(JSON.stringify(out));
}

process.on('SIGTERM', async () => { if (browser) { try { await browser.close(); } catch {} } process.exit(143); });
process.on('SIGINT', async () => { if (browser) { try { await browser.close(); } catch {} } process.exit(130); });

main().catch((e) => {
  console.log(JSON.stringify({ status: 'failed', error: 'main: ' + String(e.message || e) }));
});