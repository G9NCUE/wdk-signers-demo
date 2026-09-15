import { useCallback, useEffect, useRef, useState } from 'react'
import { BROWSER_SIGNERS, loadRemoteSigners } from './signers/catalog.js'
import { ACTIONS, EXPLORER, balanceOf, createWallet, formatDetails, loadAccounts, shortAddress, shortBalance } from './lib/wallet.js'

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
      if (name === 'sendToSelf') setTimeout(() => refreshBalances(accounts), 15000)
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
  const recent = log.filter(e => e.signer === selected?.label).slice(0, 4)

  return (
    <div className='page'>
      <div className='topline'>
        <div>
          <h1>WDK signers</h1>
          <p className='muted'>One <code>WalletManagerEvm</code>, one <code>ISigner</code> at a time, Sepolia.</p>
        </div>
        <button className='ghost' onClick={() => setDevOpen(v => !v)}>{devOpen ? 'hide' : 'show'} developer panel</button>
      </div>

      <div className={`stage ${devOpen ? '' : 'solo'}`}>
        <div className='phone'>
          <div className='screen'>
            <div className='statusbar'><span>9:41</span><span className='sig'>●●● ᯤ ▮</span></div>

            <header className='topbar'>
              <button className='chip' onClick={() => setSheet(true)} aria-haspopup='dialog'>
                <span className={`dot ${phase}`} />
                {selected ? selected.label : 'Choose a signer'}
                <span className='chev'>▾</span>
              </button>
              <button className='icon' title='refresh balances' disabled={phase !== 'ready'} onClick={() => refreshBalances(accounts)}>↻</button>
            </header>

            <section className={`card ${phase}`}>
              <div className='card-top'>
                <span>{account ? (selected.isDerivable === false ? 'Account' : `Account ${account.index}`) : selected ? selected.label : 'Wallet'}</span>
                <span className='net'>Sepolia</span>
              </div>
              <div className='amount' title={account?.balance ?? ''}>
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
                  : <span className='muted-on-dark'>{phase === 'connecting' ? 'connecting…' : phase === 'error' ? 'could not connect' : 'no signer selected'}</span>}
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
                    <span className='round'>{busy === a.name ? '…' : a.icon}</span>
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

            <section className='activity'>
              <h4>Activity</h4>
              {recent.length === 0 && <p className='muted'>Nothing yet.</p>}
              <ul>
                {recent.map(e => (
                  <li key={e.id} className={e.ok ? 'ok' : 'bad'}>
                    <span className='mark' />
                    <span className='txt'>{e.link ? <a href={e.link} target='_blank' rel='noreferrer'>{e.text}</a> : e.text}</span>
                    <span className='when'>{e.at}</span>
                  </li>
                ))}
              </ul>
            </section>

            {sheet && (
              <div className='sheet-backdrop' onClick={() => setSheet(false)}>
                <div className='sheet' role='dialog' aria-label='Choose a signer' onClick={ev => ev.stopPropagation()}>
                  <div className='grip' />
                  <h4>Signers</h4>
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
        <button className='ghost toggle' onClick={() => setOpen(v => !v)} aria-expanded={open}>
          <span className='chev'>{open ? '▾' : '▸'}</span> Log <span className='count'>{log.length}</span>
        </button>
        {log.length > 0 && open && (
          <span className='log-tools'>
            <button className='ghost' onClick={() => setExpanded(new Set(log.map(e => e.id)))}>expand all</button>
            <button className='ghost' onClick={() => setExpanded(new Set())}>collapse all</button>
            <button className='ghost' onClick={clear}>clear</button>
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
