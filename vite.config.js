import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// The WDK packages reach for Buffer and a few Node globals, hence the polyfills.
// The signer packages are linked from sibling folders (file:), so the shims the polyfill plugin
// injects into their dependency trees are pinned to absolute paths, and sodium takes its JS build.
// /api goes to the local signer service, which holds the API keys.
const shim = (name) => fileURLToPath(new URL(`./node_modules/vite-plugin-node-polyfills/shims/${name}/dist/index.js`, import.meta.url))

export default defineConfig({
  plugins: [react(), nodePolyfills({ globals: { Buffer: true, global: true, process: true } })],
  resolve: {
    alias: {
      'vite-plugin-node-polyfills/shims/buffer': shim('buffer'),
      'vite-plugin-node-polyfills/shims/global': shim('global'),
      'vite-plugin-node-polyfills/shims/process': shim('process'),
      'sodium-native': 'sodium-javascript'
    }
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' }
  }
})
