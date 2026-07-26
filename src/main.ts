import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

import { initWallet } from '@solana/wallet-adapter-vue'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'

// Import Wallet Adapter default styles from direct path
import '../node_modules/@solana/wallet-adapter-vue-ui/styles.css'

// Initialize the global wallet store
initWallet({
  wallets: [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ],
  autoConnect: true,
})

createApp(App).mount('#app')
