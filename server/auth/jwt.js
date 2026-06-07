import jwt from 'jsonwebtoken';

const JWT_EXPIRY = '7d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

/**
 * Sign a JWT for the given payload.
 * @param {{ id: string, email: string, role: string }} payload
 * @returns {string} signed token
 */
export function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: JWT_EXPIRY });
}

/**
 * Verify a JWT and return its decoded payload.
 * Throws if the token is invalid or expired.
 * @param {string} token
 * @returns {{ id: string, email: string, role: string }}
 */
export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}
