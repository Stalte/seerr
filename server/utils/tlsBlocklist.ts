import logger from '@server/logger';
import crypto from 'crypto';
import tls from 'tls';

/**
 * SHA-256 hashes of the SubjectPublicKeyInfo of the eight eMudhra intermediate
 * CA keys that were compromised in October 2026 (CVE-2026-111943 and
 * CVE-2026-111944). The same eight keys appear in sixteen certificates, because
 * each intermediate was also cross-signed by Sectigo's "AAA Certificate
 * Services" root, so matching on the key rather than the certificate covers
 * every chain they can appear in.
 *
 * The list matches the blocklist Node.js ships in 22.23.4, 24.22.1 and 26.12.1.
 */
export const BLOCKED_SPKI_SHA256: ReadonlyMap<string, string> = new Map([
  [
    '49dd353dc2b919a3770645117d0e60c16115e7d1bc259eefe734b00ea434fe5f',
    'EM DV TLS CA - G3C',
  ],
  [
    '5c0660a2b164910d8ff589c18e14552e9e0ec237dcefe2cb736d41a4811f81a0',
    'EM EV TLS CA - G3C',
  ],
  [
    '63ecefee431d49523bc1136c4e72d0206a477086caf606cd5cf025686c109cf8',
    'EM OV TLS CA - G3C',
  ],
  [
    '92c063d67e8f14db71d288e11266ffdaf69cbf115f7bab14f3bc2f68d25e0e30',
    'EM OV CS CA - G3C',
  ],
  [
    'ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105',
    'EM DV TLS CA - G3B',
  ],
  [
    'e0254c7fcdc265e2f0f8a428dabb75ab4ae039b4872d62f5ee57f0877d5a8a41',
    'EM EV TLS CA - G3B',
  ],
  [
    '43bffa19d6ef651451f6841e019931e96f6f2eaeff28ab4b6f1ce4576de2717b',
    'EM OV TLS CA - G3B',
  ],
  [
    'ec4ffa1ad0ac88081314b7aaffef6a91f97cd57291bb5ba686c5415f5eb4f6b6',
    'EM OV CS CA - G3B',
  ],
]);

// Node.js releases that reject these keys in the TLS layer themselves.
const PATCHED_NODE_VERSIONS: Record<number, [number, number]> = {
  22: [23, 4],
  24: [22, 1],
  26: [12, 1],
};

function spkiSha256(cert: tls.DetailedPeerCertificate): string | undefined {
  if (!cert.raw) {
    return undefined;
  }

  // The published hashes are taken over the DER-encoded SubjectPublicKeyInfo.
  // A peer certificate's `pubkey` is not that encoding for EC keys, so derive
  // the SubjectPublicKeyInfo from the certificate itself.
  try {
    const spki = new crypto.X509Certificate(cert.raw).publicKey.export({
      type: 'spki',
      format: 'der',
    });

    return crypto.createHash('sha256').update(spki).digest('hex');
  } catch {
    return undefined;
  }
}

/**
 * Walks a peer certificate chain and returns the name of the first compromised
 * CA found in it, or undefined when the chain is clean.
 */
export function findBlockedCertificate(
  cert: tls.DetailedPeerCertificate | undefined,
  blockedKeys: ReadonlyMap<string, string> = BLOCKED_SPKI_SHA256
): string | undefined {
  const seen = new Set<tls.DetailedPeerCertificate>();
  let current = cert;

  while (current && !seen.has(current)) {
    seen.add(current);

    const hash = spkiSha256(current);
    const blocked = hash ? blockedKeys.get(hash) : undefined;
    if (blocked) {
      return blocked;
    }

    current = current.issuerCertificate;
  }

  return undefined;
}

export function nodeRejectsBlockedKeys(version = process.versions.node) {
  const [major, minor, patch] = version
    .split('.')
    .map((part) => Number.parseInt(part, 10));

  const patched = PATCHED_NODE_VERSIONS[major];
  if (!patched) {
    // Majors we don't know about are either older than every fix or newer than
    // all of them; only the ones above the newest fixed release are safe.
    return major > 26;
  }

  const [patchedMinor, patchedPatch] = patched;
  return (
    minor > patchedMinor || (minor === patchedMinor && patch >= patchedPatch)
  );
}

let installed = false;

/**
 * Rejects any TLS connection whose certificate chain contains one of the
 * compromised eMudhra intermediate CA keys.
 *
 * Node.js 22.23.4 and later already refuse these chains, so this is a
 * belt-and-braces check for installations running an older runtime. It wraps
 * `tls.connect` rather than individual agents so that it covers every outbound
 * client in the app (axios, undici/fetch, the proxy agents and nodemailer), and
 * it inspects the negotiated chain instead of using `checkServerIdentity` so
 * that it still applies to connections made with `rejectUnauthorized: false`.
 */
export default function installTlsBlocklist(
  blockedKeys: ReadonlyMap<string, string> = BLOCKED_SPKI_SHA256
) {
  if (installed) {
    return () => undefined;
  }
  installed = true;

  if (!nodeRejectsBlockedKeys()) {
    logger.warn(
      `Node.js ${process.versions.node} does not reject the compromised eMudhra CA keys (CVE-2026-111943, CVE-2026-111944). Seerr will reject them itself, but please upgrade to Node.js 22.23.4 or later.`,
      { label: 'TLS' }
    );
  }

  const originalConnect = tls.connect;

  const wrapped = ((...args: Parameters<typeof tls.connect>) => {
    const socket = (
      originalConnect as (...a: unknown[]) => tls.TLSSocket
    )(...(args as unknown[]));

    socket.on('secureConnect', () => {
      const blocked = findBlockedCertificate(
        socket.getPeerCertificate(true),
        blockedKeys
      );

      if (blocked) {
        logger.error(
          `Rejected a TLS connection to ${socket.remoteAddress ?? 'unknown host'}: its certificate chain includes the compromised CA "${blocked}"`,
          { label: 'TLS' }
        );
        socket.destroy(
          new Error(
            `Certificate chain contains the compromised certificate authority "${blocked}"`
          )
        );
      }
    });

    return socket;
  }) as typeof tls.connect;

  tls.connect = wrapped;

  // Lets tests put the original `tls.connect` back.
  return () => {
    tls.connect = originalConnect;
    installed = false;
  };
}
