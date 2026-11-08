/**
 * Browser-half tests: the two client files are shipped as-is, so these are
 * integrity checks rather than unit tests. What breaks a theme in the field is
 * a wallpaper path that no longer exists, a CSS/JS disagreement about a skin
 * id, or a syntax error that only shows up after the page is already dark — so
 * that is what is asserted here.
 *
 *   node --test test/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT = join(PACKAGE_ROOT, 'client')
const read = (name) => readFileSync(join(CLIENT, name), 'utf8')

const themeJs = read('theme.js')
const themeCss = read('theme.css')
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

const SKINS = ['fontaine-nocturne', 'hydro-iris', 'salon-solitude']

/** Every `/<file>` client path the script serves, resolved against client/. */
function routePaths(source) {
  const found = new Set()
  // theme.js concatenates the prefix constant with the file part.
  for (const match of source.matchAll(/(?:ROUTE|'\/furina-theme')\s*\+\s*'(\/[A-Za-z0-9._/-]+)'/gu)) found.add(match[1])
  for (const match of source.matchAll(/\/furina-theme\/([A-Za-z0-9._/-]+)/gu)) found.add(`/${match[1]}`)
  return [...found].sort()
}

test('theme.js is valid syntax for the page interpreter', () => {
  // Compile-only: `vm.Script` parses the file without running it.
  assert.doesNotThrow(() => new vm.Script(themeJs, { filename: 'theme.js' }))
  assert.ok(themeJs.length > 10000)
})

test('the browser half ships no imports and no fetch of foreign origins', () => {
  assert.ok(!/^\s*import\s/mu.test(themeJs), 'classic script: no static import')
  assert.ok(!/^\s*export\s/mu.test(themeJs))
  assert.ok(!/https?:\/\//u.test(themeJs.replace(/\/\/[^\n]*/gu, '')), 'no absolute URLs in code')
})

test('every asset URL in theme.js exists on disk', () => {
  const all = routePaths(themeJs)
  // JSON/action routes rather than files; their request handling lives in host
  // tests. `/api/*` covers billing and the startup-plugin installer.
  const assets = all.filter((path) => !path.startsWith('/wallpapers')
    && !path.startsWith('/user-wallpaper')
    && !path.startsWith('/api/'))
  assert.ok(all.includes('/wallpapers'), 'the custom wallpaper listing route is used')
  assert.ok(assets.length >= 6, `expected the served bundle + art, found ${assets.join(', ')}`)
  for (const path of assets) {
    assert.ok(statSync(join(CLIENT, path)).isFile(), `client${path} is served but missing`)
  }
  assert.ok(assets.some((path) => path.includes('wallpapers/')), 'wallpapers are referenced')
  assert.ok(assets.some((path) => path.includes('thumbs/')), 'thumbnails are referenced')
})

test('every asset URL in theme.css exists on disk', () => {
  const referenced = [...themeCss.matchAll(/url\(\/furina-theme\/([^)]+)\)/gu)].map((match) => match[1])
  assert.ok(referenced.length >= 1)
  for (const path of referenced) {
    assert.ok(statSync(join(CLIENT, path)).isFile(), `client/${path} is styled but missing`)
  }
})

test('theme.css defines all three skins and the shared furniture', () => {
  for (const skin of SKINS) {
    assert.ok(
      themeCss.includes(`html[data-furina-skin='${skin}']`),
      `palette block for ${skin}`,
    )
  }
  for (const accent of ['--fr-accent:', '--fr-bg:', '--fr-text:', '--fr-glow:']) {
    const matches = themeCss.split(accent).length - 1
    assert.equal(matches, 3, `${accent} declared once per skin`)
  }
  for (const selector of [
    '#furina-backdrop',
    '.fr-wp',
    '.fr-veil',
    '.fr-waves',
    '.fr-crest-mark',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-label-primary',
    '--dsw-specific-sidebar-fill',
    'prefers-reduced-motion',
  ]) {
    assert.ok(themeCss.includes(selector), `theme.css should mention ${selector}`)
  }
  assert.ok(!themeCss.includes('\uFEFF'), 'CSS must not carry a BOM')
})

test('theme.css leaves an un-skinned app untouched', () => {
  // Every rule that styles the app is gated on the skin attribute.
  const global = themeCss
    .split('\n')
    .filter((line) => line.includes('{') && !line.trimStart().startsWith('/*'))
    .filter((line) => !line.includes('data-furina') && !line.includes('@') && !line.includes(':root'))
    .filter((line) => !line.includes('#'))
  // What is left may only be keyframes' inner selectors (from/to) and nothing else.
  for (const line of global) {
    const selector = line.slice(0, line.indexOf('{')).trim()
    assert.ok(
      selector === 'from' || selector === 'to' || selector.startsWith('@') || selector === '',
      `unscoped rule: ${selector}`,
    )
  }
})

test('theme.js and package.json agree on version', () => {
  const match = /var VERSION = '([^']+)'/u.exec(themeJs)
  assert.ok(match, 'VERSION is declared')
  assert.equal(match[1], manifest.version)
})

