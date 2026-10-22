/**
 * Host half of the Furina billing panel ("电力储备" / POWER RESERVE).
 *
 * The browser half (`client/billing.js`) asks this endpoint for one small JSON
 * document; nothing here is visual. Three sources feed it:
 *
 *  1. `costMeter` (dsh-cost-meter) — the authoritative ledger. `getState()`
 *     gives today's token/cost totals plus the account balance it already
 *     reconciles, and `getSessionBilling({ sessionId })` replays the current
 *     session's log so the latest turn can be shown separately.
 *  2. `deepseekAccount` — a fallback balance read, used only when cost-meter is
 *     absent. Bonus wallets are merged in on purpose: this package exists partly
 *     because the reference theme dropped `bonusWallets` from the displayed
 *     reserve.
 *  3. Nothing else. No credentials are read here, no request is made from this
 *     module; the injected services own all of that.
 *
 * Honesty rules (the panel renders `available:false` + `reason`, never a fake
 * zero):
 *  - missing cost-meter   → today/turn unavailable, balance may still be read
 *  - ledger stats missing → unavailable, not 0 tokens
 *  - a real zero (no calls today) stays a real 0 with `calls: 0`
 *  - costs are USD in the ledger; `exchangeRate` converts for display only
 *
 * The endpoint is registered by `lib/index.js`, which already enforces
 * same-origin on this route and answers 503 when this module cannot load.
 */

const DEFAULT_EXCHANGE_RATE = 7.2
const CACHE_TTL_MS = 10_000
const STATE_TIMEOUT_MS = 12_000
const TURN_TIMEOUT_MS = 12_000
const MAX_REASON_MESSAGE = 240

/** The DSH session ids the browser half is allowed to ask about. */
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Billing bucket order shared with dsh-cost-meter's STAT_FIELDS. */
const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']

/** True when `value` is a well-formed DSH session id. */
export function isSessionId (value) {
  return typeof value === 'string' && SESSION_ID.test(value)
}

function finite (value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function pad (value) {
  return String(value).padStart(2, '0')
}

/** `YYYY-MM-DD` in the host timezone, matching cost-meter's day keys. */
function dayKeyOf (date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthKeyOf (date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function messageOf (error) {
  const text = error && typeof error.message === 'string' ? error.message : String(error ?? '')
  return text.length > MAX_REASON_MESSAGE ? `${text.slice(0, MAX_REASON_MESSAGE)}…` : text
}

function withTimeout (promise, ms, label) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer))
}

/**
 * Read one host service defensively.
 *
 * `ctx.get()` throws for an unknown service in some cordis configurations, so
 * absence is a normal outcome here, not an error.
 */
function serviceOf (ctx, name) {
  if (!ctx || typeof ctx.get !== 'function') return null
  try {
    return ctx.get(name) ?? null
  } catch {
    return null
  }
}

/* TEMPORARY probe — removed after the service-resolution check. */
function serviceProbe (ctx) {
  const out = { get: typeof ctx?.get, inject: typeof ctx?.inject }
  try { out.keys = ctx && typeof ctx === 'object' ? Object.keys(ctx).slice(0, 40) : [] } catch { out.keys = 'throw' }
  for (const name of ['costMeter', 'cost-meter', 'deepseekAccount', 'webServer', 'sessions']) {
    try {
      const value = ctx?.get?.(name)
      out[name] = value === null || value === undefined ? String(value) : typeof value
    } catch (error) {
      out[name] = 'throw:' + (error && error.message ? error.message : String(error))
    }
  }
  return out
}

/** USD ledger amount -> display amount; both sides are kept in the payload. */
function money (usd, rate) {
  const value = finite(usd)
  if (value === null) return null
  return { usd: value, cny: value * rate }
}

/** Normalize one ledger `stats` object (day aggregate or turn row). */
function statsOf (stats, rate) {
  if (stats === null || typeof stats !== 'object' || Array.isArray(stats)) return null
  const tokens = {}
  let seen = false
  for (const field of TOKEN_FIELDS) {
    const value = finite(stats[field])
    if (value !== null) seen = true
    tokens[field] = value ?? 0
  }
  if (!seen) return null
  const calls = finite(stats.calls)
  const cost = finite(stats.cost)
  const apiCost = finite(stats.apiCost)
  const counted = tokens.input + tokens.cacheRead + tokens.cacheWrite
  return {
    tokens,
    calls: calls ?? 0,
    cacheHitRate: counted > 0 ? tokens.cacheRead / counted : null,
    cost: money(cost ?? apiCost, rate),
    apiCost: money(apiCost ?? cost, rate),
  }
}

