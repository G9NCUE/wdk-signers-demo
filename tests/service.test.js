// The service's own rules, on fakes: JSON bodies only, local origins only, a signer's network
// forwarded to the right root, errors that say what they are, no local path in a reason.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { HDNodeWallet } from 'ethers'
import { InvalidSignerError } from '@tetherto/wdk-wallet'
import { SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import RemoteSignerEvm from '../src/signers/remote-signer-evm.js'
import { publicReason } from '../server/http.js'
import { registryOf, startService } from './helpers/service.js'

const A = 'test test test test test test test test test test test junk'
const B = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const first = (m) => HDNodeWallet.fromPhrase(m, undefined, "m/44'/60'/0'/0/0").address

let service
before(async () => {
  // one provider whose Sepolia and Arbitrum roots are different keys, as Dfns' wallets per network are
  service = await startService(registryOf([
    { id: 'two', label: 'Two', kind: 'per network', root: new SeedSignerEvm(A), roots: { sepolia: new SeedSignerEvm(A), arbitrum: new SeedSignerEvm(B) }, networks: ['sepolia', 'arbitrum'] },
    { id: 'down', label: 'Down', kind: 'unconfigured', root: null, available: false, reason: "ENOENT: no such file or directory, open '/Users/someone/wdk-signers-demo/fireblocks_secret.key'" }
  ]))
})
after(() => service.close())

const post = (path, body, headers = { 'content-type': 'application/json' }) => fetch(`${service.baseUrl}${path}`, { method: 'POST', headers, body })

test('the network in the body picks the root: same provider, two keys', async () => {
  const path = "m/44'/60'/0'/0/0"
  const sepolia = new RemoteSignerEvm({ id: 'two', path, isDerivable: true, baseUrl: service.baseUrl, network: 'sepolia' })
  const arbitrum = new RemoteSignerEvm({ id: 'two', path, isDerivable: true, baseUrl: service.baseUrl, network: 'arbitrum' })
  assert.equal(await sepolia.getAddress(), first(A))
  assert.equal(await arbitrum.getAddress(), first(B))
  const none = new RemoteSignerEvm({ id: 'two', path, isDerivable: true, baseUrl: service.baseUrl, network: 'polygon' })
  await assert.rejects(none.getAddress(), (e) => e.message === 'two: two is not configured for polygon' && !(e instanceof InvalidSignerError))
})

test('a POST without a JSON content type, or with a broken body, is a 400 that says so', async () => {
  let res = await post('/signers/two/address', 'network=sepolia', { 'content-type': 'text/plain' })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /application\/json/)
  res = await post('/signers/two/address', '{not json')
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /malformed/)
  res = await post('/safe/arbitrum/mixed/proposals/0x01/execution', '{', { 'content-type': 'application/json' })
  assert.equal(res.status, 404, 'the Safe routes are not mounted without a directory')
})

test('a request naming a foreign origin is refused, a local one is served', async () => {
  const foreign = await fetch(`${service.baseUrl}/signers`, { headers: { origin: 'https://evil.example' } })
  assert.equal(foreign.status, 403)
  const local = await fetch(`${service.baseUrl}/signers`, { headers: { origin: 'http://localhost:5173' } })
  assert.equal(local.status, 200)
})

test('an unavailable provider gives its reason without the local path, and a service down says so', async () => {
  const [, down] = await (await fetch(`${service.baseUrl}/signers`)).json()
  assert.equal(down.available, false)
  assert.ok(!down.reason.includes('/Users/'), down.reason)
  assert.match(down.reason, /a local file/)
  assert.equal(publicReason(null), null)
  const gone = new RemoteSignerEvm({ id: 'two', path: null, isDerivable: false, baseUrl: 'http://127.0.0.1:1/api' })
  await assert.rejects(gone.getAddress(), /two: the signer service is unreachable .*npm run service/)
})
