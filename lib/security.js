const crypto = require('crypto');
const twilio = require('twilio');

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }

  const [salt, originalHash] = storedHash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derivedKey, 'hex'), Buffer.from(originalHash, 'hex'));
}

function createSignedToken(payload, secret, expiresInSeconds = 60 * 60 * 8) {
  const body = {
    ...payload,
    exp: Date.now() + expiresInSeconds * 1000
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function createJwtToken(header, payload, secret) {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function createTwilioVideoAccessToken({
  accountSid,
  apiKey,
  apiSecret,
  identity,
  roomName,
  expiresInSeconds = 60 * 60
}) {
  if (!accountSid || !apiKey || !apiSecret || !identity || !roomName) {
    return null;
  }

  const AccessToken = twilio.jwt.AccessToken;
  const VideoGrant = AccessToken.VideoGrant;
  const token = new AccessToken(accountSid, apiKey, apiSecret, {
    identity,
    ttl: expiresInSeconds
  });
  token.addGrant(new VideoGrant({ room: roomName }));
  return token.toJwt();
}

function verifySignedToken(token, secret) {
  if (!token || !token.includes('.')) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');

  if (signature !== expectedSignature) {
    return null;
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  if (payload.exp < Date.now()) {
    return null;
  }
  return payload;
}

function randomId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function generateOtp() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSignedToken,
  createTwilioVideoAccessToken,
  verifySignedToken,
  randomId,
  generateOtp
};
