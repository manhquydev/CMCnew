// Load the repo-root .env so DATABASE_URL / DIRECT_URL / JWT_SECRET reach the
// integration tests (the API normally loads this at boot via dotenv).
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../.env') });
