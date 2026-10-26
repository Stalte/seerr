import installTlsBlocklist, {
  BLOCKED_SPKI_SHA256,
  findBlockedCertificate,
  nodeRejectsBlockedKeys,
} from '@server/utils/tlsBlocklist';
import crypto from 'crypto';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import tls from 'tls';

// Throwaway self-signed secp384r1 certificates. The key hashes the blocklist
// matches on are derived from the certificates, so the fixtures have to be real
// certificates rather than hand-built objects.
const SERVER_CERT = [
  'MIIBvTCCAUKgAwIBAgIUfjTXTfgk13zoRkWX3hj4X4rblQswCgYIKoZIzj0EAwIwFTET',
  'MBEGA1UEAwwKc2VlcnItdGVzdDAeFw0yNjEwMjYxNDA1MTVaFw0zNjEwMjMxNDA1MTVa',
  'MBUxEzARBgNVBAMMCnNlZXJyLXRlc3QwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAQxg9+P',
  '0qrSqsvJQfjEgRbI7+iPvdqhd8ejF0PMvWfVk7S6gWO8QYxBt/FJf3qZoPgwgaY2YJ0D',
  'IvW8OiQUvs9N9GneOdONbbBqqgtM8lOnLkLCYPP47cHnbrEHbB9s4OmjUzBRMB0GA1Ud',
  'DgQWBBRiQVZXF82ui4imsYC9sPIy69BPVDAfBgNVHSMEGDAWgBRiQVZXF82ui4imsYC9',
  'sPIy69BPVDAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA2kAMGYCMQDyzsJh5148',
  '66AjmFQZAuBCQFdn2bF9xCbxt1N0o28H7lKt2/eVHYxKOmbtNQeLOYACMQDaaRkZ0PuK',
  'dKKr9b1FBf/UeIO2xt7LSodRa+dP0z0TgdORKnqNpRAvQaH+p8jgR5g=',
].join('');

const SERVER_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIG2AgEAMBAGByqGSM49AgEGBSuBBAAiBIGeMIGbAgEBBDDJV0o5qxfQuDA7A87v',
  '1hl7JfFnvQgjdkIrT+TxwPK3zvTYBYpMrXjx48rJ5xfShtihZANiAAQxg9+P0qrS',
  'qsvJQfjEgRbI7+iPvdqhd8ejF0PMvWfVk7S6gWO8QYxBt/FJf3qZoPgwgaY2YJ0D',
  'IvW8OiQUvs9N9GneOdONbbBqqgtM8lOnLkLCYPP47cHnbrEHbB9s4Ok=',
  '-----END PRIVATE KEY-----',
].join('\n');

const CERT_A = [
  'MIIBwTCCAUagAwIBAgIUD9dB3qGOsKO0tmMXjaEuULGuysUwCgYIKoZIzj0EAwIwFzEV',
  'MBMGA1UEAwwMc2VlcnItdGVzdC1hMB4XDTI2MTAyNjE0MTIxNVoXDTM2MTAyMzE0MTIx',
  'NVowFzEVMBMGA1UEAwwMc2VlcnItdGVzdC1hMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE',
  'YZQNXXav7yc0aJo867E0Ak45Tkp4yFNFOG69wPU0wXTy03NZPQWxnN+IyQ3NRNUjp1NK',
  'tEEP5HP6RF+e3Neu/FMyZBVwyY1j6Net29gbrJCmqsiGbEjwahDb5Wd/W1Rio1MwUTAd',
  'BgNVHQ4EFgQUleTdaJ7y5lXu33obQXIqERua2DEwHwYDVR0jBBgwFoAUleTdaJ7y5lXu',
  '33obQXIqERua2DEwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNpADBmAjEAnkFS',
  'utYR9Q0xzX5Ae9yS7c9RAnmRKST5r/YspofLGpPfpStP9Gq7092Wh7VWZjw4AjEAs2Rg',
  'izTPqVp28x6EVN82+GnsfYejvP4WLCB2+ITl/puRKrES23hLMKXVldAcH8nt',
].join('');

const CERT_B = [
  'MIIBwTCCAUagAwIBAgIUP2Jyt6OJo0xX1ZtmYNCWO5nUI10wCgYIKoZIzj0EAwIwFzEV',
  'MBMGA1UEAwwMc2VlcnItdGVzdC1iMB4XDTI2MTAyNjE0MTIxNVoXDTM2MTAyMzE0MTIx',
  'NVowFzEVMBMGA1UEAwwMc2VlcnItdGVzdC1iMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE',
  'NSdo6IT8531gTPIhXRzXYeaf0Ype06YPuHVoxtXBEONzAUTY9CvesH7lZGV3h892tF84',
  'I/CeBHPUHIKovaxHU3r+3DpadWVroY28SoaWUH8TsPhNnyGxAPe/fXz7S/fKo1MwUTAd',
  'BgNVHQ4EFgQUNbepsghQcevjZWYgUFijb5eiu7EwHwYDVR0jBBgwFoAUNbepsghQcevj',
  'ZWYgUFijb5eiu7EwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNpADBmAjEA0iDX',
  'aFBTHUW+crkQkzkGljnmjf/WInB9pnwLTY8Cyy+AvZlCZe8Vkcd6PjzSUHZXAjEA49Yi',
  'QM1fNv+MBuNejZjGuzlPAF5AH5nTV5hqzdwkn5OZcNgaXOEIzkH9yNHgzQRJ',
].join('');