test('the public API the QA pass drives exists', () => {
  for (const name of ['setSkin', 'setWallpaper', 'setGlass', 'openPanel', 'reset', 'remount']) {
    assert.ok(new RegExp(`${name}:\\s*(function|set)`, 'u').test(themeJs), `__furinaTheme.${name}`)
  }
  assert.ok(themeJs.includes('window.__furinaTheme'))
  assert.ok(themeJs.includes("var STORAGE_KEY = 'furina-theme.settings.v1'"))
})

test('switching does not reload the page', () => {
  const code = themeJs.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '')
  assert.ok(!code.includes('location.reload'), 'a skin switch must be in-place')
  assert.ok(!code.includes('location.href'))
})

test('the switcher is isolated in a shadow root and survives remounts', () => {
  assert.ok(themeJs.includes('attachShadow'))
  assert.ok(themeJs.includes('data-skin'))
  assert.ok(themeJs.includes('data-wall'))
  assert.ok(themeJs.includes('data-glass'))
  assert.ok(themeJs.includes('MutationObserver'), 'the shell re-renders; the theme reconciles')
  assert.ok(themeJs.includes("ROUTE + '/wallpapers'"), 'custom wallpapers come from the host route')
})

test('backdrop is a fixed, pointer-transparent, negative-z layer', () => {
  assert.match(themeCss, /#furina-backdrop\s*\{[^}]*position:\s*fixed/u)
  assert.match(themeCss, /#furina-backdrop\s*\{[^}]*z-index:\s*-1/u)
  assert.match(themeCss, /#furina-backdrop\s*\{[^}]*pointer-events:\s*none/u)
  // Robust against another theme painting an opaque ground: the frame is cleared.
  assert.match(themeCss, /body\s*\[data-slot='root'\]\s*>\s*div/u)
})

test('wallpapers are switchable independently of the skin', () => {
  const wallpapers = /var WALLPAPERS = \[([\s\S]*?)\n\s*\]/u.exec(themeJs)
  assert.ok(wallpapers, 'WALLPAPERS table found')
  const ids = [...wallpapers[1].matchAll(/id: '([^']+)'/gu)].map((match) => match[1])
  assert.deepEqual(ids, ['city-noir', 'hydro-iris', 'salon-solitude'])
  assert.ok(themeJs.includes("id: 'auto'"), 'follow-the-skin option')
  assert.ok(themeJs.includes("id: 'none'"), 'no-wallpaper option')
  for (const file of ['furina-01-city-noir.jpg', 'furina-02-hydro-iris.jpg', 'furina-03-salon-solitude.jpg']) {
    assert.ok(statSync(join(CLIENT, 'assets', 'wallpapers', file)).size > 100000, file)
    assert.ok(statSync(join(CLIENT, 'assets', 'thumbs', file.replace('.jpg', '-640.jpg'))).size > 20000, `${file} thumb`)
  }
})

test('the browser half targets the DSH 0.2.2 DOM, not 0.2.1 class names', () => {
  const billingJs = read('billing.js')

  // 0.2.2's settings dialog has no `[class*="content"]` wrapper: navTitle, nav,
  // header and options are direct children. Measuring the dialog itself makes
  // the injected pane cover the nav and the shell's close button, so the pane
  // must be positioned from the options column.
  assert.ok(!themeJs.includes('[class*="content"]'), 'no content-wrapper probe')
  assert.ok(themeJs.includes('optionsOf(settingsDialog)'), 'pane is measured from the options column')
  // The options column has to keep its box while the pane is open, otherwise a
  // resize or observer pass re-measures 0×0 and bails out.
  assert.ok(/options\.style\.visibility = open/u.test(themeJs))
  assert.ok(!/options\.style\.display = open/u.test(themeJs))
  // Narrow windows turn the settings nav into a horizontal strip: appending the
  // injected row after the shell's own list puts it off-screen.
  assert.ok(themeJs.includes('list.insertBefore(cell, after)'), 'nav row is inserted in order')
  // Closing the dialog unmounts it; the observer has to notice so the next open
  // does not jump straight back to the theme page.
  assert.ok(/node === settingsDialog/u.test(themeJs), 'dialog removal resets the pane state')

  // 0.2.2 renamed the composer wrapper; the old class names appear nowhere in
  // the shipped shell, so rules keyed on them never matched. (Comments may name
  // them; only real declarations count.)
  const themeCssCode = themeCss.replace(/\/\*[\s\S]*?\*\//gu, '')
  assert.ok(!themeCssCode.includes('inputWrap'))
  assert.ok(!themeCssCode.includes('composerBar'))
  assert.ok(themeCssCode.includes("[class*='_card']"), 'composer glass targets the live card')

  // `[data-slot="sidebar.footer.action"]` is a `display: contents` anchor in
  // 0.2.2: its own rect is 0×0, so the rendered box lives on its parent.
  assert.ok(billingJs.includes('footerSlot.parentElement'), 'footer anchor is measured through its box')
  // Sidebar collapse is an attribute flip inside the layout frame, not a resize.
  assert.ok(billingJs.includes('data-sidebar-collapsed'), 'frame attribute observer')
})
