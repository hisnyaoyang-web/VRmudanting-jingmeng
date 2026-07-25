/**
 * NFT 铸造面板
 * 在结算界面（S12）显示，允许玩家连接钱包、铸造「杜丽娘」纪念 NFT。
 */
import {
  connectWallet, mintRelic,
  isWeb3Configured, injectiveTestnet,
  type WalletInfo, type ClaimResult,
} from "./web3";
import { fx } from "./effects";

type PanelState = "idle" | "connecting" | "connected" | "minting" | "success" | "error";

export class NftPanel {
  private el: HTMLElement;
  private contentEl: HTMLElement;
  private wallet: WalletInfo | null = null;
  private state: PanelState = "idle";

  constructor(parent: HTMLElement = document.body) {
    this.el = this.inject(parent);
    this.contentEl = this.el.querySelector(".nft-content")!;
    this.render();
  }

  private inject(parent: HTMLElement): HTMLElement {
    const wrap = document.createElement("template");
    wrap.innerHTML = '<div id="nft-panel" class="hidden">' +
      '<div class="nft-card nft-content"></div>' +
      "</div>";
    const node = wrap.content.firstElementChild as HTMLElement;
    parent.appendChild(node);

    const style = document.createElement("style");
    style.textContent = NFT_PANEL_STYLE;
    document.head.appendChild(style);
    return node;
  }

  show() {
    this.el.classList.remove("hidden");
    this.render();
  }
  hide() {
    this.el.classList.add("hidden");
  }

  private async handleConnect() {
    if (!isWeb3Configured()) {
      this.state = "error";
      this.render();
      return;
    }
    this.state = "connecting";
    this.render();
    try {
      this.wallet = await connectWallet();
      this.state = "connected";
    } catch (err: any) {
      console.error("wallet connect failed", err);
      this.state = "error";
    }
    this.render();
  }

  private async handleMint() {
    if (!this.wallet) return;
    this.state = "minting";
    this.render();
    try {
      const provider = (window as any).ethereum;
      const result = await mintRelic(
        provider,
        this.wallet.address,
        3000,
        2,
      );
      this.state = "success";
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      fx.burst(cx, cy, 80, 44);
      this.render(result);
    } catch (err: any) {
      console.error("mint failed", err);
      this.state = "error";
      this.render();
    }
  }

  private render(result?: ClaimResult) {
    const configured = isWeb3Configured();
    let html = "";

    if (!configured) {
      html =
        '<div class="nft-icon">&#x1F4DA;</div>' +
        '<h3>链上信物</h3>' +
        '<p class="nft-desc">完成体验后，可将你寻回的杜丽娘铸为链上 NFT。</p>' +
        '<p class="nft-note">区块链功能待配置。部署 ShadowRelic 合约后，在 experience2/web3-config.ts 中填写地址与密钥即可启用。</p>' +
        '<div class="nft-btns"><button class="nft-btn nft-close" type="button">关闭</button></div>';
    } else if (this.state === "idle") {
      html =
        '<div class="nft-icon">&#x1F3AD;</div>' +
        '<h3>链上信物</h3>' +
        '<p class="nft-desc">你已寻回杜丽娘的双手、双脚与躯干。</p>' +
        '<p class="nft-desc">连接钱包，将这份觉醒铸为 Injective 链上的永久信物。</p>' +
        '<div class="nft-btns"><button class="nft-btn nft-primary nft-connect" type="button">连接钱包</button>' +
        '<button class="nft-btn nft-ghost nft-close" type="button">稍后</button></div>';
    } else if (this.state === "connecting") {
      html =
        '<div class="nft-icon nft-spin">&#x269B;</div>' +
        '<h3>正在连接…</h3>' +
        '<p class="nft-desc">请在弹出的钱包中确认连接。</p>' +
        '<p class="nft-note">手机扫码请使用 WalletConnect 二维码。</p>';
    } else if (this.state === "connected" && this.wallet) {
      const short = this.wallet.address.slice(0, 6) + "..." + this.wallet.address.slice(-4);
      html =
        '<div class="nft-icon">&#x1F3AD;</div>' +
        '<h3>钱包已连接</h3>' +
        '<p class="nft-wallet">' + short + "</p>" +
        '<p class="nft-desc">网络：Injective EVM Testnet</p>' +
        '<p class="nft-desc">点击铸造，在你的钱包中确认链上交易。</p>' +
        '<div class="nft-btns"><button class="nft-btn nft-primary nft-mint" type="button">铸造 NFT</button>' +
        '<button class="nft-btn nft-ghost nft-close" type="button">取消</button></div>';
    } else if (this.state === "minting") {
      html =
        '<div class="nft-icon nft-spin">&#x269B;</div>' +
        '<h3>正在铸造…</h3>' +
        '<p class="nft-desc">交易已提交，等待区块确认。</p>' +
        '<p class="nft-note">Injective Testnet 通常需要数秒至数十秒。</p>';
    } else if (this.state === "success" && result) {
      html =
        '<div class="nft-icon">&#x2728;</div>' +
        '<h3>铸造成功</h3>';
      if (result.tokenId) {
        html += '<p class="nft-desc">Token #' + result.tokenId + "</p>";
      }
      html +=
        '<a class="nft-link" href="' + result.blockExplorerUrl + '" target="_blank" rel="noopener">在 Blockscout 查看交易</a>' +
        '<div class="nft-btns"><button class="nft-btn nft-ghost nft-close" type="button">完成</button></div>';
    } else {
      html =
        '<div class="nft-icon">&#x26A0;</div>' +
        '<h3>操作失败</h3>' +
        '<p class="nft-desc">可能是钱包未连接、网络错误或用户拒绝了交易。</p>' +
        '<div class="nft-btns"><button class="nft-btn nft-primary nft-retry" type="button">重试</button>' +
        '<button class="nft-btn nft-ghost nft-close" type="button">关闭</button></div>';
    }

    this.contentEl.innerHTML = html;

    const connectBtn = this.contentEl.querySelector(".nft-connect");
    if (connectBtn) connectBtn.addEventListener("click", () => this.handleConnect());
    const mintBtn = this.contentEl.querySelector(".nft-mint");
    if (mintBtn) mintBtn.addEventListener("click", () => this.handleMint());
    const retryBtn = this.contentEl.querySelector(".nft-retry");
    if (retryBtn) retryBtn.addEventListener("click", () => { this.state = "idle"; this.wallet = null; this.render(); });
    const closeBtns = this.contentEl.querySelectorAll(".nft-close");
    closeBtns.forEach((b) => b.addEventListener("click", () => this.hide()));
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
.nft-primary { padding: 12px 28px; font-size: clamp(15px,1.8vw,18px); color: #1a0a08;
  background: linear-gradient(180deg,var(--gold-bright),var(--ember)); border: 1px solid var(--gold-bright);
  box-shadow: 0 6px 18px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.4); }
.nft-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(217,138,60,.4); }
.nft-ghost { padding: 12px 24px; font-size: clamp(15px,1.8vw,18px); color: var(--paper); background: transparent;
  border: 1px solid rgba(217,160,63,.55); }
.nft-ghost:hover { background: rgba(217,160,63,.12); }
`;
