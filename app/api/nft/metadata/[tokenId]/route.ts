import { env } from "cloudflare:workers";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  if (!env.NFT_ASSETS) return Response.json({ error: "NFT storage unavailable" }, { status: 503 });
  const { tokenId } = await context.params;
  if (!/^\d+$/.test(tokenId)) return Response.json({ error: "Invalid token" }, { status: 400 });
  const object = await env.NFT_ASSETS.get(`metadata/${tokenId}.json`);
  if (!object) return Response.json({ error: "Metadata not ready" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
