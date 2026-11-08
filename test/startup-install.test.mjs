/**
 * One-click startup-animation installer tests.
 *
 * The thing that breaks here is never the copy itself: it is where the profile
 * points afterwards. A `file:` spec recorded against the theme package's own
 * install location (pnpm's `.pnpm/<hash>/…`, an npm cache path) stops resolving
 * as soon as that install is refreshed, so the profile keeps a bundle entry it
 * can no longer load. These tests pin the stable location and the repair path.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { companionInstallDir, companionVersion, installCompanion } from '../lib/startup-install.js'

function makeHome(manifest) {
  const home = mkdtempSync(join(tmpdir(), 'furina-startup-'))
  const profile = join(home, 'profiles', 'web')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { home, profile, manifestPath: join(profile, 'package.json') }
}

const themeProfile = (extra = {}) => ({
  name: 'dsh-profile-web',
  private: true,
  dependencies: { 'furina-dsh-theme': 'file:C:/x/furina-dsh-theme-1.2.8.tgz', ...extra },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'furina-dsh-theme'] } },
})

test('installer records a stable home path, never the package install path', () => {
  const { home, profile, manifestPath } = makeHome(themeProfile())
  const result = installCompanion(home)

  assert.equal(result.ok, true)
  assert.equal(result.already, false)
  assert.equal(result.version, companionVersion())
  assert.equal(result.restart, true)
  assert.ok(result.backup)

  const stable = companionInstallDir(home)
  assert.equal(stable, join(home, 'plugins', 'dsh-startup-screen'))
  assert.equal(result.installedAt, stable)
  assert.ok(existsSync(join(stable, 'package.json')))
  assert.ok(existsSync(join(profile, 'node_modules', 'dsh-startup-screen', 'package.json')))

  const written = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(written.dependencies['dsh-startup-screen'], `file:${stable.replace(/\\/gu, '/')}`)
  assert.ok(!written.dependencies['dsh-startup-screen'].includes('.pnpm'))
  assert.ok(written.dsh.profile.bundles.includes('dsh-startup-screen'))
  // The theme dependency is untouched.
  assert.equal(written.dependencies['furina-dsh-theme'], themeProfile().dependencies['furina-dsh-theme'])
})

test('a second install is a no-op once the stable spec is recorded', () => {
  const { home, manifestPath } = makeHome(themeProfile())
  assert.equal(installCompanion(home).ok, true)
  const afterFirst = readFileSync(manifestPath, 'utf8')

  const again = installCompanion(home)
  assert.equal(again.ok, true)
  assert.equal(again.already, true)
  assert.equal(again.restart, false)
  assert.equal(readFileSync(manifestPath, 'utf8'), afterFirst)
})

test('a transient path from an older install is repaired in place', () => {
  const transient = 'file:C:/Users/x/.dsh/profiles/web/node_modules/.pnpm/furina-dsh-theme@file+abc/node_modules/furina-dsh-theme/companion/dsh-startup-screen'
  const { home, profile, manifestPath } = makeHome(themeProfile({ 'dsh-startup-screen': transient }))
  // Pretend the old install left its copy and bundle entry behind.
  mkdirSync(join(profile, 'node_modules', 'dsh-startup-screen'), { recursive: true })
  writeFileSync(join(profile, 'node_modules', 'dsh-startup-screen', 'package.json'), '{"name":"dsh-startup-screen","version":"0.0.1"}\n')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles.push('dsh-startup-screen')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const result = installCompanion(home)
  assert.equal(result.ok, true)
  const written = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(written.dependencies['dsh-startup-screen'], `file:${companionInstallDir(home).replace(/\\/gu, '/')}`)
  assert.equal(
    JSON.parse(readFileSync(join(profile, 'node_modules', 'dsh-startup-screen', 'package.json'), 'utf8')).version,
    companionVersion(),
  )
})

test('no profile that depends on the theme means no write', () => {
  const { home, manifestPath } = makeHome({ name: 'unrelated', dependencies: {}, dsh: { profile: { bundles: [] } } })
  const before = readFileSync(manifestPath, 'utf8')
  const result = installCompanion(home)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'profile-not-found')
  assert.equal(readFileSync(manifestPath, 'utf8'), before)
  assert.ok(!existsSync(companionInstallDir(home)))
})
