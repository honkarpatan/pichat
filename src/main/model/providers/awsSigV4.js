/**
 * Minimal AWS Signature Version 4 for Bedrock Runtime (browser / WebView).
 * Uses Web Crypto HMAC-SHA256.
 */

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    typeof data === 'string' ? new TextEncoder().encode(data) : data
  );
  return toHex(buf);
}

async function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = await hmac('AWS4' + secretKey, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.service e.g. bedrock-runtime
 * @param {string} opts.region
 * @param {string} opts.host
 * @param {string} opts.path e.g. /model/xxx/converse-stream
 * @param {string} opts.body
 * @param {string} opts.accessKeyId
 * @param {string} opts.secretAccessKey
 * @param {string} [opts.sessionToken]
 * @param {Record<string,string>} [opts.extraHeaders]
 */
export async function signAwsRequest(opts) {
  const {
    method = 'POST',
    service,
    region,
    host,
    path,
    body = '',
    accessKeyId,
    secretAccessKey,
    sessionToken,
    extraHeaders = {}
  } = opts;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);

  const headers = {
    host,
    'content-type': 'application/json',
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...extraHeaders
  };
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;

  const signedHeaderKeys = Object.keys(headers)
    .map(k => k.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderKeys
    .map(k => `${k}:${String(headers[k] ?? headers[Object.keys(headers).find(h => h.toLowerCase() === k)]).trim()}\n`)
    .join('');
  const signedHeaders = signedHeaderKeys.join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    '', // query
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmac(signingKey, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const outHeaders = { ...headers, Authorization: authorization };
  delete outHeaders.host; // fetch sets Host from URL
  return outHeaders;
}
