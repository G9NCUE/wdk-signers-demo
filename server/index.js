// Local signing service. Holds the remote signers and their API keys, answers the browser's
// RemoteSignerEvm over HTTP. Run: node --env-file=.env server/index.js
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { buildRegistry } from './registry.js'
import { parse, stringify } from '../src/lib/json.js'

const registry = buildRegistry()
const app = new Hono()

app.get('/api/signers', (c) => {
  const list = [...registry.values()].map(({ id, label, kind, available, reason, root }) => ({
    id, label, kind, available, reason, isDerivable: root ? root.isDerivable : null, path: root?.path ?? null
  }))
  return c.json(list)
})

// every operation names the signer by provider id and derivation path, the service keeps the
// derived children so a path maps to one signer instance
app.post('/api/signers/:id/:op', async (c) => {
  const entry = registry.get(c.req.param('id'))
  if (!entry) return c.json({ error: 'unknown signer' }, 404)
  if (!entry.available) return c.json({ error: entry.reason }, 503)
  const body = parse(await c.req.text())
  try {
    const signer = await resolve(entry, body.path)
    const result = await run(entry, signer, c.req.param('op'), body)
    return c.body(stringify(result), 200, { 'content-type': 'application/json' })
  } catch (e) {
    console.error(`[${entry.id}] ${c.req.param('op')}: ${e.message}`)
    return c.json({ error: e.message }, 500)
  }
})

async function resolve (entry, path) {
  if (!path || path === entry.root.path) return entry.root
  const child = entry.children.get(path)
  if (!child) throw new Error(`unknown derived path ${path}, call derive first`)
  return child
}

async function run (entry, signer, op, body) {
  switch (op) {
    case 'derive': {
      const child = await entry.root.derive(body.relPath)
      entry.children.set(child.path, child)
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

const port = Number(process.env.SIGNER_SERVICE_PORT || 8787)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  const status = [...registry.values()].map(e => `${e.id}: ${e.available ? 'ready' : e.reason}`).join('\n  ')
  console.log(`signer service on http://127.0.0.1:${port}\n  ${status}`)
})
