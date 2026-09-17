// Phase 0 of the Safe 2-of-3: three owners on three custody models, one Safe, one USDT0 transfer.
// Owners: seed #0 (in-process), Dfns #0 and Openfort (through the service in-process, as the browser
// would). Dry by default: install, predict, quote. SPIKE_EXECUTE=1 runs the broadcasting steps:
// fund the Safe, propose, approve with a second owner, execute.
// Run: node --env-file=.env server/safe-spike.mjs
import { Contract, JsonRpcProvider, formatUnits, getAddress } from 'ethers'
import { SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import RemoteSignerEvm from '../src/signers/remote-signer-evm.js'
import { createWallet, gaslessOf, rpcOf } from '../src/lib/wallet.js'
import { NETWORKS } from '../src/lib/networks.js'
import SafeOwnerAccount from '../src/lib/safe/owner-account.js'
import LocalCoordinator from '../src/lib/safe/local-coordinator.js'
import { buildRegistry } from './registry.js'
import { startService } from '../tests/helpers/service.js'

const net = NETWORKS.arbitrum
const USDT0 = net.tokens[0]
const EXECUTE = process.env.SPIKE_EXECUTE === '1'
const SEED = (process.env.VITE_DEMO_SEED_PHRASE ?? '').trim().replace(/^["']|["']$/g, '')
if (!SEED) throw new Error('VITE_DEMO_SEED_PHRASE is not set in .env')
const SALT = process.env.SAFE_SALT_NONCE || '0x' + BigInt(20260917).toString(16)
const t0 = Date.now()
const step = (m) => console.log(`[${String(Date.now() - t0).padStart(6)} ms] ${m}`)

// --- owners --------------------------------------------------------------------------------------
const service = await startService(buildRegistry())
const listed = await (await fetch(`${service.baseUrl}/signers`)).json()
const remote = (id) => {
  const s = listed.find(x => x.id === id)
  if (!s?.available) throw new Error(`${id}: ${s?.reason ?? 'not in the registry'}`)
  return createWallet(new RemoteSignerEvm({ id, path: s.path, isDerivable: s.isDerivable, baseUrl: service.baseUrl, network: net.id }), net.id)
}
const seedHandle = createWallet(new SeedSignerEvm(SEED), net.id)
const dfnsHandle = remote('dfns')
const openfortHandle = remote('openfort')
const owners = {
  seed: await seedHandle.wallet.getAccount(0),
  dfns: await dfnsHandle.wallet.getAccount(0),
  openfort: await openfortHandle.wallet.getAccount('remote')
}
const seed1 = await seedHandle.wallet.getAccount(1)
const addresses = {}
for (const [k, a] of Object.entries(owners)) addresses[k] = await a.getAddress()
step(`owners: seed ${addresses.seed}, dfns ${addresses.dfns}, openfort ${addresses.openfort}`)

// --- the Safe -------------------------------------------------------------------------------------
const ownerList = Object.values(addresses).map(a => getAddress(a)).sort()
const coordinator = new LocalCoordinator({ owners: ownerList })
const config = {
  provider: rpcOf(net),
  chainId: BigInt(net.chainId),
  bundlerUrl: net.safe.bundlerUrl,
  paymasterUrl: net.safe.bundlerUrl,
  paymasterAddress: net.safe.paymasterAddress, // Candide token paymaster, EntryPoint v0.6, Arbitrum
  paymasterTokenAddress: net.safe.paymasterToken.address,
  coordinator,
  safeOptions: { owners: ownerList, threshold: 2, saltNonce: SALT }
}
const safeAs = {}
for (const [k, a] of Object.entries(owners)) safeAs[k] = new SafeOwnerAccount(a, config)
const predicted = await Promise.all(Object.values(safeAs).map(s => s.getAddress()))
if (new Set(predicted).size !== 1) throw new Error('owners predict different Safe addresses: ' + predicted.join(', '))
const safeAddress = predicted[0]
const deployed = await safeAs.seed.isDeployed()
step(`Safe 2-of-3 ${safeAddress}, salt ${SALT}, deployed: ${deployed}`)

const usdt = new Contract(USDT0.address, ['function balanceOf(address) view returns (uint256)'], new JsonRpcProvider(rpcOf(net), net.chainId, { staticNetwork: true }))
const balance = async (a) => formatUnits(await usdt.balanceOf(a), USDT0.decimals)
step(`Safe holds ${await balance(safeAddress)} USDT0; seed #0 ${await balance(addresses.seed)}, seed #1 ${await balance(await seed1.getAddress())}`)

const transfer = { token: USDT0.address, recipient: await seed1.getAddress(), amount: 200000n } // 0.2 USDT0
try {
  const q = await safeAs.seed.quoteTransfer(transfer)
  step(`quote: fee ${formatUnits(q.fee, USDT0.decimals)} USDT0 for the first operation (deployment included when not deployed)`)
} catch (e) {
  step(`quote failed: ${e.message.slice(0, 200)}`)
}

if (!EXECUTE) {
  step('dry run done; SPIKE_EXECUTE=1 to fund, propose, approve and execute')
} else {
  // --- fund ---------------------------------------------------------------------------------------
  if ((await usdt.balanceOf(safeAddress)) < 300000n) {
    const gl = gaslessOf(owners.seed, net)
    const r = await gl.transfer({ token: USDT0.address, recipient: safeAddress, amount: 500000n })
    step(`funded the Safe with 0.5 USDT0 from seed #0, gasless, user op ${r.hash}`)
    await new Promise(r => setTimeout(r, 8000))
    step(`Safe holds ${await balance(safeAddress)} USDT0`)
  }
  // --- propose as seed ------------------------------------------------------------------------------
  const proposal = await safeAs.seed.proposeTransfer(transfer)
  step(`proposed by seed: ${proposal.proposalId}, ${proposal.confirmations}/${proposal.threshold}, ${proposal.status}`)
  // --- approve as Dfns ------------------------------------------------------------------------------
  const approval = await safeAs.dfns.approveProposal(proposal.proposalId)
  step(`approved by dfns: ${approval.confirmations}/${approval.threshold}`)
  console.log('  confirmations:', (await coordinator.getProposal(proposal.proposalId)).confirmations.map(c => c.owner).join(', '))
  // --- execute as Openfort --------------------------------------------------------------------------
  const result = await safeAs.openfort.executeProposal(proposal.proposalId)
  step(`executed by openfort: user op ${result.hash}, fee ${formatUnits(result.fee ?? 0n, USDT0.decimals)} USDT0`)
  await new Promise(r => setTimeout(r, 10000))
  step(`Safe deployed: ${await safeAs.seed.isDeployed()}; Safe ${await balance(safeAddress)} USDT0; seed #1 ${await balance(await seed1.getAddress())} USDT0`)
}

for (const s of Object.values(safeAs)) s.dispose()
for (const h of [seedHandle, dfnsHandle, openfortHandle]) h.wallet.dispose()
await service.close()