/** True when the plan-equivalent total differs from hard API spend. */
function planEquivalent (stats) {
  if (stats === null || typeof stats !== 'object') return false
  const cost = finite(stats.cost)
  const apiCost = finite(stats.apiCost)
  if (cost === null || apiCost === null) return false
  return Math.abs(cost - apiCost) > 1e-9
}

/**
 * Balance as delivered by dsh-cost-meter's `getState()`.
 *
 * `status` is `ok` | `off` | `error`; only `ok` carries a real figure. A
 * disabled or failed lookup must not be presented as a zero balance.
 */
export function normalizeBalance (raw) {
  const status = raw && typeof raw === 'object' && typeof raw.status === 'string' ? raw.status : ''
  const message = raw && typeof raw.message === 'string' ? raw.message : ''
  if (status !== 'ok') {
    const reason = status === 'off' ? 'balance-disabled' : status === 'error' ? 'balance-error' : 'balance-unavailable'
    return {
      available: false,
      reason,
      message: message.length > MAX_REASON_MESSAGE ? `${message.slice(0, MAX_REASON_MESSAGE)}…` : message,
      status: status || 'unknown',
      currency: '',
      total: null,
      toppedUp: null,
      granted: null,
      updatedAt: null,
      source: 'cost-meter',
    }
  }
  const total = finite(raw.totalBalance)
  if (total === null) {
    return {
      available: false,
      reason: 'balance-unavailable',
      message,
      status,
      currency: '',
      total: null,
      toppedUp: null,
      granted: null,
      updatedAt: null,
      source: 'cost-meter',
    }
  }
  const currency = typeof raw.currency === 'string' && raw.currency.trim() !== ''
    ? raw.currency.trim().toUpperCase()
    : ''
  const fetchedAt = finite(raw.fetchedAt)
  return {
    available: true,
    reason: null,
    message,
    status,
    currency,
    total,
    toppedUp: finite(raw.toppedUpBalance),
    granted: finite(raw.grantedBalance),
    updatedAt: fetchedAt !== null && fetchedAt > 0 ? new Date(fetchedAt).toISOString() : null,
    source: 'cost-meter',
  }
}

/**
 * Merge the account service's wallet lists into one spendable reserve.
 *
 * The reference implementation ("endfield") read `value` only and explicitly
 * skipped `bonusWallets`, so granted credit never reached the gauge. This panel
 * must show the full reserve, so normal + granted wallets are summed per
 * currency and CNY is preferred (Chinese-language client, DeepSeek accounts are
 * normally CNY).
 *
 * Exported so the unit tests can pin the bug fix without a live account.
 */
export function mergeAccountWallets (value, bonusWallets) {
  const totalsOf = (list) => {
    const totals = new Map()
    if (!Array.isArray(list)) return totals
    for (const wallet of list) {
      if (wallet === null || typeof wallet !== 'object') continue
      /* Wallets appear as {currency, balance} on the account service and as
         {currency, total_balance} in some payloads; accept both spellings. */
      const amount = finite(wallet.balance ?? wallet.amount ?? wallet.total ?? wallet.total_balance)
      if (amount === null) continue
      const currency = typeof wallet.currency === 'string' ? wallet.currency.trim().toUpperCase() : ''
      totals.set(currency, (totals.get(currency) ?? 0) + amount)
    }
    return totals
  }
  const normal = totalsOf(value)
  const bonus = totalsOf(bonusWallets)
  const currencies = [...new Set([...normal.keys(), ...bonus.keys()])]
  const currency = currencies.includes('CNY')
    ? 'CNY'
    : currencies.includes('USD')
      ? 'USD'
      : currencies[0] ?? ''
  const toppedUp = normal.get(currency) ?? 0
  const granted = bonus.get(currency) ?? 0
  return { currency, toppedUp, granted, total: toppedUp + granted }
}

/** Balance fallback for profiles where cost-meter is not mounted. */
async function balanceFromAccount (ctx) {
  const account = serviceOf(ctx, 'deepseekAccount')
  if (!account || typeof account.getBalance !== 'function') return null
  let details
  try {
    details = await withTimeout(account.getBalance({
      version: '',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    }), STATE_TIMEOUT_MS, 'deepseekAccount.getBalance')
  } catch {
    return null
  }
  const merged = mergeAccountWallets(details?.value, details?.bonusWallets)
  if (merged.currency === '' && merged.total === 0) return null
  return {
    available: true,
    reason: null,
    message: '',
    status: 'ok',
    currency: merged.currency,
    total: merged.total,
    toppedUp: merged.toppedUp,
    granted: merged.granted,
    updatedAt: new Date().toISOString(),
    source: 'deepseekAccount',
  }
}

