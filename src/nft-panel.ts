/**
 * NFT 铸造面板
 * 在结算界面显示，但内部逻辑改为复用第二个项目的 wagmi + WalletConnect 流程。
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { NftPanelView } from "./nft-panel-view";
import { wagmiConfig } from "./web3";

export class NftPanel {
  private el: HTMLElement;
  private root: Root;
  private queryClient = new QueryClient();

  constructor(parent: HTMLElement = document.body) {
    this.el = this.inject(parent);
    this.root = createRoot(this.el.querySelector(".nft-root") as HTMLElement);
    this.render();
  }

  private inject(parent: HTMLElement): HTMLElement {
    const wrap = document.createElement("template");
    wrap.innerHTML = '<div id="nft-panel" class="hidden"><div class="nft-root"></div></div>';
    const node = wrap.content.firstElementChild as HTMLElement;
    parent.appendChild(node);

    if (!document.getElementById("nft-panel-style")) {
      const style = document.createElement("style");
      style.id = "nft-panel-style";
      style.textContent = NFT_PANEL_STYLE;
      document.head.appendChild(style);
    }
    return node;
  }

  show() {
    this.el.classList.remove("hidden");
  }

  hide() {
    this.el.classList.add("hidden");
  }

  private render() {
    this.root.render(
      createElement(
        WagmiProvider,
        { config: wagmiConfig },
        createElement(
          QueryClientProvider,
          { client: this.queryClient },
          createElement(NftPanelView, { onClose: () => this.hide() }),
        ),
      ),
    );
  }
}

const NFT_PANEL_STYLE = `
#nft-panel { position: fixed; inset: 0; z-index: 75; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse 80% 70% at 50% 45%, rgba(22,10,16,.9), rgba(5,2,6,.98)); animation: mdFadeIn .5s ease; }
#nft-panel.hidden { display: none !important; }
.nft-card { width: min(460px, 88vw); padding: 36px 32px 28px; text-align: center;
  background: linear-gradient(180deg,rgba(28,12,18,.95),rgba(14,6,10,.98)); border: 1px solid rgba(217,160,63,.45);
  border-top: 2px solid var(--gold); border-bottom: 2px solid var(--gold);
  box-shadow: 0 0 50px rgba(217,138,60,.2),0 20px 60px rgba(0,0,0,.65); animation: mdPop .5s cubic-bezier(.2,.9,.3,1.2); }
.nft-icon { font-size: 48px; margin-bottom: 12px; filter: drop-shadow(0 0 16px rgba(240,192,96,.5)); }
.nft-icon.nft-spin { animation: nftSpin 1.5s linear infinite; }
@keyframes nftSpin { to { transform: rotate(360deg); } }
.nft-card h3 { font-size: clamp(20px,2.6vw,24px); letter-spacing:.16em; color: var(--gold-bright); margin-bottom: 12px; }
.nft-wallet { font-family: monospace; font-size: 14px; color: var(--ember); margin: 4px 0 8px;
  padding: 6px 16px; border: 1px solid rgba(217,160,63,.4); border-radius: 4px; display: inline-block; }
.nft-desc { font-size: clamp(14px,1.8vw,16px); line-height: 1.8; letter-spacing:.06em; color: rgba(242,216,168,.85); margin: 6px 0; }
.nft-note { font-size: 13px; letter-spacing:.08em; color: rgba(242,216,168,.5); margin: 8px 0 16px; }
.nft-link { display: inline-block; margin: 10px 0; padding: 8px 20px; font-size: 14px; letter-spacing:.1em;
  color: var(--gold-bright); border: 1px solid rgba(217,160,63,.5); border-radius: 4px; text-decoration: none; transition: background .2s; }
.nft-link:hover { background: rgba(217,160,63,.12); }
.nft-btns { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 20px; }
.nft-btn { font-family: var(--serif); letter-spacing:.15em; cursor: pointer; border-radius: 4px; transition: transform .12s ease,box-shadow .2s; border: none; }
.nft-btn:disabled { cursor: not-allowed; opacity: .55; transform: none; box-shadow: none; }
.nft-primary { padding: 12px 28px; font-size: clamp(15px,1.8vw,18px); color: #1a0a08;
  background: linear-gradient(180deg,var(--gold-bright),var(--ember)); border: 1px solid var(--gold-bright);
  box-shadow: 0 6px 18px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.4); }
.nft-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(217,138,60,.4); }
.nft-ghost { padding: 12px 24px; font-size: clamp(15px,1.8vw,18px); color: var(--paper); background: transparent;
  border: 1px solid rgba(217,160,63,.55); }
.nft-ghost:hover { background: rgba(217,160,63,.12); }
`;
