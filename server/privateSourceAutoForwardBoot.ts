import { installPrivateSourceAutoForward } from './privateSourceAutoForward.js';

// Allow production-entry to finish creating the server/engine before attaching
// the long-lived Telegram listener.
setTimeout(() => {
  installPrivateSourceAutoForward().catch((err) => {
    console.error('[TGForwarder] Private source auto-forward initialization failed:', err);
  });
}, 1000);
