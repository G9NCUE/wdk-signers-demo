// The developer log: every signer and Safe call, newest first, each entry expandable on its details.
import { useState } from 'react'
import { formatDetails } from '../lib/wallet.js'

export default function Log ({ log, expanded, toggle, setExpanded, clear }) {
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