function unavailableToday (reason, message = '') {
  return {
    available: false,
    reason,
    message,
    date: dayKeyOf(),
    calls: null,
    tokens: null,
    cacheHitRate: null,
    cost: null,
    apiCost: null,
    includesPlan: false,
  }
}

function unavailableTurn (reason, sessionId, message = '') {
  return {
    available: false,
    reason,
    message,
    sessionId: sessionId ?? null,
    turn: null,
    calls: null,
    tokens: null,
    cacheHitRate: null,
    cost: null,
    apiCost: null,
    includesPlan: false,
  }
}

function todayFrom (day, rate) {
  const stats = statsOf(day, rate)
  if (stats === null) return unavailableToday('no-usage')
  return {
    available: true,
    reason: null,
    message: '',
    date: typeof day.date === 'string' ? day.date : dayKeyOf(),
    calls: stats.calls,
    tokens: stats.tokens,
    cacheHitRate: stats.cacheHitRate,
    cost: stats.cost,
    apiCost: stats.apiCost,
    includesPlan: planEquivalent(day),
  }
}

function turnFrom (turn, rate, sessionId) {
  const stats = statsOf(turn, rate)
  if (stats === null) return unavailableTurn('no-usage', sessionId)
  return {
    available: true,
    reason: null,
    message: '',
    sessionId,
    turn: Number.isInteger(turn.turn) ? turn.turn : null,
    calls: stats.calls,
    tokens: stats.tokens,
    cacheHitRate: stats.cacheHitRate,
    cost: stats.cost,
    apiCost: stats.apiCost,
    includesPlan: planEquivalent(turn),
  }
}

/**
 * The latest turn of the given session that has billable calls.
 *
 * `getSessionBilling` returns at most 25 turns per page, sorted by session and
 * then turn; when the session is longer, only the last page can hold the answer,
 * so a second request is made with the matching `turnOffset`. Sub-agent turns
 * are filtered out: "本轮" means this conversation's turn, not the last thing a
 * delegated agent did.
 */
async function latestTurn (costMeter, sessionId, rate) {
  let detail
  try {
    detail = await withTimeout(costMeter.getSessionBilling({ sessionId }), TURN_TIMEOUT_MS, 'getSessionBilling')
  } catch (error) {
    return unavailableTurn('turn-unavailable', sessionId, messageOf(error))
  }
  if (detail === null || typeof detail !== 'object') return unavailableTurn('turn-unavailable', sessionId)
  let turns = Array.isArray(detail.turns) ? detail.turns : []
  const totalTurns = finite(detail.totalTurns) ?? turns.length
  if (totalTurns > turns.length && totalTurns > 25) {
    try {
      const last = await withTimeout(costMeter.getSessionBilling({
        sessionId,
        turnOffset: Math.max(0, totalTurns - 25),
      }), TURN_TIMEOUT_MS, 'getSessionBilling(tail)')
      if (last !== null && typeof last === 'object' && Array.isArray(last.turns) && last.turns.length > 0) {
        turns = last.turns
      }
    } catch {
      /* keep the first page; the panel will say no-usage instead of inventing a turn */
    }
  }
  const mine = turns
    .filter((turn) => turn !== null && typeof turn === 'object' && turn.sessionId === sessionId)
    .filter((turn) => (finite(turn.calls) ?? 0) > 0)
  if (mine.length === 0) return unavailableTurn('no-usage', sessionId)
  return turnFrom(mine[mine.length - 1], rate, sessionId)
}

function baseMeta (state) {
  const now = Date.now()
  const meta = state && typeof state === 'object' && state.meta && typeof state.meta === 'object' ? state.meta : {}
  const timezone = typeof meta.timezone === 'string' ? meta.timezone : ''
  const offset = finite(meta.timezoneOffsetMinutes)
  return {
    now,
    dayKey: typeof meta.dayKey === 'string' ? meta.dayKey : dayKeyOf(),
    monthKey: typeof meta.monthKey === 'string' ? meta.monthKey : monthKeyOf(),
    timezone,
    timezoneOffsetMinutes: offset ?? -new Date().getTimezoneOffset(),
    host: 'dsh',
  }
}

