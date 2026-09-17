// The whole flow on the real providers configured in .env, on every network each signer supports,
// without broadcasting anything: service in-process on the real registry, RemoteSignerEvm in front
// like the browser, then per signer and network: balance from the chain, a transaction populated from
// the chain (nonce, fees) signed and recovered, a message, typed data, and on Arbitrum the token
// balance plus a gasless quote through the 7702 module when the account holds USDT0. The seed signer
// runs in-process too. Ledger and MetaMask need a browser.
// Run: node --env-file=.env --test tests/live/*.test.js   (LIVE_NETWORKS=arbitrum narrows it)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JsonRpcProvider, Transaction, formatEther, formatUnits, verifyMessage, verifyTypedData } from 'ethers'
import { SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import RemoteSignerEvm from '../../src/signers/remote-signer-evm.js'
import { NETWORKS } from '../../src/lib/networks.js'
import { networksOf } from '../../src/lib/support.js'
import { createWallet, gaslessOf, rpcOf } from '../../src/lib/wallet.js'
import { buildRegistry } from '../../server/registry.js'
import { startService } from '../helpers/service.js'

// the demo seed from .env when set, a throwaway otherwise
const SEED = (process.env.VITE_DEMO_SEED_PHRASE || '').trim().replace(/^["']|["']$/g, '') || 'test test test test test test test test test test test junk'
const ONLY = (process.env.LIVE_NETWORKS || '').split(',').map(s => s.trim()).filter(Boolean)
const networks = Object.values(NETWORKS).filter(n => !ONLY.length || ONLY.includes(n.id))

let service, signers
const providers = {}
before(async () => {
  service = await startService(buildRegistry())
  signers = await (await fetch(`${service.baseUrl}/signers`)).json()
  for (const n of networks) providers[n.id] = new JsonRpcProvider(rpcOf(n), n.chainId, { staticNetwork: true })
})
after(async () => { Object.values(providers).forEach(p => p.destroy()); await service.close() })

// the same checks the phone runs, minus the send
async function flow (t, account, net, label) {
  const provider = providers[net.id]
  const address = await account.getAddress()
  assert.match(address, /^0x[0-9a-fA-F]{40}$/, `${label}: address`)

  const balance = await account.getBalance()
  assert.equal(typeof balance, 'bigint', `${label}: balance is a bigint`)
  const tokens = []
  for (const token of net.tokens) tokens.push(`${formatUnits(await account.getTokenBalance(token.address), token.decimals)} ${token.symbol}`)
  t.diagnostic(`${label} ${address} ${formatEther(balance)} ${net.native}${tokens.length ? ', ' + tokens.join(', ') : ''}`)

  const [nonce, fees] = await Promise.all([provider.getTransactionCount(address), provider.getFeeData()])
  assert.ok(fees.maxFeePerGas > 0n, `${label}: fee data from the chain`)
  const unsigned = { type: 2, chainId: net.chainId, nonce, to: address, value: 0n, data: '0x', gasLimit: 21000n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
  const tx = Transaction.from(await account.signTransaction(unsigned))
  assert.equal(tx.from, address, `${label}: signed transaction recovers to the account`)
  assert.equal(tx.nonce, nonce, `${label}: nonce kept`)
  assert.equal(tx.chainId, BigInt(net.chainId), `${label}: chain kept`)

  const message = `wdk signers flow ${net.id} ${Date.now()}`
  assert.equal(verifyMessage(message, await account.sign(message)), address, `${label}: message`)

  const typed = { domain: { name: 'WDK', version: '1', chainId: net.chainId, verifyingContract: address }, types: { Transfer: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] }, message: { to: address, amount: 42 } }
  assert.equal(verifyTypedData(typed.domain, typed.types, typed.message, await account.signTypedData(typed)), address, `${label}: typed data`)

  // the gasless route is quoted, never sent: the paymaster only quotes an account that holds the token
  if (net.gasless) {
    const token = net.gasless.paymasterToken
    const held = await account.getTokenBalance(token.address)
    if (held > 0n) {
      const { fee } = await gaslessOf(account, net).quoteTransfer({ token: token.address, recipient: address, amount: 1n })
      assert.ok(fee > 0n, `${label}: gasless quote is a fee in ${token.symbol}`)
      t.diagnostic(`${label} gasless quote ${formatUnits(fee, token.decimals)} ${token.symbol} for a 1-unit transfer`)
    } else {
      t.diagnostic(`${label} holds no ${token.symbol}, gasless quote skipped`)
    }
  }
}

for (const net of networks) {
  test(`seed signer on ${net.label}, in the app`, async (t) => {
    const handle = createWallet(new SeedSignerEvm(SEED), net.id)
    await flow(t, await handle.wallet.getAccount(0), net, `seed #0 ${net.id}`)
    handle.wallet.dispose()
  })

  for (const id of ['turnkey', 'dfns', 'openfort', 'fireblocks']) {
    test(`${id} on ${net.label}, through the service`, async (t) => {
      if (!networksOf(id).includes(net.id)) return t.skip(`${id} is configured for ${networksOf(id).join(', ')} only`)
      const s = signers.find(x => x.id === id)
      if (!s?.available) return t.skip(`${id}: ${s?.reason ?? 'not in the registry'}`)
      const signer = new RemoteSignerEvm({ id: s.id, path: s.path, isDerivable: s.isDerivable, baseUrl: service.baseUrl })
      const handle = createWallet(signer, net.id)
      let account
      if (s.isDerivable) {
        account = await handle.wallet.getAccount(0)
        const other = await handle.wallet.getAccount(1)
        assert.notEqual(await other.getAddress(), await account.getAddress(), `${id}: accounts 0 and 1 differ`)
      } else {
        account = await handle.wallet.getAccount('remote')
      }
      try {
        await flow(t, account, net, `${id} #0 ${net.id}`)
      } catch (e) {
        // a plan quota is the provider's condition, not the code's: skip with the reason, fail otherwise
        if (/quota|Resource exhausted/i.test(e.message)) return t.skip(`${id}: provider quota, ${e.message}`)
        throw e
      } finally {
        handle.wallet.dispose()
      }
    })
  }
}

test('browser signers are listed but need a browser', (t) => {
  t.diagnostic('ledger and metamask: run npm run test:browser with the dev server up')
})
