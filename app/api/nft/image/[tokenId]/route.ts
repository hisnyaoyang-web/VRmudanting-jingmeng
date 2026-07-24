import { env } from "cloudflare:workers";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  if (!env.NFT_ASSETS) return new Response("NFT storage unavailable", { status: 503 });
  const { tokenId } = await context.params;
  if (!/^\d+$/.test(tokenId)) return new Response("Invalid token", { status: 400 });
  const object = await env.NFT_ASSETS.get(`images/${tokenId}.png`);
  if (!object) return new Response("Image not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/png",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
