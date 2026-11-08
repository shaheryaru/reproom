import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = '/opt/cursor/artifacts';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
};

let server, browser, base, origin;

function startServer() {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/reproom') {
      res.writeHead(301, { Location: '/reproom/' });
      res.end();
      return;
    }
    if (!pathname.startsWith('/reproom/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('missing');
      return;
    }
    let rel = pathname.slice('/reproom/'.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end('missing ' + rel);
        return;
      }
      const type = MIME[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      base = origin + '/reproom/';
      resolve();
    });
  });
}

async function newPage(width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.errors = errors;
  return page;
}

async function shot(page, name) {
  fs.mkdirSync(artifacts, { recursive: true });
  await page.evaluate(() => {
    const toast = document.querySelector('#toast');
    if (toast) { toast.classList.remove('show'); toast.style.display = 'none'; }
    const tabs = document.querySelector('.tabs');
    if (tabs) {
      tabs.dataset.shotStyle = tabs.style.cssText;
      tabs.style.position = 'relative';
      tabs.style.left = 'auto';
      tabs.style.right = 'auto';
      tabs.style.bottom = 'auto';
    }
  });
  try {
    await page.screenshot({ path: path.join(artifacts, name + '.png'), fullPage: true });
  } finally {
    await page.evaluate(() => {
      const tabs = document.querySelector('.tabs');
      if (tabs && 'shotStyle' in tabs.dataset) {
        tabs.style.cssText = tabs.dataset.shotStyle;
        delete tabs.dataset.shotStyle;
      }
      const toast = document.querySelector('#toast');
      if (toast) toast.style.display = '';
    });
  }
}

async function foodsToday(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('reproom.v2');
    if (!raw) return [];
    const db = JSON.parse(raw);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return db.foods.filter(food => food.date === today);
  });
}

async function expectTotal(page, kcal) {
  const expected = await page.evaluate(n => `${Math.round(n).toLocaleString()} / ${(2200).toLocaleString()} kcal`, kcal);
  assert.equal(await page.locator('#dayTotal').innerText(), expected);
}

