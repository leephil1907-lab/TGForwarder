let runtimePromise: Promise<any> | null = null;

export default async function handler(req: any, res: any) {
  // Catch every nested /api/* request (auth, chats, rules, engine, stream, etc.).
  // Vercel treats each file in /api as a function, so api/index.ts alone does
  // not match nested paths such as /api/auth/request-code.
  if (process.env.VERCEL) {
    try {
      process.chdir('/tmp');
    } catch (err) {
      console.warn('[Vercel] Could not switch runtime directory:', err);
    }
  }

  runtimePromise ??= import('./runtime.js').then((module) => module.default);
  const app = await runtimePromise;
  return app(req, res);
}
