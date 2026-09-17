// The signing service as a Hono app, built from a registry so tests can run it in-process on fakes.
// Routes: GET /api/signers, GET /api/history/:address, POST /api/signers/:id/:op, and under
// /api/safe the Safe of each network with its proposals (server/safe.js) when a directory is given.
import { Hono } from 'hono'
import { history } from './history.js'
import { createSafeRoutes } from './safe.js'
import { BadRequest, json, localOnly, publicReason, readJson } from './http.js'

export function createApp (registry, { log = console.error, safeDir = null } = {}) {
  const app = new Hono()
  app.use('/api/*', localOnly)
  app.onError((e, c) => (e instanceof BadRequest ? c.json({ error: e.message }, 400) : (log(`[service] ${e.message}`), c.json({ error: e.message }, 500))))
  if (safeDir) app.route('/api/safe', createSafeRoutes({ dir: safeDir, log }))

  // ETH transactions and USDT transfers of one address, newest first
  app.get('/api/history/:address', async (c) => {
    const address = c.req.param('address')
    try {
      return c.json(await history(address, { limit: Number(c.req.query('limit') || 20), network: c.req.query('network') || undefined }))
    } catch (e) {
      log(`[history] ${address}: ${e.message}`)
      return c.json({ error: e.message, address }, 400)
    }
  })

  app.get('/api/signers', (c) => {
    const list = [...registry.values()].map(({ id, label, kind, available, reason, root, networks }) => ({
      id, label, kind, available, reason: publicReason(reason), networks, isDerivable: root ? root.isDerivable : null, path: root?.path ?? null
    }))
    return c.json(list)
  })

  // every operation names the signer by provider id and derivation path, the service keeps the
  // derived children so a path maps to one signer instance
  app.post('/api/signers/:id/:op', async (c) => {
    const entry = registry.get(c.req.param('id'))
    if (!entry) return c.json({ error: 'unknown signer' }, 404)
    if (!entry.available) return c.json({ error: entry.reason }, 503)
    const body = await readJson(c)
    const network = body.network ?? entry.networks[0]
    if (!entry.roots[network]) return c.json({ error: `${entry.id} is not configured for ${network}` }, 400)
    try {
      const signer = await resolve(entry, network, body.path)
      const result = await run(entry, network, signer, c.req.param('op'), body)
      return json(c, result)
    } catch (e) {
      log(`[${entry.id}] ${c.req.param('op')}: ${e.message}`)
      return c.json({ error: e.message }, 500)
    }
  })

  return app
}

async function resolve (entry, network, path) {
  const root = entry.roots[network]
  if (!path || path === root.path) return root
  const child = entry.children.get(`${network}:${path}`)
  if (!child) throw new Error(`unknown derived path ${path} on ${network}, call derive first`)
  return child
}

async function run (entry, network, signer, op, body) {
  switch (op) {
    case 'derive': {
      const child = await entry.roots[network].derive(body.relPath)
      entry.children.set(`${network}:${child.path}`, child)
      return { path: child.path }
    }
    case 'address': {
      const address = await signer.getAddress()
      const { publicKey } = signer.keyPair
      return { address, publicKey: publicKey ? Array.from(publicKey) : null }
    }
    case 'sign':
      return { signature: await signer.sign(body.message) }
    case 'signTransaction':
      return { signedTransaction: await signer.signTransaction(body.unsignedTx) }
    case 'signTypedData':
      return { signature: await signer.signTypedData(body) }
    case 'signAuthorization': {
      const auth = await signer.signAuthorization(body.auth)
      return { authorization: { ...auth, signature: auth.signature.serialized } }
    }
    default:
      throw new Error(`unknown operation ${op}`)
  }
}
