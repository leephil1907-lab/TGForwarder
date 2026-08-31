// Load tenant-aware factories before production-entry imports the server and asks for its engine.
import './server/tenantBootstrap.js';
// Register the real Telegram history/media enhancement before Express routes are created.
import './server/productionEnhancements.js';
import './production-entry.ts';
// Replace the legacy shared pending queue with the tenant-isolated implementation.
import './server/tenantIsolationPatch.js';
