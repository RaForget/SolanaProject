# Project-Scoped Rules: Solana Vue 3 Web3 DApp

These rules guide developers and AI agents in maintaining and expanding this Solana Devnet DApp.

## Web3.js & Wallet Adapter Standards

1. **Imports Optimization**:
   Always import specific classes and methods rather than importing the whole library to keep the compiled bundle tree-shakable:
   *   ✅ **GOOD**: `import { Connection, PublicKey, Transaction } from '@solana/web3.js'`
   *   ❌ **BAD**: `import * as web3 from '@solana/web3.js'`

2. **Strict ESM Imports**:
   Vite is strict about ESM resolution. If a Solana package lacks styling map configurations in its `exports` field, import directly from the absolute package sub-path:
   *   `import '../node_modules/@solana/wallet-adapter-vue-ui/styles.css'`

3. **Node Polyfills**:
   Ensure `vite-plugin-node-polyfills` remains configured in `vite.config.ts` to support older `web3.js` 1.x dependencies in the browser.

## Solana Error Code Mapping

When catching transaction exceptions, map common Solana hexadecimal raw errors to user-friendly messages:

- **`0x1` (InstructionError / Custom)**: Map to `"Saldo insuficiente para cobrir as taxas de rede (gas/rent)."`
- **`0x0` / `Attempt to debit an account...`**: Map to `"Saldo insuficiente para a transferência."`
- **`Blockhash not found`**: Map to `"A transação expirou. Por favor, tente novamente."`
- **`User rejected` / `Signature request denied`**: Map to `"Transação cancelada: a assinatura foi rejeitada na carteira."`

## Code Style & Reactivity

- **TypeScript Type Safety**: Avoid `any` types. Provide explicit type declarations for custom Solana structures.
- **Reactive State**: Watch the `publicKey` ref from `useWallet()` to trigger balance fetching automatically:
  ```typescript
  watch(publicKey, (newKey) => {
    if (newKey) fetchBalance(newKey)
  })
  ```
- **Simulations**: For more complex transactions (e.g. smart contracts/programs), always simulate the transaction (`connection.simulateTransaction`) before sending to prevent wasting user transaction fees.
