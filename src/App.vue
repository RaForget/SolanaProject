<script setup lang="ts">
import { WalletMultiButton, WalletModalProvider } from '@solana/wallet-adapter-vue-ui'
import { useWallet, WalletProvider } from '@solana/wallet-adapter-vue'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { WalletReadyState } from '@solana/wallet-adapter-base'
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { ref, watch, computed } from 'vue'

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

// Custom QuickNode RPC endpoints provided by hackathon organizers
const rpcHttpUrl = 'https://polished-dry-forest.solana-devnet.quiknode.pro/c5943463eb6799a039aee8340e2028f80bcc570d/'
const rpcWsUrl = 'wss://polished-dry-forest.solana-devnet.quiknode.pro/c5943463eb6799a039aee8340e2028f80bcc570d/'
const connection = new Connection(rpcHttpUrl, {
  commitment: 'confirmed',
  wsEndpoint: rpcWsUrl,
})

// Hardcoded destination address (randomly generated Devnet address for checkout/donations)
const DESTINATION_ADDRESS = 'BgG5sM8vMuxQ1r15r7ZkG2Yd6eUoMh94R3N72yL5r5c5'
const CHECKOUT_AMOUNT_SOL = 0.05

// Configure wallet adapters
const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
]

// Wallet composables
const { publicKey, connected, sendTransaction } = useWallet()

// Reactive States
const balance = ref<number | null>(null)
const isLoadingBalance = ref(false)
const isProcessingTx = ref(false)
const statusStepMessage = ref('Aguardando Confirmação...')
const txSignature = ref<string | null>(null)
const errorMessage = ref<string | null>(null)

// Format PublicKey for UI display
const truncatedAddress = computed(() => {
  if (!publicKey.value) return ''
  const base58 = publicKey.value.toBase58()
  return `${base58.slice(0, 6)}...${base58.slice(-6)}`
})

// Fetch Wallet SOL balance
const fetchBalance = async (pubKey: PublicKey) => {
  isLoadingBalance.value = true
  try {
    const lamports = await connection.getBalance(pubKey)
    balance.value = lamports / LAMPORTS_PER_SOL
  } catch (err) {
    console.error('Error fetching balance:', err)
    balance.value = 0
  } finally {
    isLoadingBalance.value = false
  }
}

// Watch publicKey changes to update balance reactively
watch(publicKey, (newKey) => {
  if (newKey) {
    fetchBalance(newKey)
    errorMessage.value = null
    txSignature.value = null
  } else {
    balance.value = null
  }
}, { immediate: true })

// Computed connection check based on connected flag OR presence of publicKey
const isWalletConnected = computed(() => connected.value || !!publicKey.value)

