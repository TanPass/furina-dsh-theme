/**
 * Furina theme — billing panel browser half (电力储备 / POWER RESERVE).
 *
 * Self-mounting, like `client/theme.js`: the host page only appends this script
 * and this file owns everything from there. It is deliberately independent of
 * the theme script so a billing failure never takes the theme down (and the
 * other way around); the host endpoint answers 503 when `lib/billing.js` is
 * missing, and this panel then hides completely instead of showing fake zeros.
 *
 * Layout: `[data-slot="sidebar"]` is `display: contents`, so it is not a box.
 * The panel is therefore `position: fixed` and anchored to the measured left
 * edge of the conversation column (`--fr-col-left`), exactly the trick the
 * reference theme uses; a child appended into the sidebar would lay out
 * somewhere else.
 *
 * Data: GET /furina-theme/api/billing?session=<current session>. The reply is
 * the document built by `lib/billing.js`; this file only formats it. Missing
 * values (`available:false`) render as "—" plus a Chinese reason, never as 0.
 */
(function () {
  'use strict'

  if (window.__furinaBilling) return
  window.__furinaBilling = true

  var ROUTE = '/furina-theme'
  var ENDPOINT = ROUTE + '/api/billing'
  var CSS_HREF = ROUTE + '/billing.css'
  var POLL_MS = 60000
  var HIDDEN_RETRY_MS = 300000
  var SESSION_RE = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  /** Gauge full scale (CNY). Display only — the exact figure is always printed. */
  var GAUGE_FULL = 100
  var LOW_AT = 10

  var doc = document
  var state = {
    root: null,
    timer: null,
    retryTimer: null,
    hidden: false,
    expanded: false,
    data: null,
    fetching: false,
    lastFetch: 0,
    column: null,
    columnObserver: null,
    session: '',
  }

  var REASONS = {
    'cost-meter-unavailable': '未启用 cost-meter 账本',
    'state-unavailable': '账本状态读取失败',
    'no-usage': '尚无计费记录',
    'turn-unavailable': '本轮明细读取失败',
    'no-session': '未选择会话',
    'balance-disabled': '余额查询已关闭',
    'balance-error': '余额查询失败',
    'balance-unavailable': '余额不可用',
  }

  function reasonText (reason) {
    if (typeof reason !== 'string' || reason === '') return '暂无数据'
    return REASONS[reason] || '暂无数据'
  }

  /* ------------------------------------------------------------------ helpers */

  function currentSessionId () {
    try {
      var raw = window.localStorage.getItem('dsh.sessions.current')
      if (raw) {
        var parsed = JSON.parse(raw)
        var id = parsed && parsed.sessionId
        if (typeof id === 'string' && SESSION_RE.test(id)) return id
      }
    } catch (error) {
      /* storage can be unavailable in hardened contexts */
    }
    var selectors = ['[data-conversation-session]', '[data-dsh-fairy-selected-session]']
    for (var i = 0; i < selectors.length; i++) {
      var node = doc.querySelector(selectors[i])
      if (node === null) continue
      var value = node.getAttribute(selectors[i].slice(1, -1))
      if (typeof value === 'string' && SESSION_RE.test(value)) return value
    }
    var row = doc.querySelector('[data-row-key^="session:"]')
    if (row !== null) {
      var key = row.getAttribute('data-row-key') || ''
      var fromKey = key.slice('session:'.length)
      if (SESSION_RE.test(fromKey)) return fromKey
    }
    return ''
  }

  function symbolOf (currency) {
    if (currency === 'CNY') return '¥'
    if (currency === 'USD') return '$'
    if (currency === 'EUR') return '€'
    return ''
  }

  function fixed (value, digits) {
    var number = typeof value === 'number' ? value : Number(value)
    if (!isFinite(number)) return null
    return number.toFixed(digits)
  }

  function formatMoney (value) {
    var number = typeof value === 'number' ? value : Number(value)
    if (!isFinite(number)) return '—'
    var abs = Math.abs(number)
    var digits = abs > 0 && abs < 0.01 ? 4 : abs < 1 ? 3 : 2
    return '¥' + number.toFixed(digits)
  }

  function formatAmount (value, currency) {
    var number = typeof value === 'number' ? value : Number(value)
    if (!isFinite(number)) return '—'
    var body = number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return symbolOf(currency) + body
  }

  function formatTokens (value) {
    var number = typeof value === 'number' ? value : Number(value)
    if (!isFinite(number)) return '—'
    return number.toLocaleString('zh-CN')
  }

  function percent (rate) {
    if (typeof rate !== 'number' || !isFinite(rate)) return ''
    /* One decimal keeps a 99.6% hit rate from being rounded up to a claim of 100%. */
    return (Math.round(rate * 1000) / 10).toFixed(1).replace(/\.0$/u, '') + '%'
  }

  function setText (root, selector, text) {
    var node = root.querySelector(selector)
    if (node !== null) node.textContent = text
  }

  function setTokenCells (section, tokens) {
    var fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']
    for (var i = 0; i < fields.length; i++) {
      var node = section.querySelector('[data-token="' + fields[i] + '"]')
      if (node === null) continue
      node.textContent = tokens && typeof tokens === 'object' ? formatTokens(tokens[fields[i]]) : '—'
    }
  }

  /* ------------------------------------------------------------------- styles */

  function ensureStyles () {
    if (doc.querySelector('link[data-furina-billing-css]') !== null) return
    var link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = CSS_HREF
    link.setAttribute('data-furina-billing-css', '1')
    doc.head.appendChild(link)
  }

  /* ---------------------------------------------------------------- structure */

  function buildRoot () {
    var root = doc.createElement('div')
    root.id = 'furina-billing'
    root.className = 'fr-bill'
    root.setAttribute('data-state', 'loading')
    root.innerHTML = [
      '<div class="fr-bill__head">',
      '  <span class="fr-bill__title">电力储备</span>',
      '  <i class="fr-bill__en">POWER RESERVE</i>',
      '  <button class="fr-bill__refresh" type="button" title="刷新账单" aria-label="刷新账单">⟳</button>',
      '</div>',
      '<div class="fr-bill__figure-row">',
      '  <b class="fr-bill__figure">——</b>',
      '  <span class="fr-bill__cur"></span>',
      '  <span class="fr-bill__caption">SYNCING</span>',
      '</div>',
      '<div class="fr-bill__meter"><u class="fr-bill__fill"></u><b class="fr-bill__ticks"></b></div>',
      '<div class="fr-bill__wallet" hidden></div>',
      '<button class="fr-bill__toggle" type="button" aria-expanded="false">',
      '  <span>本轮 / 今日明细</span><i class="fr-bill__chevron">▸</i>',
      '</button>',
      '<div class="fr-bill__detail" hidden>',
      '  <section class="fr-bill__block" data-kind="turn">',
      '    <header class="fr-bill__block-head"><span class="fr-bill__block-name">本轮</span>',
      '      <b class="fr-bill__block-cost">—</b></header>',
      '    <div class="fr-bill__sub"></div>',
      '    <dl class="fr-bill__tokens">',
      '      <div><dt>输入</dt><dd data-token="input">—</dd></div>',
      '      <div><dt>输出</dt><dd data-token="output">—</dd></div>',
      '      <div><dt>缓存命中</dt><dd data-token="cacheRead">—</dd></div>',
      '      <div><dt>缓存写入</dt><dd data-token="cacheWrite">—</dd></div>',
      '      <div><dt>推理</dt><dd data-token="reasoning">—</dd></div>',
      '    </dl>',
      '  </section>',
      '  <section class="fr-bill__block" data-kind="today">',
      '    <header class="fr-bill__block-head"><span class="fr-bill__block-name">今日</span>',
      '      <b class="fr-bill__block-cost">—</b></header>',
      '    <div class="fr-bill__sub"></div>',
      '    <dl class="fr-bill__tokens">',
      '      <div><dt>输入</dt><dd data-token="input">—</dd></div>',
      '      <div><dt>输出</dt><dd data-token="output">—</dd></div>',
      '      <div><dt>缓存命中</dt><dd data-token="cacheRead">—</dd></div>',
      '      <div><dt>缓存写入</dt><dd data-token="cacheWrite">—</dd></div>',
      '      <div><dt>推理</dt><dd data-token="reasoning">—</dd></div>',
      '    </dl>',
      '  </section>',
      '</div>',
      '<p class="fr-bill__note">费用由 dsh-cost-meter 账本估算，非官方账单</p>',
    ].join('\n')

    root.querySelector('.fr-bill__refresh').addEventListener('click', function () {
      refresh(true)
    })
    root.querySelector('.fr-bill__toggle').addEventListener('click', function () {
      toggleDetail(!state.expanded)
    })
    return root
  }

  function toggleDetail (open) {
    state.expanded = Boolean(open)
    if (state.root === null) return
    var detail = state.root.querySelector('.fr-bill__detail')
    var toggle = state.root.querySelector('.fr-bill__toggle')
    if (detail !== null) detail.hidden = !state.expanded
    if (toggle !== null) {
      toggle.setAttribute('aria-expanded', state.expanded ? 'true' : 'false')
      var chevron = toggle.querySelector('.fr-bill__chevron')
      if (chevron !== null) chevron.textContent = state.expanded ? '▾' : '▸'
    }
    if (state.expanded && state.root !== null) state.root.classList.add('is-expanded')
    else if (state.root !== null) state.root.classList.remove('is-expanded')
  }

  /* ------------------------------------------------------------------ layout */

  function measure () {
    var root = state.root
    if (root === null || root.parentNode === null) return
    var column = doc.querySelector('[class*="centerCol"], [data-slot="main"]')
    if (column !== state.column) {
      state.column = column
      if (state.columnObserver !== null) {
        state.columnObserver.disconnect()
        state.columnObserver = null
      }
      if (typeof ResizeObserver === 'function' && column !== null) {
        state.columnObserver = new ResizeObserver(measure)
        state.columnObserver.observe(column)
      }
    }
    var left = 258
    if (column !== null) {
      var rect = column.getBoundingClientRect()
      if (rect.width > 0) left = rect.left
    }
    root.style.setProperty('--fr-col-left', Math.round(left) + 'px')

    /* Anchor above the account chip: the footer bar paints over the panel's
       lower edge when it is positioned too close to the viewport bottom, so the
       offset is measured from the footer slot instead of hardcoded. */
    var footer = doc.querySelector('[data-slot="sidebar.footer.action"]')
    var bottom = 64
    if (footer !== null) {
      var footerRect = footer.getBoundingClientRect()
      if (footerRect.height > 0) {
        bottom = Math.max(64, Math.round(window.innerHeight - footerRect.top) + 10)
      }
    }
    root.style.setProperty('--fr-bill-bottom', bottom + 'px')

    var collapsed = left < 160 || window.innerWidth < 720
    root.setAttribute('data-collapsed', collapsed ? 'true' : 'false')
  }

  function ensureRoot () {
    if (state.hidden) return null
    if (state.root !== null && state.root.parentNode !== null) return state.root
    ensureStyles()
    /* A shell re-render can drop the panel while our reference survives. */
    var existing = doc.getElementById('furina-billing')
    if (existing !== null) {
      state.root = existing
      measure()
      return existing
    }
    var root = buildRoot()
    /* The card is fixed, but anchoring it above the account row keeps it in the
       sidebar's accessibility tree and survives sidebar re-renders with it. */
    var footer = doc.querySelector('[data-slot="sidebar.footer.action"]')
    if (footer !== null && footer.parentNode !== null) {
      footer.parentNode.insertBefore(root, footer)
    } else {
      var sidebar = doc.querySelector('[data-slot="sidebar"]')
      var host = sidebar !== null ? sidebar : doc.body
      if (host === null) return null
      host.appendChild(root)
    }
    state.root = root
    measure()
    return root
  }

  /* ------------------------------------------------------------------- render */

  function balanceState (balance) {
    var total = balance && typeof balance.total === 'number' ? balance.total : null
    if (total === null) return 'unknown'
    if (total <= 0) return 'empty'
    return total < LOW_AT ? 'low' : 'nominal'
  }

  function render (data) {
    var root = ensureRoot()
    if (root === null) return
    state.data = data

    var balance = data.balance && typeof data.balance === 'object' ? data.balance : null
    var figure = root.querySelector('.fr-bill__figure')
    var cur = root.querySelector('.fr-bill__cur')
    var caption = root.querySelector('.fr-bill__caption')
    var fill = root.querySelector('.fr-bill__fill')
    var wallet = root.querySelector('.fr-bill__wallet')

    if (balance !== null && balance.available === true) {
      var total = typeof balance.total === 'number' ? balance.total : null
      var level = balanceState(balance)
      root.setAttribute('data-state', level)
      if (figure !== null) figure.textContent = formatAmount(total, balance.currency)
      if (cur !== null) cur.textContent = ''
      if (caption !== null) {
        caption.textContent = level === 'empty' ? 'DEPLETED' : level === 'low' ? 'OUTPUT LOW' : 'NOMINAL'
      }
      if (fill !== null) {
        var ratio = total === null ? 0 : Math.max(0, Math.min(1, total / GAUGE_FULL))
        fill.style.transform = 'scaleX(' + ratio.toFixed(4) + ')'
      }
      var walletParts = []
      if (typeof balance.toppedUp === 'number') walletParts.push('充值 ' + formatAmount(balance.toppedUp, balance.currency))
      if (typeof balance.granted === 'number') walletParts.push('赠送 ' + formatAmount(balance.granted, balance.currency))
      if (wallet !== null) {
        wallet.textContent = walletParts.join(' · ')
        wallet.hidden = walletParts.length === 0
        wallet.classList.toggle('is-bonus', typeof balance.granted === 'number' && balance.granted > 0)
        wallet.title = '储备 = 充值 + 赠送'
      }
    } else {
      var reason = balance !== null ? balance.reason : 'balance-unavailable'
      root.setAttribute('data-state', 'unknown')
      if (figure !== null) figure.textContent = '——'
      if (cur !== null) cur.textContent = ''
      if (caption !== null) caption.textContent = reason === 'balance-disabled' ? 'BALANCE OFF' : 'NO SIGNAL'
      if (fill !== null) fill.style.transform = 'scaleX(0)'
      if (wallet !== null) {
        wallet.textContent = reasonText(reason)
        wallet.hidden = false
        wallet.classList.remove('is-bonus')
        wallet.title = ''
      }
    }

    renderBlock(root, 'turn', data.turn, '本轮')
    renderBlock(root, 'today', data.today, '今日')

    root.setAttribute('data-fresh', data.generatedAt || '')
    root.classList.remove('is-busy')
    state.fetching = false
  }

  function renderBlock (root, kind, block, label) {
    var section = root.querySelector('.fr-bill__block[data-kind="' + kind + '"]')
    if (section === null) return
    setText(section, '.fr-bill__block-name', label)
    var cost = section.querySelector('.fr-bill__block-cost')
    var sub = section.querySelector('.fr-bill__sub')
    if (block !== null && block.available === true) {
      var apiCost = block.apiCost && typeof block.apiCost.cny === 'number' ? block.apiCost.cny : null
      var planCost = block.cost && typeof block.cost.cny === 'number' ? block.cost.cny : null
      if (cost !== null) cost.textContent = formatMoney(apiCost)
      var parts = []
      if (block.calls !== null && block.calls !== undefined) parts.push(block.calls + ' 次调用')
      if (block.cacheHitRate !== null && block.cacheHitRate !== undefined) parts.push('命中 ' + percent(block.cacheHitRate))
      if (block.includesPlan && planCost !== null && apiCost !== null && planCost - apiCost > 0.00005) {
        parts.push('含 Plan ' + formatMoney(planCost))
      }
      if (sub !== null) sub.textContent = parts.join(' · ')
      setTokenCells(section, block.tokens)
      section.setAttribute('data-available', 'true')
    } else {
      if (cost !== null) cost.textContent = '—'
      if (sub !== null) sub.textContent = reasonText(block !== null ? block.reason : 'no-usage')
      setTokenCells(section, null)
      section.setAttribute('data-available', 'false')
    }
  }

  /* -------------------------------------------------------------------- fetch */

  function hideAndRetry () {
    state.hidden = true
    state.fetching = false
    if (state.timer !== null) {
      window.clearInterval(state.timer)
      state.timer = null
    }
    if (state.root !== null && state.root.parentNode !== null) {
      state.root.parentNode.removeChild(state.root)
    }
    state.root = null
    if (state.retryTimer !== null) window.clearTimeout(state.retryTimer)
    state.retryTimer = window.setTimeout(function () {
      state.retryTimer = null
      state.hidden = false
      refresh(true)
    }, HIDDEN_RETRY_MS)
  }

  function showError (reason) {
    var root = ensureRoot()
    if (root === null) return
    root.setAttribute('data-state', 'unknown')
    root.classList.remove('is-busy')
    var caption = root.querySelector('.fr-bill__caption')
    if (caption !== null) caption.textContent = 'NO SIGNAL'
    var wallet = root.querySelector('.fr-bill__wallet')
    if (wallet !== null) {
      wallet.textContent = reasonText(reason)
      wallet.hidden = false
    }
    state.fetching = false
  }

  function refresh (manual) {
    var root = ensureRoot()
    if (root === null) return
    if (state.fetching) return
    state.fetching = true
    root.classList.add('is-busy')
    state.session = currentSessionId()
    var url = ENDPOINT + (state.session === '' ? '' : '?session=' + encodeURIComponent(state.session))
    if (manual) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'fresh=1'
    var request
    try {
      request = window.fetch(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
    } catch (error) {
      showError('balance-error')
      return
    }
    request
      .then(function (response) {
        if (response.status === 503) {
          hideAndRetry()
          return null
        }
        if (!response.ok) {
          showError('http-' + response.status)
          return null
        }
        return response.json()
      })
      .then(function (payload) {
        if (payload === null) return
        if (payload.ok !== true) {
          if (payload.error === 'billing-unavailable') {
            hideAndRetry()
            return
          }
          showError(payload.error === 'invalid-session' ? 'no-session' : 'balance-error')
          return
        }
        state.lastFetch = Date.now()
        render(payload)
      })
      .catch(function () {
        showError('balance-error')
      })
  }

  function startPolling () {
    if (state.timer !== null) window.clearInterval(state.timer)
    state.timer = window.setInterval(function () {
      if (doc.visibilityState === 'hidden') return
      refresh(false)
    }, POLL_MS)
  }

  /* --------------------------------------------------------------------- boot */

  function start () {
    ensureStyles()
    ensureRoot()
    refresh(true)
    startPolling()
    /* The shell mounts the conversation column and the sidebar footer after the
       first paint; keep re-measuring until both anchors exist (max ~20s). */
    var tries = 0
    var settle = window.setInterval(function () {
      tries++
      measure()
      var footer = doc.querySelector('[data-slot="sidebar.footer.action"]')
      if (tries > 80 || (tries > 8 && state.column !== null && footer !== null)) {
        window.clearInterval(settle)
      }
    }, 250)
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  window.addEventListener('resize', measure)

  doc.addEventListener('visibilitychange', function () {
    if (doc.visibilityState === 'visible' && Date.now() - state.lastFetch > POLL_MS) refresh(false)
  })

  /* Session switches do not reload the page; re-read the current id shortly after a click. */
  doc.addEventListener('click', function (event) {
    var target = event.target
    if (!(target instanceof Element)) return
    var row = target.closest('[data-row-key^="session:"], [data-dsh-fairy-selected-session]')
    if (row === null) return
    window.setTimeout(function () {
      if (currentSessionId() !== state.session) refresh(true)
    }, 1200)
  }, true)

  /* Keep the panel in the DOM if a shell re-render throws the sidebar away. */
  if (typeof MutationObserver === 'function' && doc.body !== null) {
    var observer = new MutationObserver(function () {
      if (state.hidden) return
      if (state.root === null || state.root.parentNode === null) {
        var root = ensureRoot()
        if (root !== null && state.data !== null) render(state.data)
      } else {
        measure()
      }
    })
    observer.observe(doc.body, { childList: true, subtree: false })
  }

  /* Test hook: lets a screenshot script open the table without synthesising clicks. */
  window.__furinaBilling = {
    refresh: function () { refresh(true) },
    toggle: function (open) { toggleDetail(open === undefined ? !state.expanded : Boolean(open)) },
    currentSessionId: currentSessionId,
    root: function () { return state.root },
  }
})()
