// Load tenant-aware factories before production-entry imports the server and asks for its engine.
import './server/tenantBootstrap.js';
import './production-entry.ts';
