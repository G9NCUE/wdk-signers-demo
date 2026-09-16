import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Same recipe as tetherto/wdk-playground/web-integration-vite: the WDK packages reach for Buffer,
// process and a few Node modules, the Ledger kits and sodium are pre-bundled so their ESM builds
// resolve, and sodium takes its JavaScript build in the browser.
// One addition: the signer packages are linked from sibling folders (file:), so the shims the
// polyfill plugin injects into their own dependency trees are pinned to absolute paths.
// /api goes to the local signer service, which holds the API keys.
const shim = (name) => fileURLToPath(new URL(`./node_modules/vite-plugin-node-polyfills/shims/${name}/dist/index.js`, import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      protocolImports: true,
      globals: { Buffer: true, process: true },
      modules: { buffer: true, process: true, util: true, stream: true, events: true, crypto: true, assert: true, path: true, string_decoder: true }
    })
  ],
  define: {
    'process.env': {},
    global: 'globalThis'
  },
  resolve: {
    alias: {
      'vite-plugin-node-polyfills/shims/buffer': shim('buffer'),
      'vite-plugin-node-polyfills/shims/global': shim('global'),
      'vite-plugin-node-polyfills/shims/process': shim('process'),
      'sodium-native': 'sodium-javascript'
    }
  },
  optimizeDeps: {
    include: [
      'sodium-universal',
      'sodium-javascript',
      '@ledgerhq/context-module',
      '@ledgerhq/device-management-kit',
      '@ledgerhq/device-transport-kit-web-hid',
      '@ledgerhq/device-signer-kit-ethereum',
      '@ledgerhq/signer-utils',
      'rxjs'
    ],
    rolldownOptions: { define: { global: 'globalThis' } }
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' }
  }
})
