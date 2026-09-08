/**
 * Multi-user registry: invite-based signup, per-user isolated workspaces.
 * ---------------------------------------------------------------------------
 * - Admin is implicit: the master APP_AUTH_TOKEN maps to the 'default' tenant
 *   (so the operator's existing data stays with the admin) and may manage
 *   invites/users.
 * - Each registered user gets their own tenant id (`u-<id>`): their Telegram
 *   session, rules, fetch jobs, watchers, logs and pending posts live in
 *   tenants/<tenantId>/ and are invisible to everyone else.
 * - Passwords: scrypt with per-user salt. Sessions: random 48-hex tokens,
 *   only their SHA-256 hash is persisted; 30-day expiry.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface UserRecord {
  id: string;
  username: string;
  passHash: string;
  role: 'user' | 'admin';
  tenantId: string;
  createdAt: number;
  disabled: boolean;
}

export interface InviteRecord {
  code: string;
  label: string;
  createdBy: string;
  usedBy: string | null;
  createdAt: number;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

interface RegistryFile {
  users: UserRecord[];
  invites: InviteRecord[];
  sessions: SessionRecord[];
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BASE_DATA_DIR = process.env.TG_DATA_DIR || (process.env.VERCEL ? '/tmp/tgforwarder-data' : path.join(process.cwd(), '.data'));
const REGISTRY_FILE = path.join(BASE_DATA_DIR, 'users.json');

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, expected] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    const A = Buffer.from(derived, 'hex');
    const B = Buffer.from(expected, 'hex');
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

export class UserRegistry {
  private static instance: UserRegistry | null = null;
  private data: RegistryFile = { users: [], invites: [], sessions: [] };
  private saveTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.load();
  }

  public static getInstance(): UserRegistry {
    if (!UserRegistry.instance) UserRegistry.instance = new UserRegistry();
    return UserRegistry.instance;
  }

  // ==================== STORAGE ====================

  private load() {
    try {
      if (!fs.existsSync(REGISTRY_FILE)) return;
      const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
      this.data = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        invites: Array.isArray(parsed.invites) ? parsed.invites : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
      // Purge expired sessions on load.
      const now = Date.now();
      this.data.sessions = this.data.sessions.filter((s) => s.expiresAt > now);
    } catch (err: any) {
      console.error('[Users] Could not load user registry:', err?.message || err);
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 250);
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref();
  }

  private saveNow() {
    try {
      fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
      const tmp = `${REGISTRY_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, REGISTRY_FILE);
    } catch (err: any) {
      console.error('[Users] Could not persist user registry:', err?.message || err);
    }
  }

  // ==================== INVITES (admin) ====================

  createInvite(createdBy: string, label = ''): InviteRecord {
    const raw = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, '').toUpperCase().slice(0, 12);
    const code = `TGF-${raw.slice(0, 6)}-${raw.slice(6, 12) || crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const invite: InviteRecord = { code, label: String(label || '').slice(0, 60), createdBy, usedBy: null, createdAt: Date.now() };
    this.data.invites.push(invite);
    this.data.invites = this.data.invites.slice(-500);
    this.scheduleSave();
    return invite;
  }

  listInvites(): InviteRecord[] {
    return [...this.data.invites].sort((a, b) => b.createdAt - a.createdAt);
  }

  deleteInvite(code: string): boolean {
    const before = this.data.invites.length;
    this.data.invites = this.data.invites.filter((i) => i.code !== code);
    const removed = this.data.invites.length !== before;
    if (removed) this.scheduleSave();
    return removed;
  }

  // ==================== USERS ====================

  private findUserByName(username: string): UserRecord | undefined {
    const needle = username.trim().toLowerCase();
    return this.data.users.find((u) => u.username.toLowerCase() === needle);
  }

  registerWithInvite(inviteCode: string, username: string, password: string): { user: UserRecord; token: string } {
    const code = String(inviteCode || '').trim().toUpperCase();
    const invite = this.data.invites.find((i) => i.code.toUpperCase() === code);
    if (!invite) throw Object.assign(new Error('Invalid invite code. Ask the administrator for a valid invite.'), { status: 403 });
    if (invite.usedBy) throw Object.assign(new Error('This invite has already been used.'), { status: 403 });

    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(name)) {
      throw Object.assign(new Error('Username must be 3–24 characters (letters, numbers, _ or -).'), { status: 400 });
    }
    if (String(password || '').length < 8) {
      throw Object.assign(new Error('Password must be at least 8 characters.'), { status: 400 });
    }
    if (this.findUserByName(name)) {
      throw Object.assign(new Error('That username is already taken.'), { status: 400 });
    }

    const user: UserRecord = {
      id: `u-${crypto.randomBytes(6).toString('hex')}`,
      username: name,
      passHash: hashPassword(String(password)),
      role: 'user',
      tenantId: `u-${crypto.randomBytes(8).toString('hex')}`,
      createdAt: Date.now(),
      disabled: false,
    };
    this.data.users.push(user);
    invite.usedBy = user.id;
    const token = this.issueSession(user);
    this.scheduleSave();
    return { user, token };
  }

  login(username: string, password: string): { user: UserRecord; token: string } {
    const user = this.findUserByName(String(username || ''));
    // Constant-ish time: always run a hash comparison even when user is missing.
    const ok = user ? verifyPassword(String(password || ''), user.passHash) : verifyPassword(String(password || ''), hashPassword('invalid-placeholder'));
    if (!user || !ok) throw Object.assign(new Error('Incorrect username or password.'), { status: 401 });
    if (user.disabled) throw Object.assign(new Error('This account has been disabled by the administrator.'), { status: 403 });
    const token = this.issueSession(user);
    this.scheduleSave();
    return { user, token };
  }

  private issueSession(user: UserRecord): string {
    const token = crypto.randomBytes(24).toString('hex');
    this.data.sessions.push({ tokenHash: sha256(token), userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
    if (this.data.sessions.length > 2000) this.data.sessions = this.data.sessions.slice(-1000);
    return token;
  }

  /** Resolves a bearer/session token to its user, or null (also covers the master token → null). */
  validateSession(token: string): UserRecord | null {
    if (!token || token.length > 128) return null;
    const hash = sha256(token);
    const session = this.data.sessions.find((s) => s.tokenHash === hash);
    if (!session || session.expiresAt <= Date.now()) return null;
    const user = this.data.users.find((u) => u.id === session.userId);
    if (!user || user.disabled) return null;
    return user;
  }

  logout(token: string): boolean {
    const hash = sha256(token);
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.tokenHash !== hash);
    const removed = this.data.sessions.length !== before;
    if (removed) this.scheduleSave();
    return removed;
  }

  listUsers(): Array<Omit<UserRecord, 'passHash'>> {
    return this.data.users.map(({ passHash, ...rest }) => rest).sort((a, b) => b.createdAt - a.createdAt);
  }

  setUserDisabled(id: string, disabled: boolean): Omit<UserRecord, 'passHash'> | null {
    const user = this.data.users.find((u) => u.id === id);
    if (!user) return null;
    user.disabled = Boolean(disabled);
    if (user.disabled) this.data.sessions = this.data.sessions.filter((s) => s.userId !== id);
    this.scheduleSave();
    const { passHash, ...rest } = user;
    void passHash;
    return rest;
  }

  public publicUser(user: UserRecord) {
    return { id: user.id, username: user.username, role: user.role, tenantId: user.tenantId, createdAt: user.createdAt, disabled: user.disabled };
  }
}

export const userRegistry = UserRegistry.getInstance();
