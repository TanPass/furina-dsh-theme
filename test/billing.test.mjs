/**
 * Unit tests for the billing host half (`lib/billing.js`).
 *
 * No DSH process is started here: the cost-meter and account services are
 * replaced by small fakes with the shapes documented by dsh-cost-meter 1.8.24
 * (`getState()`, `getSessionBilling({sessionId, turnOffset})`,
 * `deepseekAccount.getBalance()`), so these tests pin our adapter and the
 * bonus-wallet fix, not the upstream ledger.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createBillingHandler,
  isSessionId,
  mergeAccountWallets,
  normalizeBalance,
} from '../lib/billing.js'

const SESSION = 'session-4680794b-a221-4a61-a2cc-72e6f1c1887d'

function close (actual, expected, epsilon = 1e-9) {
  assert.equal(typeof actual, 'number')
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`)
}

function fakeResponse () {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead (status, headers = {}) {
      this.statusCode = status
      Object.assign(this.headers, headers)
      return this
    },
    end (chunk) {
      if (chunk !== undefined) this.body += chunk
    },
    json () {
      return JSON.parse(this.body)
    },
  }
}

async function call (handler, url = '/furina-theme/api/billing', method = 'GET') {
  const request = { method, url }
  const response = fakeResponse()
  await handler(request, response)
  return response
}

function fakeCtx ({ state, billing, account, meter = true } = {}) {
  const calls = { state: 0, billing: [], balance: 0 }
  const services = {}
  if (meter) {
    services.costMeter = {
      async getState () {
        calls.state++
        return typeof state === 'function' ? state() : state
      },
      async getSessionBilling (query) {
        calls.billing.push(query)
        return typeof billing === 'function' ? billing(query) : billing
      },
    }
  }
  if (account) {
    services.deepseekAccount = {
      async getBalance (meta) {
        calls.balance++
        return typeof account === 'function' ? account(meta) : account
      },
    }
  }
  return {
    calls,
    ctx: {
      get (name) {
        return services[name]
      },
    },
  }
}

function ledgerState (overrides = {}) {
  return {
    config: { exchangeRate: 7.2 },
    meta: {
      dayKey: '2026-10-22',
      monthKey: '2026-10',
      timezone: 'Asia/Shanghai',
      timezoneOffsetMinutes: 480,
    },
    balance: {
      status: 'ok',
      currency: 'CNY',
      totalBalance: 42.24,
      grantedBalance: 9.44,
      toppedUpBalance: 32.8,
      fetchedAt: 1_760_000_000_000,
      message: '',
    },
    today: {
      date: '2026-10-22',
      input: 1200,
      output: 800,
      cacheRead: 4000,
      cacheWrite: 300,
      reasoning: 100,
      calls: 4,
      cost: 0.012,
      apiCost: 0.009,
    },
    ...overrides,
  }
}

/* ------------------------------------------------------------------ ids */

test('isSessionId only accepts canonical DSH session ids', () => {
  assert.equal(isSessionId(SESSION), true)
  assert.equal(isSessionId(SESSION.toUpperCase()), true)
  assert.equal(isSessionId('session-4680794b-a221-4a61-a2cc-72e6f1c1887d-extra'), false)
  assert.equal(isSessionId('session-123'), false)
  assert.equal(isSessionId('../../etc/passwd'), false)
  assert.equal(isSessionId(''), false)
  assert.equal(isSessionId(null), false)
  assert.equal(isSessionId(42), false)
})

/* -------------------------------------------------------------- balance */

test('normalizeBalance keeps a real figure and flag as available', () => {
  const balance = normalizeBalance({
    status: 'ok',
    currency: 'cny',
    totalBalance: 42.24,
    grantedBalance: 9.44,
    toppedUpBalance: 32.8,
    fetchedAt: 1_760_000_000_000,
  })
  assert.equal(balance.available, true)
  assert.equal(balance.currency, 'CNY')
  assert.equal(balance.total, 42.24)
  assert.equal(balance.granted, 9.44)
  assert.equal(balance.toppedUp, 32.8)
  assert.equal(balance.updatedAt, new Date(1_760_000_000_000).toISOString())
})

test('normalizeBalance never turns a disabled/failed lookup into a zero balance', () => {
  for (const [status, reason] of [['off', 'balance-disabled'], ['error', 'balance-error'], ['', 'balance-unavailable']]) {
    const balance = normalizeBalance({ status })
    assert.equal(balance.available, false)
    assert.equal(balance.reason, reason)
    assert.equal(balance.total, null)
    assert.equal(balance.granted, null)
  }
  const missingTotal = normalizeBalance({ status: 'ok', currency: 'CNY' })
  assert.equal(missingTotal.available, false)
  assert.equal(missingTotal.total, null)
})

