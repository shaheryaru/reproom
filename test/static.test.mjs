import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pngSize(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buf.toString('ascii', 12, 16), 'IHDR');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('manifest, icons, and service worker match the GitHub Pages shell', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /href="icons\/apple-touch-icon\.png"/);
  assert.doesNotMatch(html, /href="\/manifest\.json"/);

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name.includes('RepRoom'), true);
  assert.equal(manifest.short_name, 'RepRoom');
  assert.equal(manifest.start_url, './#today');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#1f5c45');
  const purposes = manifest.icons.map(icon => `${icon.purpose}:${icon.sizes}`);
  assert.ok(purposes.includes('any:192x192'));
  assert.ok(purposes.includes('any:512x512'));
  assert.ok(purposes.includes('maskable:512x512'));
  for (const icon of manifest.icons) {
    const file = path.join(root, icon.src);
    const size = pngSize(fs.readFileSync(file));
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.equal(size.w, w, icon.src);
    assert.equal(size.h, h, icon.src);
  }
  const apple = pngSize(fs.readFileSync(path.join(root, 'icons/apple-touch-icon.png')));
  assert.deepEqual(apple, { w: 180, h: 180 });

  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /const VERSION = 'reproom-v2\.1\.0'/);
  const listed = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  for (const file of listed) {
    if (file === './') continue;
    assert.equal(fs.existsSync(path.join(root, file.replace(/^\.\//, ''))), true, file);
  }
  assert.match(sw, /response\.ok/);
  assert.match(sw, /response\.status === 200/);
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.match(sw, /pathname\.endsWith\('\/sw\.js'\)/);
  assert.match(sw, /caches\.delete/);
});
