import { useCallback, useEffect, useRef, useState } from 'react'
import { BROWSER_SIGNERS, loadRemoteSigners } from './signers/catalog.js'
import { ACTIONS, EXPLORER, balanceOf, createWallet, formatDetails, loadAccounts } from './lib/wallet.js'

// what an error can tell beyond its message: the WDK error class, a cause, a provider's code
function errorDetails (e) {
  const out = { error: e.message, type: e.name || e.constructor?.name }
  if (e.code !== undefined) out.code = e.code
  if (e.cause) out.cause = e.cause.message ?? String(e.cause)
  if (e.stack) out.stack = e.stack.split('\n').slice(0, 6).join('\n')
  return out
}

export default function App () {
  const [signers, setSigners] = useState(BROWSER_SIGNERS)
  const [serviceError, setServiceError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [phase, setPhase] = useState('idle') // idle | connecting | ready | error
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // `${index}:${action}`
  const [log, setLog] = useState([])
  const [showSecret, setShowSecret] = useState(false)
  const [logOpen, setLogOpen] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set()) // log entry ids
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
    walletRef.current?.wallet.dispose()
    walletRef.current = null
    setSelected(entry)
    setAccounts([])
    setError(null)
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

  const run = useCallback(async (index, name) => {
    const entry = accounts.find(a => a.index === index)
    setBusy(`${index}:${name}`)
    try {
      const result = await ACTIONS[name](entry.account)
      append({ ...result, signer: selected.label, account: index })
      if (name === 'sendToSelf') setTimeout(() => refreshBalances(accounts), 15000)
    } catch (e) {
      append({ ok: false, signer: selected.label, account: index, text: e.message, details: errorDetails(e) })
    } finally {
      setBusy(null)
    }
  }, [accounts, selected, append, refreshBalances])

  return (
    <div className='layout'>
      <aside className='sidebar'>
        <h1>WDK signers</h1>
        <p className='muted'>One <code>WalletManagerEvm</code>, one <code>ISigner</code> at a time. Sepolia.</p>
        <ul className='signers'>
          {signers.map(s => (
            <li key={s.id}>
              <button
                className={`signer ${selected?.id === s.id ? 'active' : ''} ${s.available ? '' : 'off'}`}
                onClick={() => select(s)}
                disabled={!s.available || phase === 'connecting'}
                title={s.available ? '' : s.reason}
              >
                <span className='label'>{s.label}</span>
                <span className='kind'>{s.kind}</span>
                <span className={`where ${s.where}`}>{s.where}</span>
                {!s.available && <span className='reason'>{s.reason}</span>}
              </button>
            </li>
          ))}
        </ul>
        {serviceError && <p className='warn'>Signer service unreachable: {serviceError}. Run <code>npm run service</code>.</p>}
      </aside>

      <main className='main'>
        {!selected && <p className='empty'>Pick a signer on the left.</p>}
        {selected && (
          <>
            <header className='head'>
              <div>
                <h2>{selected.label}</h2>
                <p className='muted'>{selected.kind} · {selected.isDerivable === false ? 'single key, registered by name' : 'derivable root, BIP-44'}</p>
              </div>
              <div className='status'>
                {phase === 'connecting' && <span className='pill wait'>connecting</span>}
                {phase === 'ready' && <span className='pill ok'>ready</span>}
                {phase === 'error' && <span className='pill bad'>error</span>}
                {phase === 'ready' && <button className='ghost' onClick={() => refreshBalances(accounts)}>refresh balances</button>}
              </div>
            </header>

            {error && <p className='warn'>{error}</p>}
            {selected.id === 'ledger' && phase === 'connecting' && <p className='hint'>Pick the device in the browser prompt, unlock it and open the Ethereum app.</p>}
            {selected.detail && (
              <p className='secret'>
                <button className='ghost' onClick={() => setShowSecret(v => !v)}>{showSecret ? 'hide' : 'show'} seed phrase</button>
                {showSecret && <code>{selected.detail()}</code>}
              </p>
            )}

            {accounts.length > 0 && (
              <table className='accounts'>
                <thead>
                  <tr><th>#</th><th>path</th><th>address</th><th>balance</th><th>actions</th></tr>
                </thead>
                <tbody>
                  {accounts.map(a => (
                    <tr key={a.index}>
                      <td>{a.index}</td>
                      <td><code>{a.path}</code></td>
                      <td><a href={`${EXPLORER}/address/${a.address}`} target='_blank' rel='noreferrer'><code>{a.address}</code></a></td>
                      <td className='balance'>{a.balance === null ? '…' : `${a.balance} ETH`}</td>
                      <td className='actions'>
                        {[['signMessage', 'sign message'], ['signTransaction', 'sign tx'], ['sendToSelf', 'send 0 ETH to self']].map(([name, text]) => (
                          <button key={name} disabled={busy !== null} onClick={() => run(a.index, name)}>
                            {busy === `${a.index}:${name}` ? '…' : text}
                          </button>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        <section className='log'>
          <div className='log-head'>
            <button className='ghost toggle' onClick={() => setLogOpen(v => !v)} aria-expanded={logOpen}>
              <span className='chev'>{logOpen ? '▾' : '▸'}</span> Log <span className='count'>{log.length}</span>
            </button>
            {log.length > 0 && logOpen && (
              <span className='log-tools'>
                <button className='ghost' onClick={() => setExpanded(new Set(log.map(e => e.id)))}>expand all</button>
                <button className='ghost' onClick={() => setExpanded(new Set())}>collapse all</button>
                <button className='ghost' onClick={() => { setLog([]); setExpanded(new Set()) }}>clear</button>
              </span>
            )}
          </div>
          {logOpen && log.length === 0 && <p className='muted'>Nothing yet.</p>}
          {logOpen && (
            <ul>
              {log.map(e => {
                const open = expanded.has(e.id)
                return (
                  <li key={e.id} className={`${e.ok ? 'ok' : 'bad'} ${open ? 'open' : ''}`}>
                    <div className='row' onClick={() => e.details && toggle(e.id)} role={e.details ? 'button' : undefined} aria-expanded={e.details ? open : undefined}>
                      <span className='chev'>{e.details ? (open ? '▾' : '▸') : ''}</span>
                      <span className='at'>{e.at}</span>
                      <span className='who'>{e.signer}{e.account !== undefined ? ` #${e.account}` : ''}</span>
                      <span className='what'>{e.link ? <a href={e.link} target='_blank' rel='noreferrer' onClick={ev => ev.stopPropagation()}>{e.text}</a> : e.text}</span>
                    </div>
                    {open && e.details && <pre className='details'>{formatDetails(e.details)}</pre>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