function pem(der: string) {
  return `-----BEGIN CERTIFICATE-----\n${der}\n-----END CERTIFICATE-----`;
}

/** The SHA-256 of a certificate's SubjectPublicKeyInfo, as the blocklist keys. */
function keyHash(der: string) {
  const spki = new crypto.X509Certificate(pem(der)).publicKey.export({
    type: 'spki',
    format: 'der',
  });

  return crypto.createHash('sha256').update(spki).digest('hex');
}

function certificate(
  der: string,
  issuerCertificate?: tls.DetailedPeerCertificate
): tls.DetailedPeerCertificate {
  const cert = {
    raw: Buffer.from(der, 'base64'),
    issuerCertificate,
  } as unknown as tls.DetailedPeerCertificate;

  // A root certificate is its own issuer, which is how Node terminates a chain.
  if (!issuerCertificate) {
    (
      cert as { issuerCertificate: tls.DetailedPeerCertificate }
    ).issuerCertificate = cert;
  }

  return cert;
}

describe('TLS certificate blocklist', () => {
  it('blocks all eight compromised eMudhra CA keys', () => {
    assert.equal(BLOCKED_SPKI_SHA256.size, 8);

    for (const [hash, name] of BLOCKED_SPKI_SHA256) {
      assert.match(hash, /^[0-9a-f]{64}$/);
      assert.match(name, /^EM (DV|OV|EV) (TLS|CS) CA - G3[BC]$/);
    }
  });

  it('rejects a chain whose intermediate uses a blocked key', () => {
    const blockedKeys = new Map([[keyHash(CERT_B), 'EM DV TLS CA - G3B']]);

    const root = certificate(CERT_A);
    const intermediate = certificate(CERT_B, root);
    const leaf = certificate(SERVER_CERT, intermediate);

    assert.equal(
      findBlockedCertificate(leaf, blockedKeys),
      'EM DV TLS CA - G3B'
    );
  });

  it('rejects a leaf that uses a blocked key directly', () => {
    const blockedKeys = new Map([[keyHash(SERVER_CERT), 'EM OV CS CA - G3C']]);

    assert.equal(
      findBlockedCertificate(certificate(SERVER_CERT), blockedKeys),
      'EM OV CS CA - G3C'
    );
  });

  it('accepts a clean chain without looping on a self-issued root', () => {
    const root = certificate(CERT_A);
    const leaf = certificate(CERT_B, root);

    assert.equal(findBlockedCertificate(leaf), undefined);
    assert.equal(
      findBlockedCertificate(leaf, new Map([[keyHash(SERVER_CERT), 'other']])),
      undefined
    );
  });

  it('accepts a certificate it cannot read a key from', () => {
    assert.equal(findBlockedCertificate(undefined), undefined);
    assert.equal(
      findBlockedCertificate({} as tls.DetailedPeerCertificate),
      undefined
    );
    assert.equal(
      findBlockedCertificate({
        raw: Buffer.from('not a certificate'),
      } as unknown as tls.DetailedPeerCertificate),
      undefined
    );
  });

  it('destroys a connection to a server presenting a blocked key', async () => {
    const server = tls.createServer({
      cert: pem(SERVER_CERT),
      key: SERVER_KEY,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };

    const restore = installTlsBlocklist(
      new Map([[keyHash(SERVER_CERT), 'EM DV TLS CA - G3B']])
    );
    after(() => {
      restore();
      server.close();
    });

    const error = await new Promise<Error>((resolve) => {
      const socket = tls.connect({
        host: '127.0.0.1',
        port,
        // The fixture is self-signed, so verification has to be off for the
        // connection to get far enough to prove the chain check still applies.
        rejectUnauthorized: false,
      });
      socket.on('error', resolve);
      socket.on('close', () => resolve(new Error('closed without an error')));
    });

    assert.match(error.message, /compromised certificate authority/);
    assert.match(error.message, /EM DV TLS CA - G3B/);
  });

  it('knows which Node.js releases reject the keys themselves', () => {
    assert.equal(nodeRejectsBlockedKeys('22.23.4'), true);
    assert.equal(nodeRejectsBlockedKeys('22.24.0'), true);
    assert.equal(nodeRejectsBlockedKeys('22.23.3'), false);
    assert.equal(nodeRejectsBlockedKeys('22.19.0'), false);
    assert.equal(nodeRejectsBlockedKeys('24.22.1'), true);
    assert.equal(nodeRejectsBlockedKeys('24.22.0'), false);
    assert.equal(nodeRejectsBlockedKeys('26.12.1'), true);
    assert.equal(nodeRejectsBlockedKeys('26.11.9'), false);
    assert.equal(nodeRejectsBlockedKeys('20.19.0'), false);
    assert.equal(nodeRejectsBlockedKeys('25.3.0'), false);
    assert.equal(nodeRejectsBlockedKeys('27.0.0'), true);
  });
});
