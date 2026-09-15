import { useCallback, useEffect, useRef, useState } from 'react'
import { BROWSER_SIGNERS, loadRemoteSigners } from './signers/catalog.js'
import { ACTIONS, EXPLORER, balanceOf, createWallet, formatDetails, loadAccounts, loadHistory, shortAddress, shortBalance } from './lib/wallet.js'

const DIRECTION = { in: { sign: '↓', label: 'Received' }, out: { sign: '↑', label: 'Sent' }, self: { sign: '↻', label: 'Self' } }

function when (iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// what an error can tell beyond its message: the WDK error class, a cause, a provider's code
function errorDetails (e) {
  const out = { error: e.message, type: e.name || e.constructor?.name }
  if (e.code !== undefined) out.code = e.code
  if (e.cause) out.cause = e.cause.message ?? String(e.cause)
  if (e.stack) out.stack = e.stack.split('\n').slice(0, 6).join('\n')
  return out
}

const ACTION_LIST = [
  { name: 'signMessage', label: 'Sign message', icon: '✎' },
  { name: 'signTransaction', label: 'Sign tx', icon: '⎘' },
  { name: 'sendToSelf', label: 'Send', icon: '↑' }
]

export default function App () {
  const [signers, setSigners] = useState(BROWSER_SIGNERS)
  const [serviceError, setServiceError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [current, setCurrent] = useState(0)
  const [phase, setPhase] = useState('idle') // idle | connecting | ready | error
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [log, setLog] = useState([])
  const [sheet, setSheet] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [devOpen, setDevOpen] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState(null)
  const [historyTick, setHistoryTick] = useState(0)
  const walletRef = useRef(null)
  const nextId = useRef(0)

  useEffect(() => {
    loadRemoteSigners()
      .then(remote => setSigners([...BROWSER_SIGNERS, ...remote]))
      .catch(e => setServiceError(e.message))
  }, [])

  const append = useCallback((entry) => {
    setLog(l => [{ id: nextId.current++, at: new Date().toLocaleTimeString(), ...entry }, ...l].slice(0, 50))
  }, [])

  const toggle = useCallback((id) => {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  const refreshBalances = useCallback(async (list) => {
    const withBalances = await Promise.all(list.map(async (a) => {
      try { return { ...a, balance: await balanceOf(a.account) } } catch (e) { return { ...a, balance: `error: ${e.message}` } }
    }))
    setAccounts(withBalances)
  }, [])

  // switching signer disposes the previous wallet and rebuilds accounts and balances
  const select = useCallback(async (entry) => {
    if (!entry.available) return
    setSheet(false)
    walletRef.current?.wallet.dispose()
    walletRef.current = null
    setSelected(entry)
    setAccounts([])
    setCurrent(0)
    setError(null)
    setShowSecret(false)
    setPhase('connecting')
    try {
      const signer = await entry.build()
      const handle = createWallet(signer)
      walletRef.current = handle
      const list = await loadAccounts(handle)
      setAccounts(list)
      setPhase('ready')
      append({
        ok: true,
        signer: entry.label,
        text: `${list.length} account${list.length > 1 ? 's' : ''} resolved`,
        details: { signer: entry.id, where: entry.where, accounts: list.map(a => ({ index: a.index, path: a.path, address: a.address })) }
      })
      await refreshBalances(list)
    } catch (e) {
      setPhase('error')
      setError(e.message)
      append({ ok: false, signer: entry.label, text: e.message, details: errorDetails(e) })
    }
  }, [append, refreshBalances])

  const run = useCallback(async (name) => {
    const entry = accounts[current]
    if (!entry) return
    setBusy(name)
    try {
      const result = await ACTIONS[name](entry.account, walletRef.current?.signer)
      append({ ...result, signer: selected.label, account: entry.index })
      if (name === 'sendToSelf') setTimeout(() => { refreshBalances(accounts); setHistoryTick(t => t + 1) }, 15000)
    } catch (e) {
      append({ ok: false, signer: selected.label, account: entry.index, text: e.message, details: errorDetails(e) })
    } finally {
      setBusy(null)
    }
  }, [accounts, current, selected, append, refreshBalances])

  const copy = useCallback(async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch {}
  }, [])

  const account = accounts[current]
  const balance = shortBalance(account?.balance)

  // history of the selected account, reloaded when the account changes and after a send
  useEffect(() => {
    if (!account?.address) { setHistory(null); return }
    let alive = true
    setHistory({ loading: true, address: account.address })
    loadHistory(account.address)
      .then(h => alive && setHistory(h))
      .catch(e => alive && setHistory({ error: e.message, address: account.address, entries: [] }))
    return () => { alive = false }
  }, [account?.address, historyTick])

  return (
    <div className='page'>
      <header className='topbar'>
        <div className='topbar-inner'>
          <div className='topbar-left'>
            <a className='brand' href='https://github.com/G9NCUE/wdk-atlas' aria-label='WDK Atlas'>
              <img src='/assets/wdk-logo.svg' alt='WDK' width='170' height='61' />
            </a>
            <ul className='nav'>
              <li><span aria-current='page'>Signers demo</span></li>
            </ul>
          </div>
          <div className='topbar-right'>
            <div className='view-toggle' role='group' aria-label='Layout'>
              <button aria-pressed={!devOpen} onClick={() => setDevOpen(false)}>Phone</button>
              <button aria-pressed={devOpen} onClick={() => setDevOpen(true)}>Phone + log</button>
            </div>
            <a className='gh-link' href='https://github.com/G9NCUE/wdk-signers-demo' aria-label='Source on GitHub' title='Source on GitHub'>
              <svg viewBox='0 0 16 16' width='20' height='20' aria-hidden='true' fill='currentColor'><path d='M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z' /></svg>
            </a>
          </div>
        </div>
      </header>

      <header className='site-header'>
        <div>
          <h1>WDK signers</h1>
          <p className='subtitle'>One <code>WalletManagerEvm</code>, one <code>ISigner</code> at a time, on Sepolia. Seven signers behind the same contract.</p>
        </div>
        <ul className='legend' aria-label='Status legend'>
          <li><span className='state-dot ready' /> ready</li>
          <li><span className='state-dot connecting' /> connecting</li>
          <li><span className='state-dot error' /> error</li>
        </ul>
      </header>

      <div className={`stage ${devOpen ? '' : 'solo'}`}>
        <div className='phone'>
          <div className='screen'>
            <div className='statusbar'><span>9:41</span><span className='sig'>●●● ᯤ ▮</span></div>

            <div className='phone-top'>
              <button className='chip' onClick={() => setSheet(true)} aria-haspopup='dialog'>
                <span className={`state-dot ${phase}`} />
                {selected ? selected.label : 'Choose a signer'}
                <span className='chev' aria-hidden='true' />
              </button>
              <button className='icon' title='refresh balances' disabled={phase !== 'ready'} onClick={() => refreshBalances(accounts)}>↻</button>
            </div>

            <section className={`tile ${phase}`}>
              <div className='tile-top'>
                <span className='tile-label'>{account ? (selected.isDerivable === false ? 'Account' : `Account ${account.index}`) : selected ? selected.label : 'Wallet'}</span>
                <span className='status-pill plain'>Sepolia</span>
              </div>
              <div className='tile-value' title={account?.balance ?? ''}>
                {phase === 'connecting' ? <span className='skeleton' /> : balance ?? '—'}
                {balance !== null && phase === 'ready' && <span className='unit'>ETH</span>}
              </div>
              <div className='addr'>
                {account
                  ? (
                    <>
                      <code title={account.address}>{shortAddress(account.address)}</code>
                      <button className='mini' onClick={() => copy(account.address)}>{copied ? 'copied' : 'copy'}</button>
                      <a className='mini' href={`${EXPLORER}/address/${account.address}`} target='_blank' rel='noreferrer'>explorer</a>
                    </>
                    )
                  : <span>{phase === 'connecting' ? 'connecting…' : phase === 'error' ? 'could not connect' : 'no signer selected'}</span>}
              </div>
              {account?.path && <div className='path'>{account.path}</div>}
            </section>

            {accounts.length > 1 && (
              <div className='pills'>
                {accounts.map((a, i) => (
                  <button key={a.index} className={`pill ${i === current ? 'active' : ''}`} onClick={() => setCurrent(i)} title={a.address}>
                    #{a.index} <span>{shortBalance(a.balance) ?? '…'}</span>
                  </button>
                ))}
              </div>
            )}

            {error && <p className='warn'>{error}</p>}
            {selected?.id === 'ledger' && phase === 'connecting' && <p className='hint'>Pick the device in the browser prompt, unlock it, open the Ethereum app.</p>}
            {selected?.id === 'metamask' && phase === 'connecting' && <p className='hint'>Approve the connection in the wallet.</p>}

            <div className='actions'>
              {ACTION_LIST.map(a => {
                const allowed = selected?.can?.[a.name] !== false
                return (
                  <button
                    key={a.name}
                    className='action'
                    disabled={!account || busy !== null || !allowed}
                    title={allowed ? a.label : `${selected.label} cannot ${a.label.toLowerCase()} for an application`}
                    onClick={() => run(a.name)}
                  >
                    <span className='glyph' aria-hidden='true'>{busy === a.name ? '…' : a.icon}</span>
                    <span>{a.label}</span>
                  </button>
                )
              })}
            </div>

            {selected?.detail && (
              <p className='secret'>
                <button className='link' onClick={() => setShowSecret(v => !v)}>{showSecret ? 'hide' : 'show'} backup phrase</button>
                {showSecret && <code>{selected.detail()}</code>}
              </p>
            )}

            <section className='history'>
              <div className='history-head'>
                <h4 className='eyebrow'>History{account ? ` · #${account.index}` : ''}</h4>
                {history && !history.loading && (
                  <button className='link small' onClick={() => setHistoryTick(t => t + 1)}>refresh</button>
                )}
              </div>
              {!account && <p className='muted'>Pick a signer to see its transactions.</p>}
              {history?.loading && <p className='muted'>Loading…</p>}
              {history?.error && <p className='warn'>{history.error}</p>}
              {history && !history.loading && !history.error && history.entries.length === 0 && <p className='muted'>No transaction yet on this address.</p>}
              {history && !history.loading && history.entries.length > 0 && (
                <ul>
                  {history.entries.map(e => (
                    <li key={e.id} className={`${e.direction} ${e.status}`}>
                      <a href={e.link} target='_blank' rel='noreferrer'>
                        <span className={`sign ${e.direction}`}>{DIRECTION[e.direction].sign}</span>
                        <span className='main'>
                          <span className='what'>{DIRECTION[e.direction].label} {e.kind}{e.status === 'failed' ? ' · failed' : ''}</span>
                          <span className='sub'>{e.counterparty ? shortAddress(e.counterparty) : e.method || 'contract'} · {when(e.timestamp)}</span>
                        </span>
                        <span className={`amt ${e.direction}`}>{e.direction === 'in' ? '+' : e.direction === 'out' ? '−' : ''}{shortBalance(e.amount)} {e.kind}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {history && !history.loading && history.sources && (
                <p className='sources'>
                  ETH via Blockscout{history.sources.blockscout !== 'ok' ? ` (${history.sources.blockscout})` : ''} · USDT via WDK indexer{history.sources.wdkIndexer !== 'ok' ? ` (${history.sources.wdkIndexer})` : ''}
                </p>
              )}
            </section>

            {sheet && (
              <div className='sheet-backdrop' onClick={() => setSheet(false)}>
                <div className='sheet' role='dialog' aria-label='Choose a signer' onClick={ev => ev.stopPropagation()}>
                  <div className='grip' />
                  <h4 className='eyebrow'>Signers</h4>
                  <ul className='signers'>
                    {signers.map(s => (
                      <li key={s.id}>
                        <button className={`signer ${selected?.id === s.id ? 'active' : ''} ${s.available ? '' : 'off'}`} onClick={() => select(s)} disabled={!s.available}>
                          <span className='label'>{s.label}</span>
                          <span className={`where ${s.where}`}>{s.where}</span>
                          <span className='kind'>{s.kind}</span>
                          {!s.available && <span className='reason'>{s.reason}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {serviceError && <p className='warn'>Signer service unreachable: {serviceError}. Run <code>npm run service</code>.</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        {devOpen && (
          <aside className='dev'>
            <Log log={log} expanded={expanded} toggle={toggle} setExpanded={setExpanded} clear={() => { setLog([]); setExpanded(new Set()) }} />
          </aside>
        )}
      </div>
    </div>
  )
}

function Log ({ log, expanded, toggle, setExpanded, clear }) {
  const [open, setOpen] = useState(true)
  return (
    <section className='log'>
      <div className='log-head'>
        <button className='toggle' onClick={() => setOpen(v => !v)} aria-expanded={open}>
          <span className='chev'>{open ? '▾' : '▸'}</span> <span className='eyebrow'>Log</span> <span className='count'>{log.length}</span>
        </button>
        {log.length > 0 && open && (
          <span className='log-tools'>
            <button className='link small' onClick={() => setExpanded(new Set(log.map(e => e.id)))}>expand all</button>
            <button className='link small' onClick={() => setExpanded(new Set())}>collapse all</button>
            <button className='link small' onClick={clear}>clear</button>
          </span>
        )}
      </div>
      {open && log.length === 0 && <p className='muted'>Nothing yet. Every signer call lands here with its details.</p>}
      {open && (
        <ul>
          {log.map(e => {
            const isOpen = expanded.has(e.id)
            return (
              <li key={e.id} className={`${e.ok ? 'ok' : 'bad'} ${isOpen ? 'open' : ''}`}>
                <div className='row' onClick={() => e.details && toggle(e.id)} role={e.details ? 'button' : undefined} aria-expanded={e.details ? isOpen : undefined}>
                  <span className='chev'>{e.details ? (isOpen ? '▾' : '▸') : ''}</span>
                  <span className='at'>{e.at}</span>
                  <span className='who'>{e.signer}{e.account !== undefined ? ` #${e.account}` : ''}</span>
                  <span className='what'>{e.link ? <a href={e.link} target='_blank' rel='noreferrer' onClick={ev => ev.stopPropagation()}>{e.text}</a> : e.text}</span>
                </div>
                {isOpen && e.details && <pre className='details'>{formatDetails(e.details)}</pre>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