// Execute Checkout Transaction
const handleCheckout = async () => {
  if (!publicKey.value) {
    errorMessage.value = 'Por favor, conecte sua carteira primeiro.'
    return
  }

  isProcessingTx.value = true
  statusStepMessage.value = 'Aprove na sua carteira Phantom...'
  errorMessage.value = null
  txSignature.value = null

  try {
    const recipientPubKey = new PublicKey(DESTINATION_ADDRESS)
    const lamportsToSend = CHECKOUT_AMOUNT_SOL * LAMPORTS_PER_SOL

    // 1. Pre-verify balance
    const currentBalanceLamports = await connection.getBalance(publicKey.value)
    if (currentBalanceLamports < lamportsToSend) {
      throw new Error(
        `Saldo insuficiente. Você precisa de pelo menos ${CHECKOUT_AMOUNT_SOL} SOL + taxas de transação. Seu saldo atual é de ${(
          currentBalanceLamports / LAMPORTS_PER_SOL
        ).toFixed(4)} SOL.`
      )
    }

    // 2. Build transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publicKey.value,
        toPubkey: recipientPubKey,
        lamports: lamportsToSend,
      })
    )

    // 3. Fetch latest blockhash
    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.feePayer = publicKey.value

    // 4. Send and request signature (preflight simulation enabled to ensure RPC node broadcasts packet)
    const signature = await sendTransaction(transaction, connection, { skipPreflight: false })
    console.log('Transaction sent. Signature:', signature)

    statusStepMessage.value = 'Processando na Solana Devnet...'

    // 5. Clean, reliable QuickNode polling (no WSS ping errors, no 133ms fetch spam)
    let confirmed = false
    const startTime = Date.now()
    const timeoutMs = 30000 // 30 seconds max poll

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        const status = await connection.getSignatureStatus(signature)
        if (status && status.value) {
          if (status.value.err) {
            throw new Error(`Erro na transação on-chain: ${JSON.stringify(status.value.err)}`)
          }
          if (
            status.value.confirmationStatus === 'confirmed' ||
            status.value.confirmationStatus === 'finalized' ||
            (!status.value.err && status.value.slot > 0)
          ) {
            confirmed = true
            break
          }
        }
      } catch (err: any) {
        if (err.message && err.message.includes('on-chain')) throw err
      }
    }

    if (!confirmed) {
      const finalStatus = await connection.getSignatureStatus(signature)
      if (finalStatus && finalStatus.value && !finalStatus.value.err) {
        confirmed = true
      } else {
        throw new Error('A confirmação excedeu o tempo limite. Verifique no Solana Explorer.')
      }
    }

    txSignature.value = signature
    // Refresh balance
    await fetchBalance(publicKey.value)
  } catch (err: any) {
    console.error('Transaction Error:', err)
    const errMsg = err.message || ''
    
    if (errMsg.includes('User rejected') || errMsg.includes('rejected the request')) {
      errorMessage.value = 'Transação cancelada: a assinatura foi rejeitada na carteira.'
    } else if (errMsg.includes('0x1')) {
      errorMessage.value = 'Saldo insuficiente para cobrir as taxas de rede (gas/rent).'
    } else if (errMsg.includes('0x0') || errMsg.includes('Attempt to debit an account')) {
      errorMessage.value = 'Saldo insuficiente para realizar a transferência de 0.05 SOL.'
    } else if (errMsg.includes('Blockhash not found') || errMsg.includes('blockhash') || errMsg.includes('expired') || errMsg.includes('block height exceeded')) {
      errorMessage.value = 'A transação expirou (o tempo de confirmação na carteira excedeu o limite do bloco). Por favor, clique em Confirmar e Pagar novamente.'
    } else {
      errorMessage.value = errMsg || 'Ocorreu um erro desconhecido durante a transação.'
    }
  } finally {
    isProcessingTx.value = false
  }
}
</script>

