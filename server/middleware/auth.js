import { verifyToken } from '../auth/jwt.js';

const COOKIE_NAME = 'metalab_session';

/**
 * requireAuth — Express middleware that enforces authentication.
 * Reads the httpOnly cookie `metalab_session`, verifies the JWT,
 * and attaches `req.user = { id, email }` on success.
 * Returns 401 if the cookie is missing or the token is invalid/expired.
 */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
