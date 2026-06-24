// Load the repo-root .env so DATABASE_URL / DIRECT_URL / JWT_SECRET reach the
// integration tests (the API normally loads this at boot via dotenv).
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../.env') });

// The lead-ingest seam reads CRM_LEAD_TOKEN at call time; guarantee a deterministic value for
// the integration env so the positive-path test runs (CI sets its own; this only fills a gap).
process.env.CRM_LEAD_TOKEN ??= 'integration-lead-token';