describe('RepRoom phone flows', { concurrency: 1, timeout: 60000 }, () => {
  before(async () => {
    await startServer();
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('add, edit, delete food and keep daily totals', async () => {
    const page = await newPage();
    await page.goto(base + '#food');
    await page.locator('#foodDay').waitFor();
    assert.match(await page.locator('.empty').innerText(), /Nothing logged for this day yet/);
    assert.equal(await page.locator('#nextD').isDisabled(), true);
    await shot(page, 'mobile_food_empty');

    await page.locator('#foodSubmit').click();
    await page.locator('#foodError').waitFor();
    assert.match(await page.locator('#foodError').innerText(), /Enter a food name/);
    assert.match(await page.locator('#foodError').innerText(), /Enter calories/);
    assert.equal((await foodsToday(page)).length, 0);
    assert.equal(await page.locator('#fName').getAttribute('aria-invalid'), 'true');

    await page.fill('#fName', '   ');
    await page.fill('#fKcal', '120');
    await page.locator('#foodSubmit').click();
    assert.match(await page.locator('#foodError').innerText(), /Enter a food name/);
    assert.equal((await foodsToday(page)).length, 0);

    await page.fill('#fName', 'Soda');
    await page.locator('#fKcal').evaluate(input => { input.value = '-20'; });
    await page.locator('#foodSubmit').click();
    assert.match(await page.locator('#foodError').innerText(), /0 to 20,000/);
    assert.equal((await foodsToday(page)).length, 0);
    await shot(page, 'mobile_food_error');

    await page.fill('#fName', 'Fish & chips');
    await page.fill('#fKcal', '540');
    await page.fill('#fProt', '22');
    await page.selectOption('#fMeal', { label: 'Lunch' });
    await page.locator('#foodSubmit').click();
    await page.locator('.list .name', { hasText: 'Fish & chips' }).waitFor();
    await expectTotal(page, 540);
    const remain = await page.evaluate(n => `${(2200 - n).toLocaleString()} left`, 540);
    assert.equal(await page.locator('#dayRemain').innerText(), remain);
    assert.match(await page.locator('#dayProtein').innerText(), /22 \/ 120 g/);
    assert.match(await page.locator('#view').innerText(), /Lunch/);

    await page.getByRole('button', { name: 'Edit Fish & chips' }).click();
    await page.locator('#foodFormTitle', { hasText: 'Edit food' }).waitFor();
    assert.equal(await page.inputValue('#fName'), 'Fish & chips');
    assert.equal(await page.inputValue('#fKcal'), '540');
    assert.equal(await page.inputValue('#fProt'), '22');
    assert.equal(await page.inputValue('#fMeal'), 'Lunch');
    await page.fill('#fName', 'Fish & chips (large)');
    await page.fill('#fKcal', '10.6');
    await page.fill('#fProt', '30');
    await page.selectOption('#fMeal', { label: 'Dinner' });
    await shot(page, 'mobile_food_edit');
    await page.locator('#foodSubmit').click();
    await page.locator('#foodFormTitle', { hasText: 'Add food' }).waitFor();
    assert.equal(await page.locator('.list .name').innerText(), 'Fish & chips (large)');
    await expectTotal(page, 11);
    let stored = await foodsToday(page);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].kcal, 11);
    assert.equal(stored[0].protein, 30);
    assert.equal(stored[0].meal, 'Dinner');

    await page.getByRole('button', { name: 'Edit Fish & chips (large)' }).click();
    await page.fill('#fName', 'Nope');
    await page.fill('#fKcal', '999');
    await page.locator('#cancelFood').click();
    assert.equal(await page.locator('.list .name').innerText(), 'Fish & chips (large)');
    assert.equal((await foodsToday(page))[0].kcal, 11);

    await page.getByRole('button', { name: 'Banana · 105' }).click();
    await page.locator('.list .name', { hasText: 'Banana' }).waitFor();
    await expectTotal(page, 116);
    await page.getByRole('button', { name: 'Fish & chips (large) · 11' }).click();
    await page.locator('.list .name', { hasText: 'Fish & chips (large)' }).nth(1).waitFor();
    await expectTotal(page, 127);
    assert.match(await page.locator('#dayProtein').innerText(), /61 \/ 120 g/);

    await page.reload();
    await page.locator('.list .name', { hasText: 'Banana' }).waitFor();
    await expectTotal(page, 127);
    stored = await foodsToday(page);
    assert.equal(stored.length, 3);

    await page.getByRole('button', { name: 'Delete Banana' }).click();
    await page.locator('.list .name', { hasText: 'Banana' }).waitFor({ state: 'detached' });
    await expectTotal(page, 22);
    assert.equal(await page.locator('.list .name', { hasText: 'Banana' }).count(), 0);

    await page.locator('#prevD').click();
    await page.locator('#foodDay', { hasText: 'Yesterday' }).waitFor();
    assert.match(await page.locator('.empty').innerText(), /Nothing logged/);
    await expectTotal(page, 0);
    await page.fill('#fName', 'Oats');
    await page.fill('#fKcal', '180');
    await page.fill('#fProt', '6');
    await page.locator('#foodSubmit').click();
    await page.locator('.list .name', { hasText: 'Oats' }).waitFor();
    await expectTotal(page, 180);
    await page.locator('#nextD').click();
    await page.locator('#foodDay', { hasText: 'Today' }).waitFor();
    await expectTotal(page, 22);
    await shot(page, 'mobile_food_logged');

    await page.goto(base + '#today');
    await page.locator('#view').getByText('Eaten', { exact: true }).waitFor();
    assert.match(await page.locator('#view').innerText(), /22/);
    await shot(page, 'mobile_today_totals');

    await page.goto(base + '#summary');
    await page.getByRole('heading', { name: 'Summary' }).waitFor();
    assert.match(await page.locator('#view').innerText(), /22 kcal/);
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await page.locator('#sDate').waitFor();
    assert.match(await page.locator('#view').innerText(), /22/);

    await page.goto(base + '#settings');
    await page.locator('#goal').waitFor();
    assert.equal(await page.inputValue('#goal'), '2200');
    assert.equal(page.errors.length, 0, page.errors.join('\n'));
    await page.context().close();
  });

  test('unsafe names stay text and narrow phones do not scroll sideways', async () => {
    const page = await newPage(320, 700);
    await page.goto(base + '#food');
    const payload = '<img src=x onerror=window.__xss=1>';
    await page.fill('#fName', payload);
    await page.fill('#fKcal', '15');
    await page.locator('#foodSubmit').click();
    await page.locator('.list .name').waitFor();
    assert.equal(await page.locator('.list .name').innerText(), payload);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    await page.getByRole('button', { name: 'Edit ' + payload }).click();
    assert.equal(await page.inputValue('#fName'), payload);
    await page.locator('#cancelFood').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, 'horizontal overflow ' + overflow);
    const box = await page.getByRole('button', { name: 'Delete ' + payload }).boundingBox();
    assert.ok(box.width >= 24 && box.height >= 24, JSON.stringify(box));
    assert.equal(page.errors.length, 0, page.errors.join('\n'));
    await page.context().close();
  });

  test('workout log still saves, reloads, and deletes', async () => {
    const page = await newPage();
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base + '#workout');
    await page.getByRole('heading', { name: 'Log workout' }).waitFor();
    await page.getByRole('button', { name: '+ Bench Press' }).click();
    await page.locator('.reps').fill('8');
    await page.locator('.wt').fill('60');
    await page.getByRole('button', { name: 'Save workout' }).click();
    await page.locator('details.wk').waitFor();
    assert.match(await page.locator('details.wk').innerText(), /Bench Press/);
    await page.reload();
    await page.locator('details.wk').waitFor();
    assert.match(await page.locator('details.wk').innerText(), /Bench Press/);
    await page.locator('details.wk summary').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.locator('.empty', { hasText: 'Saved workouts show up here.' }).waitFor();
    assert.equal(page.errors.length, 0, page.errors.join('\n'));
    await page.context().close();
  });

  test('service worker scope, offline shell, and safe cache', async () => {
    const page = await newPage();
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations += 1; });
    await page.goto(base);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
    await page.waitForTimeout(800);
    assert.equal(navigations, 1, 'first install should not reload the page');
    const redirected = await page.goto(origin + '/reproom');
    assert.equal(redirected.status(), 200);
    assert.equal(page.url(), base);

    const info = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]').href;
      const manifest = await (await fetch(link)).json();
      const reg = await navigator.serviceWorker.getRegistration();
      const icons = [];
      for (const icon of manifest.icons) {
        const href = new URL(icon.src, link).href;
        const res = await fetch(href);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        icons.push({ href, status: res.status, type: res.headers.get('content-type'), width, sizes: icon.sizes, purpose: icon.purpose });
      }
      return {
        link,
        start: new URL(manifest.start_url, link).href,
        scope: new URL(manifest.scope, link).href,
        display: manifest.display,
        swScope: reg.scope,
        script: reg.active && reg.active.scriptURL,
        icons
      };
    });
    assert.equal(info.link, base + 'manifest.webmanifest');
    assert.equal(info.scope, base);
    assert.ok(info.start.startsWith(base), info.start);
    assert.equal(info.display, 'standalone');
    assert.equal(info.swScope, base);
    assert.equal(info.script, base + 'sw.js');
    assert.equal(info.icons.length, 3);
    for (const icon of info.icons) {
      assert.equal(icon.status, 200, icon.href);
      assert.match(icon.type, /image\/png/);
      assert.ok(icon.href.startsWith(base + 'icons/'), icon.href);
      assert.equal(String(icon.width), icon.sizes.split('x')[0]);
    }

    await page.goto(base + '#food');
    await page.fill('#fName', 'Offline oats');
    await page.fill('#fKcal', '250');
    await page.fill('#fProt', '8');
    await page.locator('#foodSubmit').click();
    await page.locator('.list .name', { hasText: 'Offline oats' }).waitFor();
    await expectTotal(page, 250);

    await page.evaluate(() => fetch('does-not-exist.txt'));
    const poisoned = await page.evaluate(async () => {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        if (requests.some(request => request.url.includes('does-not-exist'))) return key;
      }
      return '';
    });
    assert.equal(poisoned, '');
    const versions = await page.evaluate(() => caches.keys());
    assert.deepEqual(versions, ['reproom-v2.1.0']);

    await page.context().setOffline(true);
    await page.reload();
    await page.locator('.list .name', { hasText: 'Offline oats' }).waitFor();
    await expectTotal(page, 250);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(background, 'rgb(246, 243, 236)');
    const missed = await page.evaluate(async () => {
      try {
        const res = await fetch('missing-script.js');
        return { status: res.status, text: (await res.text()).slice(0, 40) };
      } catch (error) {
        return { error: String(error) };
      }
    });
    assert.ok(missed.error || missed.status >= 400, JSON.stringify(missed));
    assert.equal(String(missed.text || '').includes('<!doctype'), false);

    await page.goto(base + 'not-a-route');
    await page.locator('nav.tabs').waitFor();
    assert.match(await page.locator('.brand').innerText(), /RepRoom/);
    await page.goto(base + '#food');
    await page.locator('.list .name', { hasText: 'Offline oats' }).waitFor();
    await page.fill('#fName', 'Offline banana');
    await page.fill('#fKcal', '105');
    await page.locator('#foodSubmit').click();
    await expectTotal(page, 355);
    await page.reload();
    await page.locator('.list .name', { hasText: 'Offline banana' }).waitFor();
    await expectTotal(page, 355);
    await shot(page, 'mobile_offline_food');

    await page.context().setOffline(false);
    await page.reload();
    await page.locator('.list .name', { hasText: 'Offline banana' }).waitFor();
    await expectTotal(page, 355);
    assert.equal(page.errors.length, 0, page.errors.join('\n'));
    await page.context().close();
  });
});
