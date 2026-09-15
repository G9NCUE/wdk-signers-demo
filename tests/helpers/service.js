// Starts the signing service in-process on an ephemeral port, on a given registry.
import { serve } from '@hono/node-server'
import { createApp } from '../../server/app.js'

export async function startService (registry, { log = () => {} } = {}) {
  const app = createApp(registry, { log })
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise(resolve => server.once('listening', resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
    close: () => new Promise(resolve => server.close(resolve))
  }
}

export function registryOf (entries) {
  return new Map(entries.map(e => [e.id, { children: new Map(), available: true, reason: null, ...e }]))
}
