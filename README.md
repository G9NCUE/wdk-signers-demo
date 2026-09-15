# wdk-signers-demo

One Vite app, one `WalletManagerEvm` from `@tetherto/wdk-wallet-evm` 1.0.0-beta.18, seven signers
behind the same `ISigner` contract. The app is drawn as a phone: a wallet home with the signer as a
chip at the top, the balance card, the address, the accounts, and three actions: sign a message, sign
a populated transaction offline, send ETH to another account the demo controls (the send sheet lists
the seed accounts, the remote signers' accounts, and Ledger or MetaMask once connected; default
0.0005 ETH, any amount above zero). Switching signer in the bottom sheet rebuilds the
accounts and refreshes the Sepolia balances. A developer panel on the side keeps the full log, each
entry expandable to the bytes behind it.

| Signer | Where the key is | Runs in | Package |
|---|---|---|---|
| Seed phrase | this browser, localStorage, throwaway | browser | `@tetherto/wdk-wallet-evm/signers` |
| Ledger | the device, WebHID | browser | [wdk-signer-ledger-evm](https://github.com/G9NCUE/wdk-signer-ledger-evm) |
| MetaMask | the extension, EIP-1193 | browser | [wdk-signer-eip1193-evm](https://github.com/G9NCUE/wdk-signer-eip1193-evm) |
| Turnkey | Turnkey HD wallet | service | [wdk-signer-turnkey-evm](https://github.com/G9NCUE/wdk-signer-turnkey-evm) |
| Dfns | Dfns MPC, wallet per derived key | service | [wdk-signer-dfns-evm](https://github.com/G9NCUE/wdk-signer-dfns-evm) |
| Openfort | Openfort TEE backend wallet | service | [wdk-signer-openfort-evm](https://github.com/G9NCUE/wdk-signer-openfort-evm) |
| Fireblocks | Fireblocks MPC vault account | service | [wdk-signer-fireblocks-evm](https://github.com/G9NCUE/wdk-signer-fireblocks-evm) |

## How it is built

```
src/                the Vite + React app, WDK runs here
  signers/catalog.js             the list above, browser signers built in place
  signers/remote-signer-evm.js   ISigner whose calls go to the service over HTTP
  lib/wallet.js                  WalletManagerEvm per signer, accounts, balances, the three checks
server/             the local signing service, Hono on 127.0.0.1:8787
  registry.js                    one root signer per provider, built from .env
  index.js                       POST /api/signers/:id/{derive,address,sign,signTransaction,signTypedData,signAuthorization}
  probe.js                       the same calls from Node, through the real WalletManagerEvm
```

API keys never reach the browser: the service holds the four remote signers and answers with
addresses and signatures only. Derivable signers (seed, Ledger, Turnkey, Dfns) show accounts 0 to 2
at `44'/60'/0'/0/i`. Single-key signers (MetaMask, Openfort, Fireblocks) are registered by name with
`wallet.addSigner()` and show one account.

The phone shows the transaction history of the selected account, merged from two sources by the
service (`server/history.js`): native ETH transactions from Blockscout's public Sepolia API, and USDT
transfers from the **WDK indexer** (`https://wdk-api.tether.io`, key in `WDK_INDEXER_API_KEY`, free
registration). The WDK indexer is the WDK's own history feature, and it indexes token transfers only
(USDT, XAUt, BTC); native ETH history is not available from it, hence Blockscout for that half.
Without a key the ETH half still shows and the footer says so.

MetaMask (or Rabby, Coinbase Wallet) signs messages and typed data, but never returns a signed
transaction and does not sign EIP-7702 authorizations: "Sign tx" is greyed out for it, and "Send"
goes through the wallet's own `eth_sendTransaction` instead of the WDK's sign-then-broadcast.

## Design

Same tokens, type and components as [wdk-atlas](https://github.com/G9NCUE/wdk-atlas): dark ground,
orange accent, Inter, Space Grotesk and Inconsolata self-hosted under `public/assets/fonts/` (SIL Open
Font License, see the LICENSE.md there), 10 px cards on 1 px lines, mono uppercase eyebrows. The
balance is an atlas tile, the log an atlas chart card.

## Run

```
npm install
cp .env.example .env      # fill the providers you have, the others show as unavailable
npm run dev               # web on http://localhost:5173, service on 127.0.0.1:8787
```

The signer packages are linked from sibling folders (`file:../wdk-signer-*`), clone them next to
this one. Ledger needs Chrome or Edge, the device unlocked with the Ethereum app open; the first
click on Ledger opens the browser's device picker. Sepolia ETH comes from any faucet.

`node server/probe.js [id]` exercises the configured remote signers from the terminal, including
typed data and EIP-7702 authorizations, and prints the timing.

## Tests

Three layers, nothing is ever broadcast:

```
npm test              # offline: bigint JSON, the HTTP signer protocol through the real WalletManagerEvm
                      # on the WDK's own signers, the history merge on stubbed Blockscout and indexer replies
npm run test:live     # the flow on every provider configured in .env, service in-process: balance from
                      # Sepolia, a transaction populated from the chain and signed, message, typed data;
                      # unconfigured providers skip, a provider quota skips with the reason
npm run test:browser  # the phone in Chrome (Playwright, `chrome` channel) with `npm run dev` up:
                      # picker, accounts, balances, history, sign message, sign tx, log details;
                      # DEMO_SIGNER=Openfort picks another signer
```

Ledger and MetaMask need a device or an extension in a headed browser and stay manual.

## Findings on the WDK contract, from building this

- `account.signTransaction(tx)` hands the request to the signer as is; only `sendTransaction`
  populates nonce, fees and chain. Turnkey refuses an unpopulated transaction, the seed signer
  signs it with chain id 0. The demo populates before signing.
- Signer paths differ: `SeedSignerEvm` reports `m/44'/60'/0'/0/0`, the external signers
  `44'/60'/0'/0/0`. The manager copes (it keeps the last three segments), the UI shows both.
- beta.18 does not export `ISignerEvm`, every external signer follows the contract by shape.
- The Ledger kit 1.18 signs EIP-7702 authorizations (`signDelegationAuthorization`), which
  PR #89 of `wdk-wallet-evm` declared impossible in July.
- `ISignerEvm` assumes a signer returns bytes and the WDK broadcasts. Injected wallets and the
  Fireblocks web3 provider sign and broadcast in one step; the contract has no place for them
  today. An optional `sendTransaction` on the signer, preferred by the account when present, is
  what this demo does.