<template>
  <WalletProvider :wallets="wallets" auto-connect>
    <WalletModalProvider>
    <div class="relative min-h-screen w-full overflow-hidden bg-[#0b0f19] text-[#e2e8f0] flex flex-col items-center justify-between p-6 selection:bg-[#9945FF]/30 selection:text-white">
      <!-- Background Decorative Lights -->
      <div class="absolute top-[-10%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-[#9945FF]/10 blur-[120px] pointer-events-none"></div>
      <div class="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-[#14F195]/10 blur-[120px] pointer-events-none"></div>

      <!-- Header -->
      <header class="w-full max-w-4xl flex flex-col sm:flex-row items-center justify-between gap-4 z-10 py-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#9945FF] to-[#14F195] flex items-center justify-center shadow-lg shadow-[#9945FF]/20">
            <svg class="w-6 h-6 text-slate-900 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
          </div>
          <div>
            <h1 class="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-[#cbd5e1] bg-clip-text text-transparent">Superteam Checkout</h1>
            <p class="text-xs text-[#94a3b8] font-medium uppercase tracking-wider">Solana Devnet Hackathon</p>
          </div>
        </div>

        <!-- Wallet connection button -->
        <div class="flex items-center gap-3">
          <WalletMultiButton />
        </div>
      </header>

      <!-- Main Content -->
      <main class="w-full max-w-md my-auto z-10 flex flex-col gap-6">
        <!-- Checkout Card -->
        <div class="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-xl p-8 shadow-2xl">
          <!-- Glassmorphism Reflection light border -->
          <div class="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none"></div>

          <!-- Product Details -->
          <div class="text-center mb-6">
            <span class="px-3 py-1 text-xs font-semibold text-[#14F195] bg-[#14F195]/10 border border-[#14F195]/20 rounded-full">
              Devnet Checkout funcional
            </span>
            <h2 class="text-2xl font-bold text-white mt-4 tracking-tight">NFT Superteam Builder Pass</h2>
            <p class="text-sm text-slate-400 mt-1">Acesso exclusivo ao hub e mentorias do hackathon</p>
          </div>

          <!-- Divider -->
          <div class="h-px bg-gradient-to-r from-transparent via-slate-800 to-transparent my-6"></div>

          <!-- Checkout Details -->
          <div class="space-y-4">
            <div class="flex justify-between items-center text-sm">
              <span class="text-slate-400">Preço do passe</span>
              <span class="font-semibold text-white tracking-wide">{{ CHECKOUT_AMOUNT_SOL }} SOL</span>
            </div>
            
            <div class="flex justify-between items-center text-sm">
              <span class="text-slate-400">Rede</span>
              <span class="font-medium text-[#9945FF] uppercase tracking-wider text-xs">Solana Devnet</span>
            </div>

            <div class="flex justify-between items-center text-sm">
              <span class="text-slate-400">Destinatário</span>
              <span class="font-mono text-xs text-slate-300 bg-slate-800/50 px-2 py-1 rounded" :title="DESTINATION_ADDRESS">
                {{ DESTINATION_ADDRESS.slice(0, 6) }}...{{ DESTINATION_ADDRESS.slice(-6) }}
              </span>
            </div>
          </div>

          <!-- Divider -->
          <div class="h-px bg-gradient-to-r from-transparent via-slate-800 to-transparent my-6"></div>

          <!-- Wallet State Information -->
          <div class="mb-6 rounded-2xl bg-slate-950/40 border border-slate-800/60 p-4">
            <div v-if="isWalletConnected" class="space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500 font-medium">Carteira conectada</span>
                <span class="font-mono font-bold text-slate-300">{{ truncatedAddress }}</span>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500 font-medium">Saldo Devnet</span>
                <div class="flex items-center gap-1.5">
                  <span v-if="isLoadingBalance" class="w-3.5 h-3.5 border-2 border-[#14F195] border-t-transparent rounded-full animate-spin"></span>
                  <span v-else class="font-bold text-white">{{ balance !== null ? balance.toFixed(4) : '0.0000' }} SOL</span>
                </div>
              </div>
            </div>
            <div v-else class="text-center py-2">
              <p class="text-xs text-slate-400 font-medium">
                Conecte sua carteira para ver seu saldo e realizar a transação.
              </p>
            </div>
          </div>

          <!-- Dynamic CTA Button / Status Feedback -->
          <div>
            <!-- Not Connected -->
            <div v-if="!isWalletConnected" class="w-full text-center">
              <p class="text-xs text-slate-500 mb-2">Conecte sua carteira Solana no canto superior direito para prosseguir</p>
              <div class="w-full flex justify-center py-1 opacity-80 hover:opacity-100 transition-opacity">
                <!-- Fallback multi-button triggers modal directly -->
                <WalletMultiButton />
              </div>
            </div>

            <!-- Connected: Ready to Buy / Processing -->
            <button
              v-else
              @click="handleCheckout"
              :disabled="isProcessingTx || isLoadingBalance"
              class="w-full py-4 px-6 rounded-2xl font-bold transition-all duration-300 shadow-lg select-none flex items-center justify-center gap-2 group active:scale-[0.98]"
              :class="[
                isProcessingTx 
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700' 
                  : 'bg-gradient-to-r from-[#9945FF] to-[#14F195] text-slate-900 hover:shadow-[#9945FF]/20 hover:scale-[1.01]'
              ]"
            >
              <!-- Loading Spinner inside button -->
              <svg v-if="isProcessingTx" class="animate-spin -ml-1 mr-3 h-5 w-5 text-purple-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              
              <span v-if="isProcessingTx">{{ statusStepMessage }}</span>
              <span v-else>Confirmar e Pagar {{ CHECKOUT_AMOUNT_SOL }} SOL</span>
            </button>
          </div>
        </div>

        <!-- Success Alert -->
        <div 
          v-if="txSignature" 
          class="rounded-2xl border border-[#14F195]/30 bg-[#14F195]/5 p-5 backdrop-blur-xl animate-fade-in relative overflow-hidden"
        >
          <div class="absolute left-0 top-0 bottom-0 w-1 bg-[#14F195]"></div>
          <div class="flex gap-3">
            <div class="w-5 h-5 rounded-full bg-[#14F195]/20 flex items-center justify-center shrink-0">
              <svg class="w-3.5 h-3.5 text-[#14F195]" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <div class="space-y-1">
              <h4 class="text-sm font-bold text-[#14F195]">Transação Confirmada!</h4>
              <p class="text-xs text-slate-300">
                Seu ticket foi processado com sucesso. Verifique a transação no explorador.
              </p>
              <div class="pt-2">
                <a 
                  :href="`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`" 
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 text-xs text-[#14F195] font-semibold hover:underline"
                >
                  Ver no Solana Explorer
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- Error Alert -->
        <div 
          v-if="errorMessage" 
          class="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 backdrop-blur-xl animate-fade-in relative overflow-hidden"
        >
          <div class="absolute left-0 top-0 bottom-0 w-1 bg-red-500"></div>
          <div class="flex gap-3">
            <div class="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
              <svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </div>
            <div class="space-y-0.5">
              <h4 class="text-sm font-bold text-red-400">Falha na Transação</h4>
              <p class="text-xs text-slate-300 leading-relaxed">{{ errorMessage }}</p>
            </div>
          </div>
        </div>
      </main>

      <!-- Footer -->
      <footer class="w-full max-w-4xl text-center py-6 z-10 mt-auto">
        <p class="text-xs text-slate-600">
          Superteam TDC Hackathon &copy; 2026. Feito para demonstração na Devnet.
        </p>
      </footer>
    </div>
    </WalletModalProvider>
  </WalletProvider>
</template>

<style>
/* Override default Solana Wallet Multi Button Styles to match our aesthetic */
.wallet-adapter-button {
  background-color: rgb(15 23 42 / 0.8) !important;
  color: #fff !important;
  font-family: inherit !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  height: 48px !important;
  padding: 0 20px !important;
  border-radius: 16px !important;
  border: 1px solid rgb(30 41 59 / 0.8) !important;
  transition: all 0.3s ease !important;
  backdrop-filter: blur(12px) !important;
}

.wallet-adapter-button:not([disabled]):hover {
  background-color: rgb(30 41 59 / 0.9) !important;
  border-color: #9945FF !important;
  box-shadow: 0 0 15px rgb(153 69 255 / 0.15) !important;
  transform: translateY(-1px);
}

.wallet-adapter-button-trigger {
  background-image: linear-gradient(to right, #9945FF, #14F195) !important;
  color: #0f172a !important;
  border: none !important;
}

.wallet-adapter-button-trigger:not([disabled]):hover {
  background-image: linear-gradient(to right, #8a32eb, #0ee087) !important;
  color: #0f172a !important;
  box-shadow: 0 0 20px rgb(20 241 149 / 0.25) !important;
}

.wallet-adapter-button-start-icon {
  margin-right: 8px !important;
}

/* Custom modal overrides to fit dark theme styling */
.wallet-adapter-modal-wrapper {
  background-color: #0f172a !important;
  border: 1px solid rgb(30 41 59) !important;
  border-radius: 24px !important;
  font-family: inherit !important;
}

.wallet-adapter-modal-title {
  color: white !important;
  font-weight: 700 !important;
}

.wallet-adapter-modal-button-close {
  background-color: rgb(30 41 59) !important;
}

.wallet-adapter-modal-list .wallet-adapter-button {
  background-color: rgb(30 41 59 / 0.4) !important;
  border: 1px solid rgb(30 41 59 / 0.8) !important;
  width: 100% !important;
}

.wallet-adapter-modal-list .wallet-adapter-button:hover {
  border-color: #14F195 !important;
}
</style>