test('mergeAccountWallets includes bonus wallets (the endfield bug)', () => {
  const merged = mergeAccountWallets(
    [{ currency: 'CNY', balance: '17.22136104' }],
    [{ currency: 'CNY', balance: '25.02000000' }],
  )
  assert.equal(merged.currency, 'CNY')
  close(merged.toppedUp, 17.22136104)
  close(merged.granted, 25.02)
  close(merged.total, 42.24136104)

  const multiple = mergeAccountWallets(
    [{ currency: 'CNY', total_balance: 10 }, { currency: 'CNY', amount: 2.5 }],
    [{ currency: 'CNY', balance: '1.5' }],
  )
  close(multiple.toppedUp, 12.5)
  close(multiple.granted, 1.5)
  close(multiple.total, 14)

  assert.deepEqual(mergeAccountWallets(undefined, null), { currency: '', toppedUp: 0, granted: 0, total: 0 })

  const usd = mergeAccountWallets([{ currency: 'USD', balance: 5 }], [{ currency: 'USD', balance: 1 }])
  assert.equal(usd.currency, 'USD')
  close(usd.total, 6)
})

/* --------------------------------------------------------------- handler */

test('handler rejects non-GET and malformed session ids', async () => {
  const { ctx } = fakeCtx({ state: ledgerState() })
  const handler = createBillingHandler({ ctx })

  const post = await call(handler, '/furina-theme/api/billing', 'POST')
  assert.equal(post.statusCode, 405)
  assert.equal(post.headers.allow, 'GET, HEAD')

  const bad = await call(handler, '/furina-theme/api/billing?session=nope')
  assert.equal(bad.statusCode, 400)
  assert.equal(bad.json().error, 'invalid-session')
})

test('handler reports a real ledger snapshot with USD->CNY costs', async () => {
  const billing = {
    totalTurns: 2,
    turns: [
      { sessionId: 'session-11111111-1111-1111-1111-111111111111', turn: 1, calls: 1, input: 5, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0.0001, apiCost: 0.0001 },
      { sessionId: SESSION, turn: 7, calls: 3, input: 900, output: 400, cacheRead: 6000, cacheWrite: 0, reasoning: 20, cost: 0.02, apiCost: 0.02 },
    ],
  }
  const { ctx, calls } = fakeCtx({ state: ledgerState(), billing })
  const handler = createBillingHandler({ ctx })

  const response = await call(handler, `/furina-theme/api/billing?session=${SESSION}`)
  assert.equal(response.statusCode, 200)
  const payload = response.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.currency, 'CNY')
  assert.equal(payload.exchangeRate, 7.2)
  assert.equal(payload.costMeter.available, true)

  assert.equal(payload.balance.available, true)
  close(payload.balance.total, 42.24)
  close(payload.balance.granted, 9.44)

  assert.equal(payload.today.available, true)
  assert.equal(payload.today.calls, 4)
  assert.equal(payload.today.tokens.input, 1200)
  assert.equal(payload.today.tokens.cacheRead, 4000)
  close(payload.today.cacheHitRate, 4000 / 5500)
  close(payload.today.apiCost.usd, 0.009)
  close(payload.today.apiCost.cny, 0.009 * 7.2)
  close(payload.today.cost.usd, 0.012)
  assert.equal(payload.today.includesPlan, true)

  assert.equal(payload.turn.available, true, 'latest turn with calls is selected, sub-agent turn ignored')
  assert.equal(payload.turn.turn, 7)
  assert.equal(payload.turn.sessionId, SESSION)
  assert.equal(payload.turn.calls, 3)
  close(payload.turn.apiCost.cny, 0.02 * 7.2)

  assert.equal(payload.meta.dayKey, '2026-10-22')
  assert.equal(payload.meta.timezone, 'Asia/Shanghai')
  assert.equal(calls.billing.length, 1)

  /* Same session within the TTL is served from cache; fresh=1 forces a refresh. */
  await call(handler, `/furina-theme/api/billing?session=${SESSION}`)
  assert.equal(calls.state, 1, 'cached request does not re-read the ledger')
  await call(handler, `/furina-theme/api/billing?session=${SESSION}&fresh=1`)
  assert.equal(calls.state, 2)
})

