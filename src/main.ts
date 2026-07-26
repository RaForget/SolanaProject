import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

import { initWallet } from '@solana/wallet-adapter-vue'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { WalletReadyState } from '@solana/wallet-adapter-base'

// Import Wallet Adapter default styles from direct path
import '../node_modules/@solana/wallet-adapter-vue-ui/styles.css'

// Polyfill legacy .ready() method on adapter prototypes for @solana/wallet-adapter-vue (v0.4.5) compatibility
;[PhantomWalletAdapter, SolflareWalletAdapter].forEach((AdapterClass: any) => {
  if (AdapterClass && AdapterClass.prototype && typeof AdapterClass.prototype.ready !== 'function') {
    AdapterClass.prototype.ready = async function () {
      return (
        this.readyState === WalletReadyState.Installed ||
        this.readyState === 'Installed' ||
        this.readyState === WalletReadyState.Loadable ||
        this.readyState === 'Loadable' ||
        !!(window as any).solana ||
        !!(window as any).phantom ||
        !!(window as any).solflare
      )
    }
  }
})

// Initialize the global wallet store
initWallet({
  wallets: [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ],
  autoConnect: true,
})

createApp(App).mount('#app')
