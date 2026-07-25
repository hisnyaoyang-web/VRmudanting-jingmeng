export type RuntimeBindings = {
  DB?: D1Database;
  NFT_ASSETS?: R2Bucket;
  OFOX_API_KEY?: string;
  GAME_SIGNER_PRIVATE_KEY?: `0x${string}`;
};

export function runtimeBindings(): RuntimeBindings {
  return (globalThis as typeof globalThis & { __SHADOWPLAY_BINDINGS__?: RuntimeBindings })
    .__SHADOWPLAY_BINDINGS__ ?? {};
}
