import { createApp, h } from 'vue'
import './style.css'
import App from './App.vue'

import { WalletProvider } from '@solana/wallet-adapter-vue'
import { WalletModalProvider } from '@solana/wallet-adapter-vue-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { WalletReadyState } from '@solana/wallet-adapter-base'

// Import Wallet Adapter default styles from direct path
import '../node_modules/@solana/wallet-adapter-vue-ui/styles.css'

// Polyfill legacy .adapter property and .ready() method on adapter prototypes
;[PhantomWalletAdapter, SolflareWalletAdapter].forEach((AdapterClass: any) => {
  if (AdapterClass && AdapterClass.prototype) {
    if (!('adapter' in AdapterClass.prototype)) {
      Object.defineProperty(AdapterClass.prototype, 'adapter', {
        get() {
          return this
        },
        configurable: true,
      })
    }
    if (typeof AdapterClass.prototype.ready !== 'function') {
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
  }
})

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
]

const RootApp = {
  render() {
    return h(WalletProvider, { wallets, autoConnect: true }, () => [
      h(WalletModalProvider, null, () => [
        h(App)
      ])
    ])
  }
}

createApp(RootApp).mount('#app')
