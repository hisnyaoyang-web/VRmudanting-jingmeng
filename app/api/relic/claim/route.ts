import { database, ensureSchema } from "../../_lib/database";
import { runtimeBindings } from "../../_lib/runtime";

const RPC_URL = "https://k8s.testnet.json-rpc.injective.network/";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = `0x${"0".repeat(64)}`;

type ClaimRequest = {
  txHash?: string;
  address?: string;
  grade?: "excellent" | "good" | "bad";
  score?: number;
  storyId?: string;
  storyTitle?: string;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function isHex(value: string, bytes: number) {
  return new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);
}

function avatarPrompt(input: Required<Pick<ClaimRequest, "grade" | "score" | "storyTitle">>) {
  const performance = input.grade === "excellent"
    ? "a master performer surrounded by radiant gold cut-paper flourishes"
    : input.grade === "good"
      ? "a poised travelling performer with warm cinnabar and jade ornaments"
      : "a mysterious apprentice performer emerging from smoky ink shadows";

  return [
    "Square collectible avatar for a Chinese shadow-puppet theatre game.",
    performance + ".",
    "Authentic translucent dyed leather and fibrous parchment, articulated brass joints,",
    "hand-cut perforations, ink outlines, warm backlight, black lacquer and cinnabar palette.",
    `Inspired by the performance “${input.storyTitle}”, final score ${input.score}.`,
    "Centered bust portrait, dramatic circular moon-gate halo, premium NFT character art.",
    "No text, no logo, no watermark, no border, no photorealistic skin.",
  ].join(" ");
}

export async function POST(request: Request) {
  const env = runtimeBindings();
  if (!env.OFOX_API_KEY) return json({ error: "生图服务尚未配置" }, 503);
  if (!env.NFT_ASSETS) return json({ error: "NFT 存储尚未配置" }, 503);

  let input: ClaimRequest;
  try {
    input = await request.json() as ClaimRequest;
  } catch {
    return json({ error: "请求格式无效" }, 400);
  }

  const txHash = input.txHash ?? "";
  const address = (input.address ?? "").toLowerCase();
  const contractAddress = (process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS ?? "").toLowerCase();
  if (!isHex(txHash, 32) || !isHex(address, 20) || !isHex(contractAddress, 20)) {
    return json({ error: "交易、钱包或合约地址无效" }, 400);
  }

  const rpcResponse = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }),
  });
  const rpc = await rpcResponse.json() as {
    result?: {
      status?: string;
      logs?: Array<{ address?: string; topics?: string[] }>;
    };
  };
  if (rpc.result?.status !== "0x1") return json({ error: "铸造交易尚未成功确认" }, 409);

  const transfer = rpc.result.logs?.find((log) => {
    const topics = log.topics ?? [];
    return log.address?.toLowerCase() === contractAddress
      && topics[0]?.toLowerCase() === TRANSFER_TOPIC
      && topics[1]?.toLowerCase() === ZERO_TOPIC
      && topics[2]?.slice(-40).toLowerCase() === address.slice(2);
  });
  const tokenTopic = transfer?.topics?.[3];
  if (!tokenTopic) return json({ error: "交易中未找到对应的 NFT 铸造记录" }, 400);

  const tokenId = BigInt(tokenTopic).toString();
  await ensureSchema();
  const verifiedClaim = await database().prepare(
    `SELECT score, grade, story_id FROM claims
     WHERE wallet_address = ? AND story_id = ? AND status IN ('issued', 'confirmed')`,
  ).bind(address, input.storyId || "moongate-night").first<{
    score: number; grade: "excellent" | "good" | "bad"; story_id: string;
  }>();
  if (!verifiedClaim) return json({ error: "未找到该钱包的有效成绩凭证" }, 403);
  await database().batch([
    database().prepare(
      "UPDATE claims SET tx_hash = ?, token_id = ?, status = 'confirmed' WHERE wallet_address = ? AND story_id = ?",
    ).bind(txHash, tokenId, address, verifiedClaim.story_id),
    database().prepare(
      `INSERT INTO unlocks (wallet_address, unlock_id, source, unlocked_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(wallet_address, unlock_id) DO NOTHING`,
    ).bind(address, `relic:${verifiedClaim.story_id}`, `token:${tokenId}`, Date.now()),
  ]);
  const metadataKey = `metadata/${tokenId}.json`;
  const existing = await env.NFT_ASSETS.get(metadataKey);
  const origin = new URL(request.url).origin;
  if (existing) {
    return json({
      tokenId,
      imageUrl: `${origin}/api/nft/image/${tokenId}`,
      metadataUrl: `${origin}/api/nft/metadata/${tokenId}`,
      reused: true,
    });
  }

  const grade = verifiedClaim.grade;
  const score = verifiedClaim.score;
  const storyTitle = String(input.storyTitle || "月门照影").slice(0, 80);
  const imageResponse = await fetch("https://api.ofox.ai/v1/images/generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OFOX_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-image-2",
      prompt: avatarPrompt({ grade, score, storyTitle }),
      size: "1024x1024",
      quality: "low",
      output_format: "png",
    }),
  });
  if (!imageResponse.ok) {
    const detail = await imageResponse.text();
    console.error("OFOX image generation failed", imageResponse.status, detail.slice(0, 300));
    return json({ error: "虚拟形象生成失败，请稍后重试" }, 502);
  }

  const generated = await imageResponse.json() as { data?: Array<{ b64_json?: string }> };
  const encoded = generated.data?.[0]?.b64_json;
  if (!encoded) return json({ error: "生图服务未返回图像" }, 502);
  const binary = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  await env.NFT_ASSETS.put(`images/${tokenId}.png`, binary, {
    httpMetadata: { contentType: "image/png" },
  });

  const metadata = {
    name: `园中影 · ${storyTitle} #${tokenId}`,
    description: "由玩家演出结果生成的专属皮影虚拟形象，铸造于 Injective EVM Testnet。",
    image: `${origin}/api/nft/image/${tokenId}`,
    external_url: origin,
    attributes: [
      { trait_type: "Story", value: verifiedClaim.story_id },
      { trait_type: "Performance", value: grade },
      { trait_type: "Score", value: score, display_type: "number" },
      { trait_type: "Art Engine", value: "GPT-Image-2" },
    ],
  };
  await env.NFT_ASSETS.put(metadataKey, JSON.stringify(metadata), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });

  return json({
    tokenId,
    imageUrl: metadata.image,
    metadataUrl: `${origin}/api/nft/metadata/${tokenId}`,
    reused: false,
  });
}
