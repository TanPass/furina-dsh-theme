import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { PRESET_DIR, installPreset, presetStatus, removePreset, renderPresetBlock } from '../lib/preset.js'

function scratchProfile() {
  const home = mkdtempSync(join(tmpdir(), 'furina-preset-'))
  const profile = join(home, 'profiles', 'web')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'web-profile',
    dependencies: { 'furina-dsh-theme': 'file:C:/x/furina-dsh-theme-1.2.6.tgz' },
  }))
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '- id: ui-theme',
    '  name: "@deepseek-ai/dsh-client-ui-theme"',
    '  config:',
    '    preference: system',
    '',
  ].join('\n'))
  return { home, profile }
}

test('renderPresetBlock emits one valid declaration row', () => {
  const block = renderPresetBlock()
  assert.match(block, /# \[furina-dsh-theme\] furina agent preset — begin/)
  assert.match(block, /- insert:/)
  assert.match(block, /- id: preset-furina-de-fontaine/)
  assert.match(block, /name: '@deepseek-ai\/dsh-agent-preset'/)
  assert.match(block, /id: furina-de-fontaine/)
  assert.match(block, /name: "芙宁娜·德·枫丹"/)
  assert.match(block, /plugins:/)
  assert.match(block, /- id: persona/)
  assert.match(block, /complete: true/)
  assert.ok(block.length > 8000)
})

test('install, status, re-install and remove touch only our marker block', () => {
  const { home, profile } = scratchProfile()
  const before = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.equal(presetStatus(home).installed, false)

  const first = installPreset(home)
  assert.equal(first.ok, true)
  assert.equal(first.installed, true)
  assert.equal(first.already, false)
  assert.ok(first.backup)
  const installed = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.ok(installed.startsWith(before.trimEnd()))
  assert.equal(presetStatus(home).installed, true)

  const again = installPreset(home)
  assert.equal(again.ok, true)
  assert.equal(again.installed, true)

  const custom = `${installed}\n- id: other-theme\n  name: other\n  config:\n    a: 1\n`
  writeFileSync(join(profile, 'cordis.patch.yml'), custom)
  const removed = removePreset(home)
  assert.equal(removed.ok, true)
  assert.equal(removed.installed, false)
  const after = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.ok(!after.includes('furina agent preset'))
  assert.match(after, /- id: other-theme/)
  assert.ok(after.startsWith(before.trimEnd()))
  assert.equal(presetStatus(home).installed, false)
})

test('invalid preset folder is reported without touching the profile', () => {
  const { home, profile } = scratchProfile()
  const before = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  const empty = mkdtempSync(join(tmpdir(), 'furina-empty-'))
  const result = installPreset(home, empty)
  assert.equal(result.ok, false)
  assert.match(String(result.error), /preset-invalid/)
  assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), before)
})

test('bundled preset sources point persona at the Furina prompt', () => {
  const meta = readFileSync(join(PRESET_DIR, 'preset.yml'), 'utf8')
  assert.match(meta, /^id: furina-de-fontaine$/m)
  assert.match(meta, /^description: ".+"$/m)
  const plugins = readFileSync(join(PRESET_DIR, 'agent.cordis.yml'), 'utf8')
  assert.match(plugins, /^- id: persona$/m)
  assert.ok(plugins.includes('芙宁娜'))
  assert.ok(!plugins.includes('\uFFFD'))
})
