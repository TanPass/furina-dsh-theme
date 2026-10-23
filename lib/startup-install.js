/**
 * furina-dsh-theme — one-click installer for the companion startup animation.
 *
 * The theme does not absorb `dsh-startup-screen`; it only offers to install the
 * unmodified plugin that it knows how to tint. The plugin ships inside this
 * package under `companion/dsh-startup-screen` (MIT, see companion/README.md),
 * so install is a local copy plus two profile edits — no network, no exec.
 *
 * Steps, all idempotent:
 *  1. locate the active DSH profile (the one that depends on this package);
 *  2. copy the vendored plugin into that profile's node_modules;
 *  3. add the dependency and the `dsh.profile.bundles` entry, keeping a backup.
 *
 * A running DSH only composes bundles at boot, so the caller must restart to
 * actually load it. The response says so explicitly.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const COMPANION = join(PACKAGE_ROOT, 'companion', 'dsh-startup-screen')
const BUNDLE_ID = 'dsh-startup-screen'
const DEPENDENCY = 'dsh-startup-screen'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Every profile under `<home>/profiles/*` that looks like a DSH profile. */
function profileDirs(home) {
  const root = join(home, 'profiles')
  let names = []
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
  return names.map((name) => join(root, name))
}

/**
 * Prefer the profile that already depends on this theme; fall back to the one
 * that already has the startup plugin; never guess across unrelated profiles.
 */
function activeProfile(home) {
  const candidates = []
  for (const dir of profileDirs(home)) {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    let manifest
    try {
      manifest = readJson(manifestPath)
    } catch {
      continue
    }
    const deps = manifest.dependencies ?? {}
    const bundles = manifest.dsh?.profile?.bundles ?? []
    const isTheme = Object.prototype.hasOwnProperty.call(deps, 'furina-dsh-theme')
      || bundles.includes('furina-dsh-theme')
    // A dependency entry alone does not load the plugin: the bundle list is what
    // the boot composes. Treat it as installed only when both are true.
    const hasStartup = bundles.includes(BUNDLE_ID)
      && existsSync(join(dir, 'node_modules', DEPENDENCY, 'package.json'))
    if (isTheme) candidates.push({ dir, manifest, hasStartup, manifestPath })
  }
  if (candidates.length === 0) return null
  // An already-installed profile is reported as such instead of being edited again.
  return candidates.find((entry) => entry.hasStartup) ?? candidates[0]
}

function copyTree(source, target) {
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, {
    recursive: true,
    force: true,
    errorOnExist: false,
    dereference: true,
  })
}

function backup(manifestPath) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const copyPath = `${manifestPath}.furina-${stamp}.bak`
  writeFileSync(copyPath, readFileSync(manifestPath))
  return copyPath
}

/**
 * @returns {{ ok: boolean, already: boolean, version: string|null, profile: string|null, restart: boolean, backup?: string|null, error?: string }}
 */
export function installCompanion(home = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  if (!existsSync(COMPANION)) {
    return { ok: false, already: false, version: null, profile: null, restart: false, error: 'companion-missing' }
  }
  const companionVersion = (() => {
    try {
      return String(readJson(join(COMPANION, 'package.json')).version ?? '')
    } catch {
      return null
    }
  })()
  const profile = activeProfile(home)
  if (profile === null) {
    return { ok: false, already: false, version: companionVersion, profile: null, restart: false, error: 'profile-not-found' }
  }
  if (profile.hasStartup) {
    return { ok: true, already: true, version: companionVersion, profile: profile.dir, restart: false, backup: null }
  }

  const target = join(profile.dir, 'node_modules', DEPENDENCY)
  try {
    rmSync(target, { recursive: true, force: true })
  } catch {
    /* best effort: cpSync reports the real reason below */
  }
  try {
    copyTree(COMPANION, target)
  } catch (error) {
    return {
      ok: false,
      already: false,
      version: companionVersion,
      profile: profile.dir,
      restart: false,
      error: `copy-failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const backupPath = backup(profile.manifestPath)
  const manifest = profile.manifest
  manifest.dependencies = manifest.dependencies ?? {}
  manifest.dependencies[DEPENDENCY] = `file:${COMPANION.replace(/\\/gu, '/')}`
  manifest.dsh = manifest.dsh ?? {}
  manifest.dsh.profile = manifest.dsh.profile ?? {}
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  if (!bundles.includes(BUNDLE_ID)) bundles.push(BUNDLE_ID)
  manifest.dsh.profile.bundles = bundles

  const tempPath = `${profile.manifestPath}.furina.tmp`
  writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(tempPath, profile.manifestPath)

  return {
    ok: true,
    already: false,
    version: companionVersion,
    profile: profile.dir,
    restart: true,
    backup: backupPath,
  }
}

/** Version of the vendored plugin, or null when the companion folder is absent. */
export function companionVersion() {
  try {
    return String(readJson(join(COMPANION, 'package.json')).version ?? '')
  } catch {
    return null
  }
}
