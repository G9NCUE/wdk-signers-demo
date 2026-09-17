// The Multisig page: a Safe whose owners are accounts of the signers of the catalogue, shown side
// by side, and the path of a transaction through them: proposed by one, approved by another,
// executed by any. Two configurations, each its own Safe, picked from a dropdown: three accounts
// of the one seed, or one seed account and two other signers. Each owner signs through its own
// ISigner; the Safe module only ever sees a WalletAccountEvm.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isAddress, parseEther, parseUnits } from 'ethers'
import RemoteCoordinator from '../lib/safe/remote-coordinator.js'
import SafeOwnerAccount from '../lib/safe/owner-account.js'
import { predictSafeAddress, safeConfigOf } from '../lib/safe/config.js'
import { proposerSignatureOf } from '../lib/safe/local-coordinator.js'
import { balancesOf, userOperationReceipt } from '../lib/safe/balances.js'
import { createWallet, formatDetails, gaslessOf, loadAccounts, loadHistory, shortAddress, shortBalance } from '../lib/wallet.js'
import { recipients, remember } from '../lib/recipients.js'
import { errorDetails, when } from '../lib/ui.js'
import { CONFIGS, DEFAULT_CONFIG } from '../lib/safe/configs.js'
import HistoryList from '../components/HistoryList.jsx'

const CONFIG_KEY = 'wdk-signers-demo.safe-config'

// what each provider receives when an owner signs the SafeOp
const SIGNS = {
  seed: 'EIP-712 hash, local key in the page',
  ledger: 'EIP-712 typed data on the device',
  metamask: 'eth_signTypedData_v4 in the extension',
  turnkey: 'EIP-712 typed data, Turnkey API',
  dfns: 'EIP-712 typed data, Dfns API',
  openfort: '32-byte digest, Openfort API',
  fireblocks: 'EIP-712 typed data, Fireblocks RAW signing'
}
const SEED_ACCOUNTS = 3
const RECEIPT_TRIES = 30 // 3 s apart

const short = (hex, n = 10) => (hex ? `${hex.slice(0, n)}…${hex.slice(-6)}` : '')
const keyOfOwner = (o) => `${o.signerId}:${o.index ?? 0}`
const sameOwner = (a, b) => a && b && a.signerId === b.signerId && (a.index ?? 0) === (b.index ?? 0)
// owners in the configuration's order (seed first), not in the module's address order
function sortOwners (list, order) {
  const keys = order.split(',')
  const rank = (o) => { const i = keys.indexOf(keyOfOwner(o)); return i === -1 ? 99 : i }
  return [...list].sort((a, b) => rank(a) - rank(b))
}