/** Assemble one billing document. Never throws; every failure becomes a reason. */
async function collect (ctx, sessionId) {
  const generatedAt = new Date().toISOString()
  const payload = {
    ok: true,
    generatedAt,
    currency: 'CNY',
    exchangeRate: DEFAULT_EXCHANGE_RATE,
    balance: {
      available: false,
      reason: 'balance-unavailable',
      message: '',
      status: 'unknown',
      currency: '',
      total: null,
      toppedUp: null,
      granted: null,
      updatedAt: null,
      source: 'none',
    },
    today: unavailableToday('cost-meter-unavailable'),
    turn: sessionId ? unavailableTurn('cost-meter-unavailable', sessionId) : unavailableTurn('no-session', null),
    meta: baseMeta(null),
    costMeter: { available: false, reason: 'cost-meter-unavailable' },
  }

  const costMeter = serviceOf(ctx, 'costMeter')
  if (costMeter === null || typeof costMeter.getState !== 'function') {
    payload.costMeter.diag = serviceProbe(ctx)
    const fallback = await balanceFromAccount(ctx)
    if (fallback !== null) payload.balance = fallback
    return payload
  }

  let state = null
  let stateError = null
  try {
    state = await withTimeout(costMeter.getState(), STATE_TIMEOUT_MS, 'costMeter.getState')
  } catch (error) {
    stateError = messageOf(error)
  }

  if (state !== null && typeof state === 'object') {
    const rate = finite(state.config?.exchangeRate)
    payload.exchangeRate = rate !== null && rate > 0 ? rate : DEFAULT_EXCHANGE_RATE
    payload.costMeter = { available: true, reason: null }
    payload.balance = normalizeBalance(state.balance)
    payload.today = todayFrom(state.today, payload.exchangeRate)
    payload.meta = baseMeta(state)
  } else {
    payload.costMeter = { available: false, reason: 'state-unavailable', message: stateError ?? '' }
    payload.today = unavailableToday('state-unavailable', stateError ?? '')
    const fallback = await balanceFromAccount(ctx)
    if (fallback !== null) payload.balance = fallback
  }

  if (sessionId) {
    payload.turn = await latestTurn(costMeter, sessionId, payload.exchangeRate)
  }
  return payload
}

function sendJson (request, response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  response.end(request.method === 'HEAD' ? undefined : text)
}

/**
 * Build the `/furina-theme/api/billing` handler.
 *
 * @param {{ctx?: unknown, home?: string}} [options]
 *   `ctx` is the webServer-injected cordis context handed over by
 *   `lib/index.js`; `home` is accepted for symmetry and is unused today.
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<void>}
 */
export function createBillingHandler (options = {}) {
  const ctx = options.ctx ?? null
  let cache = { key: null, at: 0, value: null }
  const inflight = new Map()

  return async function billingHandler (request, response) {
    try {
      const method = typeof request.method === 'string' ? request.method : 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
        response.end()
        return
      }

      let url
      try {
        url = new URL(typeof request.url === 'string' ? request.url : '/', 'http://dsh.invalid')
      } catch {
        sendJson(request, response, 400, { ok: false, error: 'bad-request' })
        return
      }
      const rawSession = url.searchParams.get('session') ?? ''
      if (rawSession !== '' && !isSessionId(rawSession)) {
        sendJson(request, response, 400, { ok: false, error: 'invalid-session' })
        return
      }
      const sessionId = rawSession === '' ? null : rawSession
      const fresh = url.searchParams.get('fresh') === '1'
      const key = sessionId ?? ''
      let payload
      if (!fresh && cache.key === key && cache.value !== null && Date.now() - cache.at < CACHE_TTL_MS) {
        payload = cache.value
      } else {
        let flight = inflight.get(key)
        if (flight === undefined) {
          flight = collect(ctx, sessionId)
            .catch((error) => ({
              ok: false,
              error: 'billing-failed',
              message: messageOf(error),
              generatedAt: new Date().toISOString(),
            }))
            .finally(() => inflight.delete(key))
          inflight.set(key, flight)
        }
        payload = await flight
        cache = { key, at: Date.now(), value: payload }
      }
      sendJson(request, response, 200, payload)
    } catch (error) {
      try {
        sendJson(request, response, 500, { ok: false, error: 'billing-failed', message: messageOf(error) })
      } catch {
        /* headers already sent */
      }
    }
  }
}
