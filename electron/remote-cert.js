// Certificates for phone access over the local network, with no external tools: a local
// certificate authority (installed once on the phone) and the server certificate it signs.
// The authority is name-constrained to `.local` names and localhost, so even if its key leaked it
// could not vouch for any domain on the internet. (IP address constraints would be stricter, but
// BoringSSL, used by Electron and Chromium-based clients, rejects certificates that carry them.)
const crypto = require("crypto");
const net = require("net");

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const ctx = (n, ...parts) => tlv(0xa0 + n, ...parts);
const bool = (value) => tlv(0x01, Buffer.from([value ? 0xff : 0]));
const octets = (buf) => tlv(0x04, buf);
const utf8 = (text) => tlv(0x0c, Buffer.from(text, "utf8"));
function int(value) {
  let buf = Buffer.isBuffer(value) ? value : Buffer.from([value]);
  while (buf.length > 1 && buf[0] === 0 && !(buf[1] & 0x80)) buf = buf.subarray(1);
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
  return tlv(0x02, buf);
}
const bits = (buf, unused = 0) => tlv(0x03, Buffer.from([unused]), buf);
function oid(text) {
  const [a, b, ...rest] = text.split(".").map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function time(date) {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  return date.getUTCFullYear() < 2050 ? tlv(0x17, iso.slice(2)) : tlv(0x18, iso);
}
const name = (cn) => seq(set(seq(oid("2.5.4.3"), utf8(cn))));
const ext = (id, critical, value) =>
  seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));

function ipBytes(ip) {
  if (net.isIPv4(ip)) return Buffer.from(ip.split(".").map(Number));
  if (!net.isIPv6(ip)) throw new Error("Invalid IP address: " + ip);
  const [head, tail = ""] = ip.split("::");
  const parts = (s) => (s ? s.split(":") : []);
  const h = parts(head),
    t = parts(tail);
  const groups = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return Buffer.concat(groups.map((g) => Buffer.from(g.padStart(4, "0"), "hex")));
}

// Private ranges: the only addresses the server accepts connections from.
const PRIVATE_RANGES = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["169.254.0.0", 16],
  // Carrier-grade NAT, used by private overlay networks such as Tailscale.
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["fc00::", 7],
  ["fe80::", 10],
  ["::1", 128],
];
function mask(bitsCount, size) {
  const out = Buffer.alloc(size);
  for (let i = 0; i < bitsCount; i++) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}
function inRange(ip, [base, prefix]) {
  const a = ipBytes(ip),
    b = ipBytes(base);
  if (a.length !== b.length) return false;
  const m = mask(prefix, a.length);
  return a.every((byte, i) => (byte & m[i]) === (b[i] & m[i]));
}
/** Address of a device on a private network (IPv4-mapped IPv6 included). */
function isPrivateAddress(address) {
  if (typeof address !== "string") return false;
  const ip = address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "").replace(/%.*$/, "");
  if (!net.isIP(ip)) return false;
  return PRIVATE_RANGES.some((range) => inRange(ip, range));
}

function keyId(publicKey) {
  const spki = publicKey.export({ type: "spki", format: "der" });
  return crypto.createHash("sha1").update(spki).digest();
}
const ECDSA_SHA256 = seq(oid("1.2.840.10045.4.3.2"));
function sign({ subject, issuer, publicKey, signingKey, days, extensions }) {
  const now = Date.now();
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(
    ctx(0, int(2)),
    int(serial),
    ECDSA_SHA256,
    name(issuer),
    seq(time(new Date(now - 60 * 60 * 1000)), time(new Date(now + days * 86400 * 1000))),
    name(subject),
    publicKey.export({ type: "spki", format: "der" }),
    ctx(3, seq(...extensions)),
  );
  const signature = crypto.sign("sha256", tbs, signingKey);
  return toPem(seq(tbs, ECDSA_SHA256, bits(signature)));
}
function toPem(der) {
  const b64 = der.toString("base64").replace(/.{1,64}/g, "$&\n");
  return `-----BEGIN CERTIFICATE-----\n${b64}-----END CERTIFICATE-----\n`;
}
const newKey = () => crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const keyPem = (key) => key.export({ type: "pkcs8", format: "pem" });

/** Local authority: valid for 10 years, restricted to `.local` names and localhost. */
function createAuthority(commonName = "BeagleDock Local Access") {
  const { publicKey, privateKey } = newKey();
  const id = keyId(publicKey);
  const permitted = [seq(tlv(0x82, "local")), seq(tlv(0x82, "localhost"))];
  const cert = sign({
    subject: commonName,
    issuer: commonName,
    publicKey,
    signingKey: privateKey,
    days: 3650,
    extensions: [
      ext("2.5.29.19", true, seq(bool(true), int(0))),
      // keyCertSign + cRLSign + digitalSignature
      ext("2.5.29.15", true, bits(Buffer.from([0x86]), 1)),
      ext("2.5.29.14", false, octets(id)),
      ext("2.5.29.30", true, seq(ctx(0, ...permitted))),
    ],
  });
  return { cert, key: keyPem(privateKey) };
}

/** Server certificate for the given IPs and names (397 days, within Apple's limits). */
function issueServerCertificate(authority, { ips = [], names = [] } = {}) {
  const caKey = crypto.createPrivateKey(authority.key);
  const caCert = new crypto.X509Certificate(authority.cert);
  const { publicKey, privateKey } = newKey();
  const san = [
    ...names.map((n) => tlv(0x82, n)),
    ...ips.map((ip) => tlv(0x87, ipBytes(ip))),
  ];
  const cert = sign({
    subject: "BeagleDock",
    issuer: caCert.subject.replace(/^CN=/, ""),
    publicKey,
    signingKey: caKey,
    days: 397,
    extensions: [
      ext("2.5.29.19", true, seq()),
      ext("2.5.29.15", true, bits(Buffer.from([0x80]), 7)),
      ext("2.5.29.37", false, seq(oid("1.3.6.1.5.5.7.3.1"))),
      ext("2.5.29.17", false, seq(...san)),
      ext("2.5.29.14", false, octets(keyId(publicKey))),
      ext("2.5.29.35", false, seq(tlv(0x80, keyId(caCert.publicKey)))),
    ],
  });
  return { cert, key: keyPem(privateKey), ips: [...ips], names: [...names] };
}

/** Whether the certificate still covers these addresses and has more than 30 days left. */
function serverCertificateFits(server, ips, names, now = Date.now()) {
  if (!server?.cert) return false;
  try {
    const x509 = new crypto.X509Certificate(server.cert);
    if (Date.parse(x509.validTo) - now < 30 * 86400 * 1000) return false;
    return ips.every((ip) => x509.checkIP(ip)) && names.every((n) => x509.checkHost(n));
  } catch {
    return false;
  }
}

/** SHA-256 fingerprint shown on the desktop, to check it matches the one on the phone. */
function fingerprint(pem) {
  return new crypto.X509Certificate(pem).fingerprint256;
}
const pemToDer = (pem) => new crypto.X509Certificate(pem).raw;

module.exports = {
  createAuthority,
  issueServerCertificate,
  serverCertificateFits,
  fingerprint,
  pemToDer,
  isPrivateAddress,
};
