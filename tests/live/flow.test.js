// The whole flow on the real providers configured in .env, without broadcasting anything:
// service in-process on the real registry, RemoteSignerEvm in front like the browser, then per signer:
// balance from Sepolia, a transaction populated from the chain (nonce, fees), signed and recovered,
// a message and typed data. The seed signer runs in-process too. Ledger and MetaMask need a browser.
// Run: node --env-file=.env --test tests/live/*.test.js
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JsonRpcProvider, Transaction, formatEther, verifyMessage, verifyTypedData } from 'ethers'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import RemoteSignerEvm from '../../src/signers/remote-signer-evm.js'
import { buildRegistry } from '../../server/registry.js'
import { startService } from '../helpers/service.js'

const CHAIN_ID = 11155111
const RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEED = 'test test test test test test test test test test test junk'

let service, signers, provider
before(async () => {
  service = await startService(buildRegistry())
  signers = await (await fetch(`${service.baseUrl}/signers`)).json()
  provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true })
})
after(async () => { provider?.destroy(); await service.close() })

// the same checks the phone runs, minus the send
async function flow (t, account, label) {
  const address = await account.getAddress()
  assert.match(address, /^0x[0-9a-fA-F]{40}$/, `${label}: address`)

  const balance = await account.getBalance()
  assert.equal(typeof balance, 'bigint', `${label}: balance is a bigint`)
  t.diagnostic(`${label} ${address} balance ${formatEther(balance)} ETH`)

  const [nonce, fees] = await Promise.all([provider.getTransactionCount(address), provider.getFeeData()])
  assert.ok(fees.maxFeePerGas > 0n, `${label}: fee data from the chain`)
  const unsigned = { type: 2, chainId: CHAIN_ID, nonce, to: address, value: 0n, data: '0x', gasLimit: 21000n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
  const signed = await account.signTransaction(unsigned)
  const tx = Transaction.from(signed)
  assert.equal(tx.from, address, `${label}: signed transaction recovers to the account`)
  assert.equal(tx.nonce, nonce, `${label}: nonce kept`)
  assert.equal(tx.chainId, BigInt(CHAIN_ID), `${label}: chain kept`)

  const message = `wdk signers flow ${Date.now()}`
  assert.equal(verifyMessage(message, await account.sign(message)), address, `${label}: message`)

  const typed = { domain: { name: 'WDK', version: '1', chainId: CHAIN_ID, verifyingContract: address }, types: { Transfer: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] }, message: { to: address, amount: 42 } }
  assert.equal(verifyTypedData(typed.domain, typed.types, typed.message, await account.signTypedData(typed)), address, `${label}: typed data`)
}

test('seed signer, in the app', async (t) => {
  const wallet = new WalletManagerEvm(new SeedSignerEvm(SEED), { provider: RPC_URL, chainId: CHAIN_ID })
  await flow(t, await wallet.getAccount(0), 'seed #0')
  wallet.dispose()
})

for (const id of ['turnkey', 'dfns', 'openfort', 'fireblocks']) {
  test(`${id}, through the service`, async (t) => {
    const s = signers.find(x => x.id === id)
    if (!s?.available) return t.skip(`${id}: ${s?.reason ?? 'not in the registry'}`)
    const signer = new RemoteSignerEvm({ id: s.id, path: s.path, isDerivable: s.isDerivable, baseUrl: service.baseUrl })
    const config = { provider: RPC_URL, chainId: CHAIN_ID }
    let wallet, account
    if (s.isDerivable) {
      wallet = new WalletManagerEvm(signer, config)
      account = await wallet.getAccount(0)
      const other = await wallet.getAccount(1)
      assert.notEqual(await other.getAddress(), await account.getAddress(), `${id}: accounts 0 and 1 differ`)
    } else {
      wallet = new WalletManagerEvm(SEED, config)
      wallet.addSigner('remote', signer)
      account = await wallet.getAccount('remote')
    }
    try {
      await flow(t, account, `${id} #0`)
    } catch (e) {
      // a plan quota is the provider's condition, not the code's: skip with the reason, fail otherwise
      if (/quota|Resource exhausted/i.test(e.message)) return t.skip(`${id}: provider quota, ${e.message}`)
      throw e
    } finally {
      wallet.dispose()
    }
  })
}

test('browser signers are listed but need a browser', (t) => {
  t.diagnostic('ledger and metamask: run npm run test:browser with the dev server up')
})
