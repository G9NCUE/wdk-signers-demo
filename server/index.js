// Local signing service. Holds the remote signers and their API keys, answers the browser's
// RemoteSignerEvm over HTTP. Run: node --env-file=.env server/index.js
import { serve } from '@hono/node-server'
import { buildRegistry } from './registry.js'
import { createApp } from './app.js'

const registry = buildRegistry()
const safeDir = process.env.SAFE_DIR || '.safe'
const app = createApp(registry, { safeDir })

const port = Number(process.env.SIGNER_SERVICE_PORT || 8787)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  const status = [...registry.values()].map(e => `${e.id}: ${e.available ? 'ready' : e.reason}`).join('\n  ')
  const indexer = process.env.WDK_INDEXER_API_KEY ? 'key set' : 'no key, USDT history off'
  console.log(`signer service on http://127.0.0.1:${port}\n  ${status}\n  history: Blockscout for ETH, WDK indexer for USDT (${indexer})\n  safe: one per network in ${safeDir}/`)
})
