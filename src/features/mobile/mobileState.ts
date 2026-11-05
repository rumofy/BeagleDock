/** Name the phone suggests for itself when pairing. */
export function suggestedDeviceName(userAgent: string): string {
  if (/iPad/.test(userAgent)) return "iPad";
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/Android/.test(userAgent)) return "Android";
  return "";
}

/** Code from the QR link (`#pair=ABCD2345`), if present. */
export function pairingCodeFromHash(hash: string): string {
  const match = /(?:^#|&)pair=([A-Za-z0-9-]{4,16})/.exec(hash);
  return match ? match[1].toUpperCase() : "";
}
