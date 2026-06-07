/**
 * errorHandler.js
 * Global Express error handler. Must be mounted LAST via app.use().
 * Returns a consistent JSON error shape: { error: string }.
 */

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({ error: message });
}
