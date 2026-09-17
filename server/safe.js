// The Safe side of the service: one Safe per network, described in `.safe/<network>.json`, and the
// multisig coordinator over the same file. Owners are recovered from their signatures, so the
// service never needs a key: it only checks that a signature comes from one of the Safe's owners.
import { Hono } from 'hono'
import { join } from 'node:path'
import { getAddress } from 'ethers'
import { NETWORKS } from '../src/lib/networks.js'
import { networksOf } from '../src/lib/support.js'
import { deterministicSalt, normaliseOwners, predictSafeAddress } from '../src/lib/safe/config.js'
import LocalCoordinator from '../src/lib/safe/local-coordinator.js'
import { parse, stringify } from '../src/lib/json.js'
import SafeFileStore from './safe/store.js'

export function createSafeRoutes ({ dir, log = console.error }) {
  const app = new Hono()
  const stores = new Map()
  const storeOf = (network) => {
    if (!stores.has(network)) stores.set(network, new SafeFileStore(join(dir, `${network}.json`)))
    return stores.get(network)
  }
  const json = (c, value, status = 200) => c.body(stringify(value), status, { 'content-type': 'application/json' })
  const fail = (c, message, status = 400) => c.json({ error: message }, status)

  // every route names the network; the Safe of that network is loaded with it
  app.use('/:network/*', async (c, next) => {
    const net = NETWORKS[c.req.param('network')]
    if (!net) return fail(c, `unknown network ${c.req.param('network')}`, 404)
    const store = storeOf(net.id)
    const safe = store.read().safe
    c.set('net', net)
    c.set('store', store)
    c.set('safe', safe)
    c.set('coordinator', new LocalCoordinator({ store, owners: safe ? safe.owners.map(o => o.address) : [] }))
    await next()
  })
  app.use('/:network', async (c, next) => {
    const net = NETWORKS[c.req.param('network')]
    if (!net) return fail(c, `unknown network ${c.req.param('network')}`, 404)
    c.set('net', net)
    c.set('store', storeOf(net.id))
    c.set('safe', storeOf(net.id).read().safe)
    await next()
  })

  // the Safe as described at creation: owners with their signer, threshold, salt, predicted address
  app.get('/:network', (c) => json(c, { network: c.get('net').id, safe: c.get('safe') }))

  app.post('/:network', async (c) => {
    const net = c.get('net')
    if (!net.safe) return fail(c, `${net.label} has no Safe configuration in this demo`)
    if (c.get('safe')) return fail(c, `a Safe already exists on ${net.label}, forget it first`, 409)
    let body
    try {
      body = parse(await c.req.text())
      const owners = (body.owners ?? []).map(o => ({ signerId: o.signerId, address: getAddress(o.address) }))
      for (const o of owners) {
        if (!networksOf(o.signerId).includes(net.id)) throw new Error(`${o.signerId} is not available on ${net.label}`)
      }
      const list = normaliseOwners(owners.map(o => o.address))
      if (list.length !== owners.length) throw new Error('two owners share an address')
      const threshold = Number(body.threshold)
      const saltNonce = body.saltNonce ?? deterministicSalt(list, threshold)
      const address = await predictSafeAddress(net, { owners: list, threshold, saltNonce })
      const safe = {
        network: net.id,
        address,
        owners: list.map(a => owners.find(o => o.address === a)),
        threshold,
        saltNonce,
        createdAt: new Date().toISOString()
      }
      c.get('store').write(d => { d.safe = safe })
      return json(c, { network: net.id, safe }, 201)
    } catch (e) {
      log(`[safe] create on ${net.id}: ${e.message}`)
      return fail(c, e.message)
    }
  })

  // forgets the description and the proposals; the chain keeps whatever was deployed
  app.delete('/:network', (c) => {
    c.get('store').write(d => { d.safe = null; d.proposals = {}; d.messages = {} })
    return c.body(null, 204)
  })

  const withSigners = (c, record) => {
    if (!record) return record
    const safe = c.get('safe')
    const signerOf = (address) => safe?.owners.find(o => o.address === address)?.signerId ?? null
    return {
      ...record,
      confirmations: record.confirmations.map(x => ({ ...x, signerId: signerOf(x.owner) })),
      proposedBy: record.confirmations[0] ? { owner: record.confirmations[0].owner, signerId: signerOf(record.confirmations[0].owner), at: record.confirmations[0].at } : null,
      status: record.execution ? 'executed' : record.confirmations.length >= (safe?.threshold ?? Infinity) ? 'ready' : 'pending'
    }
  }

  app.get('/:network/proposals', (c) => {
    const list = Object.values(c.get('store').read().proposals).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return json(c, list.map(r => withSigners(c, r)))
  })

  app.post('/:network/proposals', async (c) => {
    if (!c.get('safe')) return fail(c, 'no Safe on this network yet', 404)
    try {
      const { proposalId, proposal, meta } = parse(await c.req.text())
      const record = await c.get('coordinator').submitProposal(proposalId, { ...proposal, meta: meta ?? null })
      return json(c, withSigners(c, record), 201)
    } catch (e) {
      log(`[safe] propose: ${e.message}`)
      return fail(c, e.message)
    }
  })

  app.get('/:network/proposals/:id', async (c) => {
    const record = await c.get('coordinator').getProposal(c.req.param('id'))
    return record ? json(c, withSigners(c, record)) : fail(c, 'unknown proposal', 404)
  })

  app.post('/:network/proposals/:id/confirmations', async (c) => {
    try {
      const { signature } = parse(await c.req.text())
      const record = await c.get('coordinator').confirmProposal(c.req.param('id'), signature)
      return json(c, withSigners(c, record))
    } catch (e) {
      log(`[safe] confirm: ${e.message}`)
      return fail(c, e.message, /unknown proposal/.test(e.message) ? 404 : 400)
    }
  })

  // the page reports the execution: the user operation hash, who sent it, the fee it saw
  app.post('/:network/proposals/:id/execution', async (c) => {
    const id = c.req.param('id')
    const store = c.get('store')
    if (!store.get(id)) return fail(c, 'unknown proposal', 404)
    const execution = { ...parse(await c.req.text()), at: new Date().toISOString() }
    store.set(id, {
      ...store.get(id),
      execution,
      // what the module reads to answer `status: 'executed'`
      userOperation: { ...store.get(id).userOperation, ethereumTxHash: execution.txHash ?? execution.hash }
    })
    return json(c, withSigners(c, store.get(id)))
  })

  app.post('/:network/messages', async (c) => {
    const { safeAddress, messageId, message } = parse(await c.req.text())
    return json(c, await c.get('coordinator').submitMessage(safeAddress, messageId, message), 201)
  })

  app.get('/:network/messages/:id', async (c) => {
    const record = await c.get('coordinator').getMessage(c.req.param('id'))
    return record ? json(c, record) : fail(c, 'unknown message', 404)
  })

  app.post('/:network/messages/:id/confirmations', async (c) => {
    try {
      const { signature } = parse(await c.req.text())
      return json(c, await c.get('coordinator').confirmMessage(c.req.param('id'), signature))
    } catch (e) {
      return fail(c, e.message, 404)
    }
  })

  return app
}
