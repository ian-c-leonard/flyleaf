// A family card carries a short code. The Worker and the card tool both read
// a code through this file, so a code typed with spaces, hyphens or small
// letters matches the one that was printed.

/** A code as it is compared: capital letters and digits only. */
export function normalizeCardCode(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 64);
}

/** True when a typed code is long enough, and short enough, to be a card code. */
export function cardCodeShape(text) {
  const code = normalizeCardCode(text);
  return code.length >= 6 && code.length <= 40;
}

/** SHA-256 of a text, as 64 hex characters. */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** What the site database holds in place of a code. */
export const cardCodeHash = (text) =>
  sha256Hex('flyleaf-card:' + normalizeCardCode(text));