test('handler pages to the newest 25 turns when a session is long', async () => {
  const turns = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => ({
    sessionId: SESSION,
    turn: from + index,
    calls: 1,
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0.001,
    apiCost: 0.001,
  }))
  const billing = (query) => {
    if (query.turnOffset === undefined) return { totalTurns: 30, turns: turns(1, 25) }
    return { totalTurns: 30, turnOffset: query.turnOffset, turns: turns(6, 30) }
  }
  const { ctx, calls } = fakeCtx({ state: ledgerState(), billing })
  const handler = createBillingHandler({ ctx })

  const payload = (await call(handler, `/furina-theme/api/billing?session=${SESSION}`)).json()
  assert.equal(payload.turn.available, true)
  assert.equal(payload.turn.turn, 30)
  assert.equal(calls.billing.length, 2)
  assert.equal(calls.billing[1].turnOffset, 5)

  const shortSession = 'session-22222222-2222-2222-2222-222222222222'
  const empty = await call(createBillingHandler({
    ctx: fakeCtx({
      state: ledgerState(),
      billing: { totalTurns: 0, turns: [] },
    }).ctx,
  }), `/furina-theme/api/billing?session=${shortSession}`)
  const emptyPayload = empty.json()
  assert.equal(emptyPayload.turn.available, false)
  assert.equal(emptyPayload.turn.reason, 'no-usage')
})

test('handler falls back to deepseekAccount and merges bonus wallets', async () => {
  const account = {
    value: [{ currency: 'CNY', balance: '17.22136104' }],
    bonusWallets: [{ currency: 'CNY', balance: '25.02' }],
  }
  const { ctx, calls } = fakeCtx({ meter: false, account })
  const handler = createBillingHandler({ ctx })

  const payload = (await call(handler, `/furina-theme/api/billing?session=${SESSION}`)).json()
  assert.equal(payload.ok, true)
  assert.equal(payload.costMeter.available, false)
  assert.equal(payload.costMeter.reason, 'cost-meter-unavailable')
  assert.equal(payload.balance.source, 'deepseekAccount')
  assert.equal(payload.balance.available, true)
  close(payload.balance.total, 42.24136104)
  close(payload.balance.granted, 25.02)
  assert.equal(payload.today.available, false)
  assert.equal(payload.today.reason, 'cost-meter-unavailable')
  assert.equal(payload.turn.available, false)
  assert.equal(payload.turn.reason, 'cost-meter-unavailable')
  assert.equal(calls.balance, 1)
})

test('handler is honest when the ledger has no usage, and a real zero stays zero', async () => {
  const noUsage = ledgerState({ today: { date: '2026-10-22', calls: 0 } })
  const first = (await call(createBillingHandler({ ctx: fakeCtx({ state: noUsage }).ctx }))).json()
  assert.equal(first.today.available, false)
  assert.equal(first.today.reason, 'no-usage')
  assert.equal(first.today.tokens, null)

  const zero = ledgerState({
    today: { date: '2026-10-22', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0 },
    balance: { status: 'off', message: 'balance display is off' },
  })
  const second = (await call(createBillingHandler({ ctx: fakeCtx({ state: zero }).ctx }))).json()
  assert.equal(second.today.available, true)
  assert.equal(second.today.calls, 0)
  assert.deepEqual(second.today.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
  assert.equal(second.balance.available, false)
  assert.equal(second.balance.reason, 'balance-disabled')
  assert.equal(second.balance.total, null)
})

test('handler degrades to balance fallback when getState throws', async () => {
  const account = { value: [{ currency: 'CNY', balance: 10 }], bonusWallets: [] }
  const { ctx } = fakeCtx({
    state: () => { throw new Error('ledger exploded') },
    account,
  })
  const payload = (await call(createBillingHandler({ ctx }))).json()
  assert.equal(payload.costMeter.available, false)
  assert.equal(payload.costMeter.reason, 'state-unavailable')
  assert.match(payload.costMeter.message, /ledger exploded/)
  assert.equal(payload.today.available, false)
  assert.equal(payload.today.reason, 'state-unavailable')
  assert.equal(payload.balance.available, true)
  close(payload.balance.total, 10)
})

test('handler without any service still answers an honest document', async () => {
  const payload = (await call(createBillingHandler({ ctx: fakeCtx({ meter: false }).ctx }))).json()
  assert.equal(payload.ok, true)
  assert.equal(payload.balance.available, false)
  assert.equal(payload.balance.total, null)
  assert.equal(payload.today.available, false)
  assert.equal(payload.turn.reason, 'no-session')
  assert.equal(payload.meta.dayKey.length, 10)
  assert.equal(payload.meta.monthKey.length, 7)
})

test('handler reports turn-unavailable when the session detail call fails', async () => {
  const billing = () => { throw new Error('session log unreadable') }
  const payload = (await call(createBillingHandler({
    ctx: fakeCtx({ state: ledgerState(), billing }).ctx,
  }), `/furina-theme/api/billing?session=${SESSION}`)).json()
  assert.equal(payload.turn.available, false)
  assert.equal(payload.turn.reason, 'turn-unavailable')
})
