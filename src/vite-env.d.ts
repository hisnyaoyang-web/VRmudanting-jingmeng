/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_NFT_CONTRACT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
