/**
 * server/load-env.js
 * Loads server/.env into process.env BEFORE any other module initialises.
 *
 * Why a dedicated first-import module: ESM evaluates imports in order, so
 * importing this file first guarantees env vars (JWT_SECRET, DATABASE_URL,
 * ADMIN_*) are populated before db/client.js (Prisma) or the auth layer read
 * them. Resolving the path relative to THIS file (not process.cwd()) means it
 * works whether the server is started from the repo root (`npm run server`)
 * or from inside server/.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(dir, '.env') });