export default function Multisig ({ signers, net, append, serviceError, devOpen }) {
  const [configId, setConfigId] = useState(() => { try { const stored = localStorage.getItem(CONFIG_KEY); return CONFIGS.some(c => c.id === stored) ? stored : DEFAULT_CONFIG } catch { return DEFAULT_CONFIG } })
  const config = CONFIGS.find(c => c.id === configId)
  const coordinator = useMemo(() => new RemoteCoordinator({ network: net.id, config: configId }), [net.id, configId])
  const scope = `${net.id}:${configId}`
  // what the service said for this network and configuration; another scope means loading
  const [loaded, setLoaded] = useState({ scope: null, safe: null, proposals: [], error: null })
  const safe = loaded.scope === scope ? loaded.safe : undefined // undefined: loading, null: none yet
  const proposals = loaded.scope === scope ? loaded.proposals : []
  const safeError = loaded.scope === scope ? loaded.error : null
  const [balanceOf, setBalanceOf] = useState({ address: null, value: null })
  const balances = safe && balanceOf.address === safe.address ? balanceOf.value : null
  const [chainOf, setChainOf] = useState({ address: null, value: null }) // the Safe's transfers, from the explorer
  const chain = safe && chainOf.address === safe.address ? chainOf.value : null
  const [selectedId, setSelectedId] = useState(null)
  const [opened, setOpened] = useState(null) // an executed proposal whose detail the user asked for
  const [now, setNow] = useState(() => Date.now())
  const [ownersOn, setOwnersOn] = useState({ net: null, map: {} }) // "signer:index" -> { phase, address, error }
  const owners = useMemo(() => (ownersOn.net === net.id ? ownersOn.map : {}), [ownersOn, net.id])
  const setOwners = useCallback((update) => setOwnersOn(o => ({ net: net.id, map: update(o.net === net.id ? o.map : {}) })), [net.id])
  const [busy, setBusy] = useState(null) // { action, owner }
  const [setup, setSetup] = useState(null)
  const [transfer, setTransfer] = useState(null)
  const [fund, setFund] = useState(null)
  const [copied, setCopied] = useState(null)
  const [receiptsPending, setReceiptsPending] = useState(() => new Set())
  const unmounted = useRef(false)
  useEffect(() => () => { unmounted.current = true }, [])
  const handles = useRef(new Map()) // signerId -> { entry, handle, accounts }
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById('dev-top')) }, [devOpen]) // oxlint-disable-line react/set-state-in-effect -- a DOM lookup, once the column exists

  const byId = useCallback((id) => signers.find(s => s.id === id), [signers])
  const custodyOf = (id) => byId(id)?.key ?? 'remote'
  // "Seed phrase #1", or the signer's name for a single-key signer
  const nameOf = (o) => {
    if (!o) return ''
    const entry = byId(o.signerId)
    const label = entry?.label ?? o.signerId
    return entry?.isDerivable === false ? label : `${label} #${o.index ?? 0}`
  }

  // the cards read in the configuration's order (seed first), not in the module's address order
  const configOrder = config.owners.map(keyOfOwner).join(',')
  const ownerCards = safe ? sortOwners(safe.owners, configOrder) : config.owners.map(o => ({ ...o, address: null }))

  const chooseConfig = (id) => {
    setConfigId(id)
    try { localStorage.setItem(CONFIG_KEY, id) } catch {}
  }

  // --- the Safe and its proposals, from the service --------------------------------------------------
  // a fetch started for one scope must not land after the page moved to another
  const generation = useRef(0)
  const refreshSafe = useCallback(async () => {
    const gen = ++generation.current
    try {
      const s = await coordinator.getSafe()
      const list = s ? await coordinator.listProposals() : []
      if (gen !== generation.current) return null
      setLoaded({ scope, safe: s, proposals: list, error: null })
      setSelectedId(id => (id && list.some(p => p.proposalId === id)) ? id : (list[0]?.proposalId ?? null))
      return s
    } catch (e) {
      if (gen === generation.current) setLoaded({ scope, safe: null, proposals: [], error: e.message })
      return null
    }
  }, [coordinator, scope, setLoaded, setSelectedId])

  // balances from the chain, and the Safe's transfers as the explorer sees them (what happened on
  // chain, including what this page did not do, like the first run from Node)
  const refreshBalances = useCallback(async (address) => {
    if (!address) return
    try { setBalanceOf({ address, value: await balancesOf(address, net) }) } catch (e) { setBalanceOf({ address, value: { error: e.message } }) }
    try { setChainOf({ address, value: await loadHistory(address, 12, net.id) }) } catch (e) { setChainOf({ address, value: { error: e.message, entries: [] } }) }
  }, [net, setBalanceOf, setChainOf])

  const refreshProposals = useCallback(async () => {
    const list = await coordinator.listProposals()
    setLoaded(l => (l.scope === scope ? { ...l, proposals: list } : l))
    return list
  }, [coordinator, scope, setLoaded])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the state lands after the fetch, not synchronously
    refreshSafe().then(s => refreshBalances(s?.address))
  }, [refreshSafe, refreshBalances])

  // the owner wallets live as long as the page and the network
  useEffect(() => {
    const map = handles.current
    return () => {
      for (const h of map.values()) Promise.resolve(h).then(b => b.handle.wallet.dispose(), () => {})
      map.clear()
    }
  }, [net.id])

  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') { setSetup(null); setTransfer(null); setFund(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // --- owners: one wallet per signer, built on first use; the account by index ----------------------
  const ownerOf = useCallback(async ({ signerId, index = 0 }) => {
    const key = `${signerId}:${index}`
    const entry = byId(signerId)
    if (!entry) throw new Error(`${signerId} is not in the catalogue`)
    // the map holds the build in flight, then its result, so two callers share one wallet
    if (!handles.current.has(signerId)) {
      if (!entry.available) throw new Error(`${entry.label}: ${entry.reason}`)
      if (!entry.networks?.includes(net.id)) throw new Error(`${entry.label} is not configured for ${net.label}`)
      setOwners(o => ({ ...o, [key]: { ...o[key], phase: 'connecting', error: null } }))
      const building = (async () => {
        const signer = await entry.build(net)
        const handle = createWallet(signer, net.id)
        try {
          const accounts = await loadAccounts(handle, entry.isDerivable === false ? 1 : SEED_ACCOUNTS)
          remember(signerId, accounts, net.id)
          setOwners(o => {
            const next = { ...o }
            for (const a of accounts) next[`${signerId}:${a.index ?? 0}`] = { phase: 'ready', address: a.address, error: null }
            return next
          })
          append({ ok: true, signer: entry.label, text: `${accounts.length} owner account${accounts.length > 1 ? 's' : ''} resolved on ${net.label}`, details: { signer: signerId, where: entry.where, accounts: accounts.map(a => ({ index: a.index, path: a.path, address: a.address })) } })
          return { entry, handle, accounts }
        } catch (e) {
          handle.wallet.dispose()
          throw e
        }
      })()
      handles.current.set(signerId, building)
      building.catch(e => {
        handles.current.delete(signerId)
        setOwners(o => ({ ...o, [key]: { phase: 'error', error: e.message } }))
      })
    }
    const built = await handles.current.get(signerId)
    const account = built.accounts.find(a => (a.index ?? 0) === index) ?? built.accounts[0]
    return { entry, handle: built.handle, ...account, index, signerId }
  }, [byId, net, append, setOwners])

  // the Safe module on that owner's account: the shim swaps the seed-built owner for the account
  const safeAs = useCallback((owner) => {
    const expected = safe.owners.find(o => sameOwner(o, owner))
    if (expected && expected.address.toLowerCase() !== owner.address.toLowerCase()) {
      throw new Error(`${nameOf(owner)} resolves to ${shortAddress(owner.address)} but the Safe expects ${shortAddress(expected.address)}; forget the Safe and set it up again`)
    }
    return new SafeOwnerAccount(owner.account, safeConfigOf(net, { owners: safe.owners.map(o => o.address), threshold: safe.threshold, saltNonce: safe.saltNonce }, coordinator))
  }, [safe, net, coordinator]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (what, fn) => {
    setBusy(what)
    try {
      await fn()
    } catch (e) {
      append({ ok: false, signer: nameOf(what.owner), text: e.message, details: errorDetails(e) })
    } finally {
      setBusy(null)
    }
  }, [append]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- the flow: propose, approve, execute -----------------------------------------------------------
  const propose = useCallback(async () => {
    const t = transfer
    let value
    try { value = t.asset ? parseUnits(t.amount || '0', t.asset.decimals) : parseEther(t.amount || '0') } catch { return setTransfer(x => ({ ...x, error: `not a number: ${t.amount}` })) }
    if (!(value > 0n)) return setTransfer(x => ({ ...x, error: 'the amount must be above zero' }))
    if (!isAddress(t.to)) return setTransfer(x => ({ ...x, error: 'pick a recipient' }))
    setTransfer(null)
    await act({ action: 'propose', owner: t.as }, async () => {
      const owner = await ownerOf(t.as)
      const account = safeAs(owner)
      try {
        const human = `${t.amount} ${t.asset ? t.asset.symbol : net.native}`
        coordinator.describeNext({ asset: t.asset ? t.asset.symbol : net.native, amount: t.amount, recipient: t.to, toLabel: t.toLabel, proposer: t.as })
        const r = t.asset
          ? await account.proposeTransfer({ token: t.asset.address, recipient: t.to, amount: value })
          : await account.propose({ to: t.to, value, data: '0x' })
        const record = await coordinator.getProposal(r.proposalId)
        append({
          ok: true,
          signer: nameOf(owner),
          text: `proposed ${human} to ${t.toLabel ?? shortAddress(t.to)}, ${r.confirmations} of ${r.threshold} signatures`,
          details: { proposalId: r.proposalId, safeOperationHash: r.proposalId, signedAs: SIGNS[owner.signerId], signature: proposerSignatureOf(record.userOperation.signature), userOperation: record.userOperation, paymaster: net.safe.paymasterAddress, bundler: net.safe.bundlerUrl }
        })
        setSelectedId(r.proposalId)
        await refreshProposals()
      } finally {
        coordinator.describeNext(null)
        account.dispose()
      }
    })
  }, [transfer, act, ownerOf, safeAs, coordinator, append, net, refreshProposals]) // eslint-disable-line react-hooks/exhaustive-deps

  const approve = useCallback(async (proposalId, o) => {
    await act({ action: 'approve', owner: o, proposalId }, async () => {
      const owner = await ownerOf(o)
      const account = safeAs(owner)
      try {
        const r = await account.approveProposal(proposalId)
        const record = await coordinator.getProposal(proposalId)
        const mine = record.confirmations.find(c => c.owner.toLowerCase() === owner.address.toLowerCase())
        append({
          ok: true,
          signer: nameOf(owner),
          text: `approved ${short(proposalId)}, ${r.confirmations} of ${r.threshold} signatures${r.confirmations >= r.threshold ? ', ready to execute' : ''}`,
          details: { proposalId, signedAs: SIGNS[owner.signerId], signature: mine?.signature, confirmations: record.confirmations.map(c => ({ owner: c.owner, signer: `${c.signerId} #${c.index}`, at: c.at })) }
        })
        await refreshProposals()
      } finally {
        account.dispose()
      }
    })
  }, [act, ownerOf, safeAs, coordinator, append, refreshProposals]) // eslint-disable-line react-hooks/exhaustive-deps

  // the receipt, when the bundler has it; the page is not blocked meanwhile, and a page that moved
  // on (other scope, unmounted) drops the result
  const followReceipt = useCallback((proposalId, execution, who) => {
    const gen = generation.current
    const bundlerUrl = net.safe.bundlerUrl
    const safeAddress = safe.address
    const alive = () => gen === generation.current && !unmounted.current
    setReceiptsPending(s => new Set(s).add(proposalId))
    ;(async () => {
      try {
        for (let i = 0; i < RECEIPT_TRIES && alive(); i++) {
          await new Promise(r => setTimeout(r, 3000))
          let receipt = null
          try { receipt = await userOperationReceipt(bundlerUrl, execution.hash) } catch {}
          if (!receipt) continue
          if (!alive()) return
          await coordinator.recordExecution(proposalId, { ...execution, txHash: receipt.txHash, success: receipt.success, blockNumber: receipt.blockNumber })
          append({ ok: receipt.success !== false, signer: who, text: `${receipt.success === false ? 'reverted' : 'mined'} in ${short(receipt.txHash)}`, link: `${net.explorer}/tx/${receipt.txHash}`, details: { proposalId, ...receipt } })
          await refreshProposals()
          await refreshBalances(safeAddress)
          return
        }
        if (alive()) append({ ok: false, signer: who, text: `no receipt after ${RECEIPT_TRIES * 3} s, check the explorer`, link: `${net.blockscout}/op/${execution.hash}` })
      } finally {
        setReceiptsPending(s => { const n = new Set(s); n.delete(proposalId); return n })
      }
    })()
  }, [net, safe, coordinator, append, refreshProposals, refreshBalances])

  const execute = useCallback(async (proposalId, o) => {
    await act({ action: 'execute', owner: o, proposalId }, async () => {
      const owner = await ownerOf(o)
      const account = safeAs(owner)
      let hash, fee
      try {
        ({ hash, fee } = await account.executeProposal(proposalId))
      } finally {
        account.dispose()
      }
      const execution = { hash, by: { signerId: owner.signerId, index: owner.index, owner: owner.address }, moduleMaxGasCost: String(fee ?? '') }
      await coordinator.recordExecution(proposalId, execution)
      append({
        ok: true,
        signer: nameOf(owner),
        text: `executed ${short(proposalId)}: user operation ${short(hash)} sent to the bundler`,
        link: `${net.blockscout}/op/${hash}`,
        details: { proposalId, userOperationHash: hash, sentBy: owner.address, bundler: net.safe.bundlerUrl, moduleFee: `${fee} (the module's max gas cost, not ${net.safe.paymasterToken.symbol} units)`, explorer: `${net.blockscout}/op/${hash}` }
      })
      await refreshProposals()
      followReceipt(proposalId, execution, nameOf(owner))
    })
  }, [act, ownerOf, safeAs, coordinator, append, net, refreshProposals, followReceipt]) // eslint-disable-line react-hooks/exhaustive-deps

  // fund the Safe from the demo seed's account 0, gasless, in the paymaster token
  const confirmFund = useCallback(async () => {
    const f = fund
    setFund(null)
    const from = { signerId: 'seed', index: 0 }
    await act({ action: 'fund', owner: from }, async () => {
      const token = net.safe.paymasterToken
      const value = parseUnits(f.amount || '0', token.decimals)
      if (!(value > 0n)) throw new Error('The amount must be above zero.')
      const owner = await ownerOf(from)
      const { hash } = await gaslessOf(owner.account, net).transfer({ token: token.address, recipient: safe.address, amount: value })
      append({ ok: true, signer: nameOf(owner), text: `sent ${f.amount} ${token.symbol} to the Safe, gasless, user operation ${short(hash)}`, link: `${net.blockscout}/op/${hash}`, details: { from: owner.address, to: safe.address, amount: `${f.amount} ${token.symbol}`, userOperationHash: hash } })
      setTimeout(() => refreshBalances(safe.address), 12000)
    })
  }, [fund, act, ownerOf, net, safe, append, refreshBalances]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- set up: pick owners, threshold, optional salt, predicted address ---------------------------------
  // candidates: the seed's first accounts, and account 0 of every other signer on this network
  const openSetup = useCallback(async () => {
    const preset = CONFIGS.find(c => c.id === configId)
    const onNet = signers.filter(s => s.networks?.includes(net.id))
    const candidates = onNet.flatMap(s => s.id === 'seed'
      ? Array.from({ length: SEED_ACCOUNTS }, (_, i) => ({ key: `seed:${i}`, signerId: 'seed', index: i, entry: s }))
      : [{ key: `${s.id}:0`, signerId: s.id, index: 0, entry: s }])
    const picked = new Set(preset.owners.map(keyOfOwner).filter(k => candidates.some(c => c.key === k && c.entry.available)))
    setSetup({ candidates, picked, threshold: Math.min(preset.threshold, picked.size || 1), salt: '', addresses: {}, resolving: true, predicted: null, error: null })
    const addresses = {}
    try {
      const seed = onNet.find(s => s.id === 'seed')
      if (seed) for (let i = 0; i < SEED_ACCOUNTS; i++) addresses[`seed:${i}`] = (await ownerOf({ signerId: 'seed', index: i })).address
    } catch {}
    const groups = await recipients(onNet.filter(s => s.id !== 'seed'), { net })
    for (const g of groups) if (g.accounts.length) addresses[`${g.id}:0`] = g.accounts[0].address
    setSetup(s => s && { ...s, addresses: { ...addresses, ...s.addresses }, resolving: false })
  }, [signers, net, configId, ownerOf, setSetup])

  // connecting a prompting owner (Ledger, MetaMask) from the setup sheet
  const connectForSetup = useCallback(async (c) => {
    try {
      const owner = await ownerOf(c)
      setSetup(s => s && { ...s, addresses: { ...s.addresses, [c.key]: owner.address } })
    } catch (e) {
      setSetup(s => s && { ...s, error: e.message })
    }
  }, [ownerOf, setSetup])

  // the inputs of the prediction; the predicted address is only shown while it matches them
  const setupInputs = setup && !setup.resolving
    ? (() => {
        const list = [...setup.picked].map(k => setup.addresses[k]).filter(Boolean)
        if (list.length !== setup.picked.size || list.length === 0 || setup.threshold > list.length) return null
        return { list, threshold: setup.threshold, salt: setup.salt.trim(), key: JSON.stringify([list, setup.threshold, setup.salt.trim()]) }
      })()
    : null
  const predicted = setupInputs && setup.predicted?.key === setupInputs.key ? setup.predicted.address : null
  useEffect(() => {
    if (!setupInputs) return
    let alive = true
    predictSafeAddress(net, { owners: setupInputs.list, threshold: setupInputs.threshold, saltNonce: setupInputs.salt || undefined })
      .then(a => alive && setSetup(s => s && { ...s, predicted: { key: setupInputs.key, address: a }, error: null }))
      .catch(e => alive && setSetup(s => s && { ...s, error: e.message }))
    return () => { alive = false }
  }, [setupInputs?.key, net]) // eslint-disable-line react-hooks/exhaustive-deps

  const createSafe = useCallback(async () => {
    const s = setup
    const configLabel = CONFIGS.find(c => c.id === configId).label
    try {
      const created = await coordinator.createSafe({
        owners: s.candidates.filter(c => s.picked.has(c.key)).map(c => ({ signerId: c.signerId, index: c.index, address: s.addresses[c.key] })),
        threshold: s.threshold,
        saltNonce: s.salt.trim() || undefined
      })
      setSetup(null)
      append({ ok: true, signer: 'Safe', text: `${configLabel}: Safe ${created.threshold} of ${created.owners.length} registered at ${shortAddress(created.address)}, nothing sent, it deploys with its first operation`, details: created })
      await refreshSafe()
      await refreshBalances(created.address)
    } catch (e) {
      setSetup(x => x && { ...x, error: e.message })
    }
  }, [setup, coordinator, append, refreshSafe, refreshBalances, configId, setSetup])

  const forget = useCallback(async () => {
    const configLabel = CONFIGS.find(c => c.id === configId).label
    if (!window.confirm(`Forget the "${configLabel}" Safe and its proposals in the service? The chain keeps what was deployed.`)) return
    await coordinator.forgetSafe()
    append({ ok: true, signer: 'Safe', text: `forgot ${shortAddress(safe.address)} (${configLabel}) on ${net.label}` })
    await refreshSafe()
  }, [coordinator, safe, net, append, refreshSafe, configId])

  // recipients: the Safe's own owners (the money goes back to one of the signers), or any address
  const openTransfer = useCallback((as, again = null) => {
    const asset = net.safe.paymasterToken
    const inOrder = sortOwners(safe.owners, configOrder)
    const proposer = as ?? inOrder.find(o => owners[keyOfOwner(o)]?.phase === 'ready') ?? inOrder[0]
    const first = inOrder[0]
    const to = again?.recipient ?? first.address
    const known = safe.owners.find(o => o.address.toLowerCase() === to.toLowerCase())
    setTransfer({ asset, amount: again?.amount ?? '0.1', to, toLabel: known ? nameOf(known) : (again?.toLabel ?? null), custom: known ? '' : to, as: proposer })
  }, [net, safe, owners, configOrder]) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = useCallback(async (text, tag) => {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(null), 1200) } catch {}
  }, [setCopied])

  // --- derived: the selected proposal and each owner's part in it --------------------------------------
  const selected = proposals.find(p => p.proposalId === selectedId) ?? null
  const token = net.safe?.paymasterToken
  const held = balances?.tokens?.find(t => t.symbol === token?.symbol)?.balance
  // the owners only carry a role while a proposal is in flight; executed or expired, they are idle again
  const active = selected && !selected.execution && selected.status !== 'expired' ? selected : null
  const deadline = active?.expiresAt ? Date.parse(active.expiresAt) : null
  const secondsLeft = deadline ? Math.max(0, Math.round((deadline - now) / 1000)) : null
  // a clock while the sponsorship runs out; past the deadline the service says 'expired'
  const activeDeadline = active?.expiresAt ?? null
  useEffect(() => {
    if (!activeDeadline) return
    const id = setInterval(() => {
      setNow(Date.now())
      if (Date.parse(activeDeadline) <= Date.now()) { clearInterval(id); refreshProposals() }
    }, 1000)
    return () => clearInterval(id)
  }, [activeDeadline, refreshProposals])
  const roleOf = (o) => {
    if (!active) return null
    return {
      proposer: sameOwner(active.proposedBy, o),
      confirmed: active.confirmations.some(c => sameOwner(c, o))
    }
  }
  const custodyPill = (o, key) => <span key={key} className={`custody ${custodyOf(o.signerId)}`} title={o.owner ?? o.address}>{nameOf(o)}</span>

  const onChain = safe && (
    <section className='proposals onchain'>
          <div className='history-head'>
            <h4 className='eyebrow'>On chain · {token.symbol} and {net.native} movements of the Safe</h4>
            <a className='link small' href={`${net.explorer}/address/${safe.address}#tokentxns`} target='_blank' rel='noreferrer'>explorer</a>
          </div>
          {!chain && <p className='muted'>Loading…</p>}
          {chain?.error && <p className='warn'>{chain.error}</p>}
          {chain && !chain.error && chain.entries.length === 0 && <p className='muted'>Nothing yet: the address exists only on paper until the first execution.</p>}
          {chain && chain.entries.length > 0 && (
            <div className='chain'>
              <HistoryList entries={chain.entries} tag={e => (e.counterparty?.toLowerCase() === net.safe.paymasterAddress.toLowerCase() ? ' · paymaster fee' : '')} />
            </div>
          )}
    </section>
  )

  // one proposal in full: every signature, the execution, the receipt, the raw user operation
  const detailOf = (p) => (
    <div className='detail'>
      <div className='history-head'>
        <h4 className='eyebrow'>Trail of {short(p.proposalId, 12)}</h4>
        {p.execution && <button className='link small' onClick={() => setOpened(null)}>hide</button>}
      </div>
      <div className='detail-summary'>
        <span className='what'>{p.meta ? `${p.meta.amount} ${p.meta.asset}` : 'custom operation'}</span>
        {p.meta?.recipient && <span className='muted'>to {p.meta.toLabel ? `${p.meta.toLabel} ` : ''}<code title={p.meta.recipient}>{shortAddress(p.meta.recipient)}</code></span>}
        <span className='muted'>from the Safe <code>{shortAddress(safe.address)}</code></span>
      </div>
      <ol className='timeline'>
        {p.confirmations.map((c, i) => (
          <li key={c.owner} className='tl-item done'>
            <span className='tl-dot' />
            <div className='tl-body'>
              <div className='tl-title'>{i === 0 ? 'Proposed' : 'Approved'} by {custodyPill(c, c.owner)}<span className='muted small'>{when(c.at)}</span></div>
              <div className='tl-meta'>{SIGNS[c.signerId] ?? 'signed the SafeOp'} · signature {i + 1} of {safe.threshold}</div>
              <details className='tl-raw'><summary>signature</summary><code>{c.signature}</code></details>
            </div>
          </li>
        ))}
        {p.confirmations.length < safe.threshold && !p.execution && (
          <li className='tl-item'>
            <span className='tl-dot' />
            <div className='tl-body'><div className='tl-title muted'>Waiting for {safe.threshold - p.confirmations.length} more signature{safe.threshold - p.confirmations.length > 1 ? 's' : ''}</div></div>
          </li>
        )}
        {p.execution
          ? (
            <li className='tl-item done'>
              <span className='tl-dot' />
              <div className='tl-body'>
                <div className='tl-title'>Executed by {custodyPill(p.execution.by, 'exec')}<span className='muted small'>{when(p.execution.at)}</span></div>
                <div className='tl-meta'>user operation sent to the bundler{p.execution.txHash ? `, ${p.execution.success === false ? 'reverted' : 'mined'} in block ${p.execution.blockNumber ? Number(p.execution.blockNumber) : '…'}` : ', receipt pending'}</div>
                <div className='step-links'>
                  <a className='mini' href={`${net.blockscout}/op/${p.execution.hash}`} target='_blank' rel='noreferrer'>user op {short(p.execution.hash, 8)}</a>
                  {p.execution.txHash && <a className='mini' href={`${net.explorer}/tx/${p.execution.txHash}`} target='_blank' rel='noreferrer'>tx {short(p.execution.txHash, 8)}</a>}
                </div>
                <div className='tl-meta'>fee taken in {token.symbol} by the paymaster {shortAddress(net.safe.paymasterAddress)}, visible on the tx; the module's own figure ({p.execution.moduleMaxGasCost}) is a max gas cost, not {token.symbol}</div>
              </div>
            </li>
            )
          : p.confirmations.length >= safe.threshold && (
            <li className='tl-item'>
              <span className='tl-dot' />
              <div className='tl-body'><div className='tl-title muted'>Ready: any owner can execute</div></div>
            </li>
          )}
      </ol>
      <details className='tl-raw wide'>
        <summary>User operation, as signed and stored by the coordinator</summary>
        <pre className='details'>{formatDetails({ safeAddress: p.safeAddress, entryPoint: p.entryPoint, moduleAddress: p.moduleAddress, options: p.options, userOperation: p.userOperation })}</pre>
      </details>
    </div>
  )

  const header = (
    <div className='ms-head'>
      <label className='select-wrap'>
        <span className='eyebrow'>Configuration</span>
        <select className='select' value={configId} onChange={ev => chooseConfig(ev.target.value)} aria-label='Safe configuration'>
          {CONFIGS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <p className='muted'>{config.blurb}. Same Safe module, same page: only the owners change.</p>
    </div>
  )

  if (!net.safe) {
    return (
      <div className='ms'>
        {header}
        <section className='tile'>
          <h2 className='eyebrow'>Multisig</h2>
          <p className='muted'>The Safe demo runs on Arbitrum One, where Candide's paymaster takes its fee in USDT0. Switch the Testnet toggle off.</p>
        </section>
      </div>
    )
  }

  return (
    <div className='ms'>
      {header}
      {serviceError && <p className='warn'>Signer service unreachable: {serviceError}. Run <code>npm run service</code>.</p>}
      {safeError && <p className='warn'>{safeError}</p>}

      {/* 1. the Safe */}
      <section className={`tile banner ${safe ? 'ready' : ''}`}>
        {safe === undefined && <p className='muted'>Loading the Safe…</p>}
        {safe === null && (
          <div className='banner-empty'>
            <div>
              <h2 className='eyebrow'>Safe · {config.label} · not set up on {net.label}</h2>
              <p className='muted'>Owners: {config.owners.map(o => nameOf(o)).join(', ')} by default, editable. The Safe gets a counterfactual address and deploys with its first operation, gas paid in {token.symbol}.</p>
            </div>
            <button className='btn primary' onClick={openSetup} disabled={Boolean(serviceError)}>Set up the Safe</button>
          </div>
        )}
        {safe && (
          <div className='banner-grid'>
            <div className='banner-main'>
              <div className='tile-top'>
                <span className='tile-label'>Safe · {config.label} · {safe.threshold} of {safe.owners.length}</span>
                <span className={`status-pill ${balances?.deployed ? 'ok' : 'plain'}`}>{balances ? (balances.deployed ? 'deployed' : 'not deployed yet') : '…'}</span>
              </div>
              <div className='addr big'>
                <code title={safe.address}>{safe.address}</code>
                <button className='mini' onClick={() => copy(safe.address, 'safe')}>{copied === 'safe' ? 'copied' : 'copy'}</button>
                <a className='mini' href={`${net.explorer}/address/${safe.address}`} target='_blank' rel='noreferrer'>explorer</a>
              </div>
              <div className='path'>Safe modules v0.2.0 · EntryPoint v0.6 · salt {safe.saltNonce} · {net.label}, chain {net.chainId}</div>
              {balances && !balances.deployed && <p className='muted small'>Not deployed: the first executed proposal carries the deployment. The Safe must hold the amount plus the fee before anything can be estimated.</p>}
            </div>
            <div className='banner-side'>
              <div className='tile-value' title={held ?? ''}>{balances ? (shortBalance(held) ?? '—') : <span className='skeleton' />}{balances && <span className='unit'>{token.symbol}</span>}</div>
              <div className='tokens'><span className='token'><b>{shortBalance(balances?.native) ?? '…'}</b> {net.native}, none needed</span>{balances?.error && <span className='token'>{balances.error}</span>}</div>
              <div className='banner-actions'>
                <button className='btn' onClick={() => setFund({ amount: '0.25' })} disabled={busy !== null}>Fund from seed #0</button>
                <button className='btn primary' onClick={() => openTransfer()} disabled={busy !== null}>New transfer</button>
              </div>
              <button className='link small' onClick={forget}>Forget this Safe</button>
            </div>
          </div>
        )}
      </section>

      {/* 2. the owners */}
      <section className='owners' aria-label='Owners'>
        {ownerCards.map(o => {
          const key = keyOfOwner(o)
          const state = owners[key]
          const role = roleOf(o)
          const entry = byId(o.signerId)
          const onNet = entry?.available && entry.networks?.includes(net.id)
          const mine = active?.confirmations.find(c => sameOwner(c, o))
          const canApprove = safe && active && !role?.confirmed && active.confirmations.length < safe.threshold
          const canExecute = safe && active && active.confirmations.length >= safe.threshold
          const isBusy = busy && sameOwner(busy.owner, o)
          const status = !safe
            ? 'preview'
            : isBusy
              ? `${busy.action}…`
              : state?.phase === 'connecting'
                ? 'connecting…'
                : state?.phase === 'error'
                  ? 'error'
                  : !onNet
                    ? `not on ${net.label}`
                    : role?.proposer
                        ? 'proposed'
                        : role?.confirmed
                          ? 'approved'
                          : canApprove
                            ? 'waiting for signature'
                            : canExecute
                              ? 'can execute'
                              : entry?.prompts && state?.phase !== 'ready' ? 'connect to sign' : 'idle'
          return (
            <article key={key} className={`tile owner ${role?.confirmed ? 'signed' : ''} ${isBusy ? 'busy' : ''}`}>
              <div className='owner-head'>
                <span className='label'>{nameOf(o)}</span>
                <span className={`custody ${custodyOf(o.signerId)}`}>{custodyOf(o.signerId)}</span>
              </div>
              <div className='owner-kind'>{entry?.kind ?? o.signerId}</div>
              <div className='addr'>
                {o.address
                  ? <><code title={o.address}>{shortAddress(o.address)}</code><a className='mini' href={`${net.explorer}/address/${o.address}`} target='_blank' rel='noreferrer'>explorer</a></>
                  : <span className='muted'>account {o.index ?? 0} of {entry?.label ?? o.signerId}</span>}
              </div>
              <div className='state'><span className={`state-dot ${state?.phase === 'ready' || role?.confirmed ? 'ready' : state?.phase === 'connecting' || isBusy ? 'connecting' : state?.phase === 'error' ? 'error' : ''}`} />{status}</div>
              {state?.error && <p className='warn'>{state.error}</p>}
              {mine && (
                <details className='signed-block'>
                  <summary>Signed the SafeOp · {when(mine.at)}</summary>
                  <div className='signed-what'>{SIGNS[o.signerId]}</div>
                  <div className='mono'>hash {short(active.proposalId, 12)}</div>
                  <div className='mono'>sig {short(mine.signature, 12)}</div>
                </details>
              )}
              {safe && (
                <div className='owner-actions'>
                  {!active && <button className='btn' disabled={busy !== null || !onNet} onClick={() => openTransfer(o)}>Propose as {nameOf(o)}</button>}
                  {canApprove && <button className='btn primary' disabled={busy !== null || !onNet} onClick={() => approve(active.proposalId, o)}>Approve as {nameOf(o)}</button>}
                  {canExecute && <button className='btn primary' disabled={busy !== null || !onNet} onClick={() => execute(active.proposalId, o)}>Execute as {nameOf(o)}</button>}
                </div>
              )}
            </article>
          )
        })}
      </section>

      {/* 3. the flow */}
      {safe && (
        <section className='flow' aria-label='Transaction flow'>
          {(() => {
            const p = selected
            const n = p?.confirmations.length ?? 0
            const steps = [
              { title: 'Proposed', done: Boolean(p), who: p?.proposedBy, sub: p ? `${p.meta?.amount ?? ''} ${p.meta?.asset ?? ''} to ${p.meta?.toLabel ?? shortAddress(p.meta?.recipient ?? '')}` : 'any owner proposes and signs first' },
              { title: `Approved (${n} of ${safe.threshold})`, done: n >= safe.threshold, who: null, sub: p ? (n >= safe.threshold ? 'threshold met' : `needs ${safe.threshold - n} more owner${safe.threshold - n > 1 ? 's' : ''}`) : 'other owners add their signature' },
              {
                title: 'Executed',
                done: Boolean(p?.execution),
                who: p?.execution?.by,
                sub: p?.execution
                  ? (p.execution.txHash ? 'mined' : receiptsPending.has(p.proposalId) ? 'sent to the bundler, waiting for the receipt…' : 'sent to the bundler')
                  : p?.status === 'expired'
                    ? `sponsorship expired at ${when(p.expiresAt)}, re-propose`
                    : (n >= safe.threshold ? 'any owner can execute' : 'after the threshold') + (secondsLeft !== null ? `, paymaster sponsorship valid for ${secondsLeft} s` : '')
              }
            ]
            return steps.map((s, i) => (
              <div key={s.title} className='flow-item'>
                {i > 0 && <span className={`arrow ${steps[i - 1].done ? 'done' : ''}`} aria-hidden='true' />}
                <div className={`step ${s.done ? 'done' : ''} ${i === 2 && p?.status === 'expired' ? 'expired' : ''}`}>
                  <span className='num'>{i + 1}</span>
                  <div className='step-body'>
                    <div className='step-title'>{s.title}</div>
                    {i === 1 && p && <div className='step-who'>{p.confirmations.map(c => custodyPill(c, c.owner))}</div>}
                    {i !== 1 && s.who && <div className='step-who'>{custodyPill(s.who, 'who')}{s.who.at && <span className='muted small'>{when(s.who.at)}</span>}</div>}
                    {i === 2 && p?.execution && <div className='step-who'><span className='muted small'>{when(p.execution.at)}</span></div>}
                    <div className='step-sub'>{s.sub}</div>
                    {i === 2 && p?.execution && (
                      <div className='step-links'>
                        <a className='mini' href={`${net.blockscout}/op/${p.execution.hash}`} target='_blank' rel='noreferrer'>user op</a>
                        {p.execution.txHash && <a className='mini' href={`${net.explorer}/tx/${p.execution.txHash}`} target='_blank' rel='noreferrer'>tx</a>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          })()}
        </section>
      )}

      {/* 4. proposals, each one opening on its full trail: while in flight, or on a click once executed */}
      {safe && (
        <section className='proposals'>
          <div className='history-head'>
            <h4 className='eyebrow'>Proposals · {proposals.length}</h4>
            <button className='link small' onClick={() => { refreshProposals(); refreshBalances(safe.address) }}>refresh</button>
          </div>
          {proposals.length === 0 && <p className='muted'>No proposal yet. Fund the Safe, then propose a transfer as one of the owners.</p>}
          <ul>
            {proposals.map(p => (
              <li key={p.proposalId}>
                <button className={`proposal ${p.proposalId === selectedId ? 'active' : ''}`} title={p.execution ? 'show or hide the detail' : 'select'} onClick={() => { setSelectedId(p.proposalId); setOpened(o => (o === p.proposalId ? null : p.proposalId)) }}>
                  <span className='main'>
                    <span className='what'>{p.meta ? `${p.meta.amount} ${p.meta.asset} to ${p.meta.toLabel ?? shortAddress(p.meta.recipient)}` : 'custom operation'}</span>
                    <span className='sub'>{short(p.proposalId, 12)} · by {nameOf(p.proposedBy)} · {when(p.createdAt)}</span>
                  </span>
                  <span className='confs'>{p.confirmations.map(c => custodyPill(c, c.owner))}<span className='muted small'>{p.confirmations.length}/{safe.threshold}</span></span>
                  <span className={`status-pill ${p.status === 'executed' ? 'ok' : p.status === 'ready' ? 'warn' : p.status === 'expired' ? 'bad' : 'plain'}`}>{p.status}</span>
                </button>
                {p.proposalId === selectedId && (!p.execution || opened === p.proposalId) && detailOf(p)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {onChain && (slot ? createPortal(onChain, slot) : onChain)}

      {/* sheets */}
      {setup && (
        <div className='modal-backdrop' onClick={() => setSetup(null)}>
          <div className='modal' role='dialog' aria-label='Set up the Safe' onClick={ev => ev.stopPropagation()}>
            <h4 className='eyebrow'>Set up the {config.label} Safe on {net.label}</h4>
            <p className='muted small'>Any account of the seed, account 0 of every other signer. Nothing is sent: the address is computed from the owners, the threshold and the salt.</p>
            <ul className='checks'>
              {setup.candidates.map(c => {
                const address = setup.addresses[c.key]
                const checked = setup.picked.has(c.key)
                return (
                  <li key={c.key}>
                    <label className={`check ${!c.entry.available ? 'off' : ''}`}>
                      <input type='checkbox' checked={checked} disabled={!c.entry.available || !address} onChange={ev => setSetup(s => { const picked = new Set(s.picked); if (ev.target.checked) picked.add(c.key); else picked.delete(c.key); return { ...s, picked, threshold: Math.min(s.threshold, Math.max(1, picked.size)) } })} />
                      <span className='label'>{nameOf(c)}</span>
                      <span className={`custody ${c.entry.key}`}>{c.entry.key}</span>
                      <span className='addr-cell'>
                        {address ? <code title={address}>{shortAddress(address)}</code> : !c.entry.available ? <span className='reason'>{c.entry.reason}</span> : c.entry.prompts ? <button className='mini' onClick={ev => { ev.preventDefault(); connectForSetup(c) }}>connect</button> : <span className='muted'>{setup.resolving ? 'resolving…' : 'no account'}</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className='setup-row'>
              <span className='eyebrow'>Threshold</span>
              <div className='assets'>
                {Array.from({ length: Math.max(1, setup.picked.size) }, (_, i) => i + 1).map(n => (
                  <button key={n} className={`pill ${setup.threshold === n ? 'active' : ''}`} onClick={() => setSetup(s => ({ ...s, threshold: n }))}>{n} of {setup.picked.size}</button>
                ))}
              </div>
            </div>
            <label className='field compact'>
              <span className='eyebrow'>Salt, optional</span>
              <span className='input'><input placeholder='0x… to reproduce a known Safe, else derived from owners and threshold' value={setup.salt} onChange={ev => setSetup(s => ({ ...s, salt: ev.target.value }))} /></span>
            </label>
            <div className='predicted'>
              <span className='eyebrow'>Predicted address</span>
              {predicted ? <code>{predicted}</code> : <span className='muted small'>{setup.picked.size === 0 ? 'pick at least one owner' : setupInputs ? 'computing…' : 'waiting for every picked owner to resolve'}</span>}
            </div>
            {setup.error && <p className='warn'>{setup.error}</p>}
            <div className='sheet-actions'>
              <button className='btn' onClick={() => setSetup(null)}>Cancel</button>
              <button className='btn primary' disabled={!predicted} onClick={createSafe}>Create {setup.threshold} of {setup.picked.size}</button>
            </div>
          </div>
        </div>
      )}

      {transfer && safe && (
        <div className='modal-backdrop' onClick={() => setTransfer(null)}>
          <div className='modal' role='dialog' aria-label='New transfer' onClick={ev => ev.stopPropagation()}>
            <h4 className='eyebrow'>New transfer from the Safe {shortAddress(safe.address)}</h4>
            <p className='muted small'>The funds leave the Safe. An owner only signs: the initiator below gives the first of the {safe.threshold} signatures, the others approve, any owner executes.</p>
            <label className='field'>
              <span className='eyebrow'>Amount</span>
              <span className='input'>
                <input inputMode='decimal' value={transfer.amount} onChange={ev => setTransfer(t => ({ ...t, amount: ev.target.value }))} />
                <span className='unit'>{transfer.asset ? transfer.asset.symbol : net.native}</span>
              </span>
              <span className='muted small'>the Safe holds {shortBalance(held) ?? '…'} {token.symbol}; the fee comes out of it too, taken by the paymaster, no {net.native} involved</span>
            </label>
            <div className='eyebrow'>To, one of the owners</div>
            <ul className='targets'>
              <li>
                {ownerCards.map(o => (
                  <button key={keyOfOwner(o)} className={`target ${transfer.to === o.address ? 'active' : ''}`} onClick={() => setTransfer(t => ({ ...t, to: o.address, toLabel: nameOf(o), custom: '' }))} title={o.address}>
                    <span>{nameOf(o)} <span className={`custody ${custodyOf(o.signerId)}`}>{custodyOf(o.signerId)}</span></span><code>{shortAddress(o.address)}</code>
                  </button>
                ))}
              </li>
            </ul>
            <label className='field compact'>
              <span className='eyebrow'>Or any other recipient</span>
              <span className='input'><input placeholder='0x…' value={transfer.custom} onChange={ev => { const v = ev.target.value.trim(); setTransfer(t => ({ ...t, custom: ev.target.value, ...(isAddress(v) ? { to: v, toLabel: null } : {}) })) }} /></span>
            </label>
            <div className='setup-row'>
              <span className='eyebrow'>Initiator, signs first</span>
              <div className='assets'>
                {safe.owners.map(o => <button key={keyOfOwner(o)} className={`pill ${sameOwner(transfer.as, o) ? 'active' : ''}`} onClick={() => setTransfer(t => ({ ...t, as: o }))}>{nameOf(o)}</button>)}
              </div>
            </div>
            {transfer.error && <p className='warn'>{transfer.error}</p>}
            {held !== undefined && Number(held) === 0 && <p className='warn'>The Safe holds no {token.symbol}: fund it first, the bundler cannot estimate an empty Safe.</p>}
            <div className='sheet-actions'>
              <button className='btn' onClick={() => setTransfer(null)}>Cancel</button>
              <button className='btn primary' disabled={!transfer.to} onClick={propose}>Propose {transfer.amount || '0'} {transfer.asset ? transfer.asset.symbol : net.native} as {nameOf(transfer.as)}</button>
            </div>
          </div>
        </div>
      )}

      {fund && safe && (
        <div className='modal-backdrop' onClick={() => setFund(null)}>
          <div className='modal' role='dialog' aria-label='Fund the Safe' onClick={ev => ev.stopPropagation()}>
            <h4 className='eyebrow'>Fund the Safe from seed #0</h4>
            <p className='muted small'>A gasless {token.symbol} transfer through the 7702 account of the demo seed, gas paid in {token.symbol}. The Safe needs the amount of its next transfer plus a fee of a few cents.</p>
            <label className='field'>
              <span className='eyebrow'>Amount</span>
              <span className='input'>
                <input inputMode='decimal' value={fund.amount} onChange={ev => setFund({ amount: ev.target.value })} />
                <span className='unit'>{token.symbol}</span>
              </span>
            </label>
            <div className='sheet-actions'>
              <button className='btn' onClick={() => setFund(null)}>Cancel</button>
              <button className='btn primary' onClick={confirmFund}>Send {fund.amount || '0'} {token.symbol} to the Safe</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
