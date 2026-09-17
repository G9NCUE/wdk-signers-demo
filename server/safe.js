// The Safe side of the service: one Safe per network and configuration ("seed" for three accounts
// of one seed, "mixed" for one seed account and two other signers, any slug works), described in
// `.safe/<network>.<config>.json`, and the multisig coordinator over the same file. Owners are
// recovered from their signatures, so the service never needs a key: it only checks that a
// signature comes from one of the Safe's owners.
import { Hono } from 'hono'
import { join } from 'node:path'
import { getAddress } from 'ethers'
import { NETWORKS } from '../src/lib/networks.js'
import { networksOf } from '../src/lib/support.js'
import { deterministicSalt, normaliseOwners, predictSafeAddress } from '../src/lib/safe/config.js'
import LocalCoordinator from '../src/lib/safe/local-coordinator.js'
import { expiryOf } from '../src/lib/safe/paymaster.js'
import { parse, stringify } from '../src/lib/json.js'
import SafeFileStore from './safe/store.js'

const CONFIG = /^[a-z0-9][a-z0-9-]{0,31}$/

export function createSafeRoutes ({ dir, log = console.error }) {
  const app = new Hono()
  const stores = new Map()
  const storeOf = (network, config) => {
    const key = `${network}.${config}`
    if (!stores.has(key)) stores.set(key, new SafeFileStore(join(dir, `${key}.json`)))
    return stores.get(key)
  }
  const json = (c, value, status = 200) => c.body(stringify(value), status, { 'content-type': 'application/json' })
  const fail = (c, message, status = 400) => c.json({ error: message }, status)

  // every route names the network and the configuration; the Safe of that pair is loaded with it
  const load = async (c, next) => {
    const net = NETWORKS[c.req.param('network')]
    if (!net) return fail(c, `unknown network ${c.req.param('network')}`, 404)
    const config = c.req.param('config')
    if (!CONFIG.test(config)) return fail(c, `bad configuration name ${config}`, 404)
    const store = storeOf(net.id, config)
    const safe = store.read().safe
    c.set('net', net)
    c.set('config', config)
    c.set('store', store)
    c.set('safe', safe)
    c.set('coordinator', new LocalCoordinator({ store, owners: safe ? safe.owners.map(o => o.address) : [] }))
    await next()
  }
  app.use('/:network/:config', load)
  app.use('/:network/:config/*', load)

  // the Safe as described at creation: owners with their signer and account index, threshold, salt,
  // predicted address
  app.get('/:network/:config', (c) => json(c, { network: c.get('net').id, config: c.get('config'), safe: c.get('safe') }))

  app.post('/:network/:config', async (c) => {
    const net = c.get('net')
    if (!net.safe) return fail(c, `${net.label} has no Safe configuration in this demo`)
    if (c.get('safe')) return fail(c, `a Safe already exists for ${c.get('config')} on ${net.label}, forget it first`, 409)
    try {
      const body = parse(await c.req.text())
      const owners = (body.owners ?? []).map(o => ({ signerId: o.signerId, index: Number.isInteger(o.index) ? o.index : 0, address: getAddress(o.address) }))
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
        config: c.get('config'),
        address,
        owners: list.map(a => owners.find(o => o.address === a)),
        threshold,
        saltNonce,
        createdAt: new Date().toISOString()
      }
      c.get('store').write(d => { d.safe = safe })
      return json(c, { network: net.id, config: c.get('config'), safe }, 201)
    } catch (e) {
      log(`[safe] create ${c.get('config')} on ${net.id}: ${e.message}`)
      return fail(c, e.message)
    }
  })

  // forgets the description and the proposals; the chain keeps whatever was deployed
  app.delete('/:network/:config', (c) => {
    c.get('store').write(d => { d.safe = null; d.proposals = {}; d.messages = {} })
    return c.body(null, 204)
  })

  // which signer and account an owner address is, from the Safe's description
  const withSigners = (c, record) => {
    if (!record) return record
    const safe = c.get('safe')
    const who = (address) => {
      const o = safe?.owners.find(x => x.address === address)
      return o ? { signerId: o.signerId, index: o.index } : { signerId: null, index: null }
    }
    const first = record.confirmations[0]
    // the paymaster's sponsorship has a deadline; past it the signed operation cannot be sent
    const { expiresAt, expired } = expiryOf(record.userOperation)
    return {
      ...record,
      confirmations: record.confirmations.map(x => ({ ...x, ...who(x.owner) })),
      proposedBy: first ? { owner: first.owner, ...who(first.owner), at: first.at } : null,
      expiresAt,
      status: record.execution ? 'executed' : expired ? 'expired' : record.confirmations.length >= (safe?.threshold ?? Infinity) ? 'ready' : 'pending'
    }
  }

  app.get('/:network/:config/proposals', (c) => {
    const list = Object.values(c.get('store').read().proposals).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return json(c, list.map(r => withSigners(c, r)))
  })

  app.post('/:network/:config/proposals', async (c) => {
    if (!c.get('safe')) return fail(c, 'no Safe for this configuration yet', 404)
    try {
      const { proposalId, proposal, meta } = parse(await c.req.text())
      const record = await c.get('coordinator').submitProposal(proposalId, { ...proposal, meta: meta ?? null })
      return json(c, withSigners(c, record), 201)
    } catch (e) {
      log(`[safe] propose: ${e.message}`)
      return fail(c, e.message)
    }
  })

  app.get('/:network/:config/proposals/:id', async (c) => {
    const record = await c.get('coordinator').getProposal(c.req.param('id'))
    return record ? json(c, withSigners(c, record)) : fail(c, 'unknown proposal', 404)
  })

  app.post('/:network/:config/proposals/:id/confirmations', async (c) => {
    try {
      const { signature } = parse(await c.req.text())
      const record = await c.get('coordinator').confirmProposal(c.req.param('id'), signature)
      return json(c, withSigners(c, record))
    } catch (e) {
      log(`[safe] confirm: ${e.message}`)
      return fail(c, e.message, /unknown proposal/.test(e.message) ? 404 : 400)
    }
  })

  // the page reports the execution: the user operation hash, who sent it, later the receipt
  app.post('/:network/:config/proposals/:id/execution', async (c) => {
    const id = c.req.param('id')
    const store = c.get('store')
    if (!store.get(id)) return fail(c, 'unknown proposal', 404)
    const previous = store.get(id)
    const execution = { at: previous.execution?.at ?? new Date().toISOString(), ...parse(await c.req.text()) }
    store.set(id, {
      ...previous,
      execution,
      // what the module reads to answer `status: 'executed'`
      userOperation: { ...previous.userOperation, ethereumTxHash: execution.txHash ?? execution.hash }
    })
    return json(c, withSigners(c, store.get(id)))
  })

  app.post('/:network/:config/messages', async (c) => {
    const { safeAddress, messageId, message } = parse(await c.req.text())
    return json(c, await c.get('coordinator').submitMessage(safeAddress, messageId, message), 201)
  })

  app.get('/:network/:config/messages/:id', async (c) => {
    const record = await c.get('coordinator').getMessage(c.req.param('id'))
    return record ? json(c, record) : fail(c, 'unknown message', 404)
  })

  app.post('/:network/:config/messages/:id/confirmations', async (c) => {
    try {
      const { signature } = parse(await c.req.text())
      return json(c, await c.get('coordinator').confirmMessage(c.req.param('id'), signature))
    } catch (e) {
      return fail(c, e.message, 404)
    }
  })

  return app
}
