// IPFS pinning via Pinata — permanent, decentralized hosting for a coin's logo + metadata JSON,
// so the on-chain metadata URI never breaks and every wallet renders it the same.
// Keyed (PINATA_JWT) -> real pin; unkeyed -> dev mode (the launch keeps the raw URL).
const JWT = process.env.PINATA_JWT || "";
const GATEWAY = process.env.IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs/";

export function hasIpfs() {
  return Boolean(JWT);
}

export async function pinJson(obj, name = "metadata.json") {
  if (!JWT) throw new Error("PINATA_JWT not set");
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}`, "content-type": "application/json" },
    body: JSON.stringify({ pinataContent: obj, pinataMetadata: { name } }),
  });
  if (!res.ok) throw new Error(`pinata json ${res.status}`);
  const d = await res.json();
  return { cid: d.IpfsHash, uri: `ipfs://${d.IpfsHash}`, gateway: GATEWAY + d.IpfsHash };
}

export async function pinImageFromUrl(url) {
  if (!JWT) throw new Error("PINATA_JWT not set");
  const img = await fetch(url);
  if (!img.ok) throw new Error(`fetch image ${img.status}`);
  const buf = Buffer.from(await img.arrayBuffer());
  const type = img.headers.get("content-type") || "image/png";
  const form = new FormData();
  form.append("file", new Blob([buf], { type }), "logo");
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`pinata file ${res.status}`);
  const d = await res.json();
  return { cid: d.IpfsHash, uri: `ipfs://${d.IpfsHash}`, gateway: GATEWAY + d.IpfsHash };
}
