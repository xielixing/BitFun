// Dev-only: push the repo source of this mini-app into an already-imported
// BitFun install without re-importing. Re-imports create a new app id and
// lose storage; this keeps the same app and rebuilds compiled.html by reusing
// the injected head chunk (theme css, CSP, scroll guard, import map, bridge)
// from the previous compile — those depend only on app id/paths/permissions,
// which this script does not change except meta.json permissions (read live
// by the worker policy resolver, not baked into the bridge).
//
// Usage: node dev-sync.mjs <installed-app-dir>
// e.g.:  node dev-sync.mjs "%APPDATA%/bitfun/data/miniapps/<uuid>"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = process.argv[2];
if (!appDir || !fs.existsSync(path.join(appDir, 'compiled.html'))) {
  console.error('usage: node dev-sync.mjs <installed-app-dir with compiled.html>');
  process.exit(1);
}

const read = (p) => fs.readFileSync(p, 'utf8');
const oldCompiled = read(path.join(appDir, 'compiled.html'));
const newHtml = read(path.join(repoDir, 'source', 'index.html'));
const newCss = read(path.join(repoDir, 'source', 'style.css'));
const newUi = read(path.join(repoDir, 'source', 'ui.js'));

// 1) reusable injected chunk = everything between <head> and the app's own
// <style> block. compiler.rs emits the app css as a bare `<style>\n` tag —
// the only earlier <style> is the id="bitfun-theme-default" one, so the first
// bare tag is a reliable structural boundary (no content matching needed;
// the installed source can drift from what compiled.html was built from).
const headOpen = oldCompiled.indexOf('<head');
const afterHeadOpen = oldCompiled.indexOf('>', headOpen) + 1;
const styleMatch = /<style>\r?\n/.exec(oldCompiled);
if (!styleMatch) {
  console.error('cannot locate the app <style> block in compiled.html — re-import instead');
  process.exit(1);
}
const injectedChunk = oldCompiled.slice(afterHeadOpen, styleMatch.index);
if (!injectedChunk.includes('Content-Security-Policy') || !injectedChunk.includes('bitfun-theme-default')) {
  console.error('extracted head chunk looks wrong (no CSP/theme style) — re-import instead');
  process.exit(1);
}

// 2) splice the new document exactly like compiler.rs does
const newHeadOpen = newHtml.indexOf('<head');
const newAfterHeadOpen = newHtml.indexOf('>', newHeadOpen) + 1;
const bodyClose = newHtml.lastIndexOf('</body>');
if (newHeadOpen < 0 || bodyClose < 0) {
  console.error('new index.html is missing <head> or </body>');
  process.exit(1);
}
const compiled = newHtml.slice(0, newAfterHeadOpen)
  + injectedChunk
  + `<style>\n${newCss}\n</style>`
  + newHtml.slice(newAfterHeadOpen, bodyClose)
  + `\n<script type="module">\n${newUi}\n</script>\n`
  + newHtml.slice(bodyClose);

// 3) copy sources (worker.js is picked up on next call via the revision hash)
for (const f of ['index.html', 'style.css', 'ui.js', 'worker.js', 'esm_dependencies.json']) {
  fs.copyFileSync(path.join(repoDir, 'source', f), path.join(appDir, 'source', f));
}

// 4) merge permissions only — the installed meta.json keeps its uuid id
const installedMeta = JSON.parse(read(path.join(appDir, 'meta.json')));
const repoMeta = JSON.parse(read(path.join(repoDir, 'meta.json')));
installedMeta.permissions = repoMeta.permissions;
fs.writeFileSync(path.join(appDir, 'meta.json'), JSON.stringify(installedMeta, null, 2));

fs.writeFileSync(path.join(appDir, 'compiled.html'), compiled);
console.log('synced', repoDir, '->', appDir);
console.log('compiled.html rebuilt:', compiled.length, 'bytes (was', oldCompiled.length + ')');
