// Transfers of one address as the explorer and the WDK indexer see them, newest first. The phone
// shows it for the selected account, the Multisig page for the Safe.
import { shortAddress, shortBalance } from '../lib/wallet.js'
import { when } from '../lib/ui.js'

const DIRECTION = { in: { sign: '↓', label: 'Received' }, out: { sign: '↑', label: 'Sent' }, self: { sign: '↻', label: 'Self' } }

// `tag(entry)` may add a word after the kind, "paymaster fee" for instance
export default function HistoryList ({ entries, tag = () => '' }) {
  return (
    <ul>
      {entries.map(e => (
        <li key={e.id} className={`${e.direction} ${e.status}`}>
          <a href={e.link} target='_blank' rel='noreferrer'>
            <span className={`sign ${e.direction}`}>{DIRECTION[e.direction].sign}</span>
            <span className='main'>
              <span className='what'>{DIRECTION[e.direction].label} {e.kind}{e.status === 'failed' ? ' · failed' : e.status === 'pending' ? ' · pending' : ''}{tag(e)}</span>
              <span className='sub'>{e.counterparty ? shortAddress(e.counterparty) : e.method || 'contract'} · {e.timestamp ? when(e.timestamp) : 'in the mempool'}</span>
            </span>
            <span className={`amt ${e.direction}`}>{e.direction === 'in' ? '+' : e.direction === 'out' ? '−' : ''}{shortBalance(e.amount)} {e.kind}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
