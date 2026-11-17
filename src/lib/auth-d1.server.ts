import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { getD1 } from "./d1.server";

const COOKIE = "__Host-tn-session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const ITERATIONS = 100_000; // Cloudflare Workers WebCrypto supports at most 100,000 PBKDF2 iterations.

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return bytesToBase64(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}
async function passwordHash(
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
  iterations = ITERATIONS,
): Promise<string> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) {
    throw new Error("Ongeldige PBKDF2-instelling voor Cloudflare Workers.");
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2-sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Accept both the corrected delimited format and the legacy format that
  // was written by the first Cloudflare migration build (without "$" separators).
  let algorithm: string;
  let rounds: string;
  let saltText: string;
  let expectedText: string;
  if (stored.includes("$")) {
    [algorithm, rounds, saltText, expectedText] = stored.split("$");
  } else {
    algorithm = stored.slice(0, 13);
    rounds = stored.slice(13, 19);
    saltText = stored.slice(19, 43);
    expectedText = stored.slice(43);
  }
  const iterations = Number(rounds);
  if (algorithm !== "pbkdf2-sha256" || !/^\d+$/.test(rounds) || !Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS || !saltText || !expectedText) return false;
  let actualBytes: Uint8Array;
  let expectedBytes: Uint8Array;
  try {
    const actual = await passwordHash(password, base64ToBytes(saltText), iterations);
    actualBytes = base64ToBytes(actual.split("$")[3]);
    expectedBytes = base64ToBytes(expectedText);
  } catch {
    return false;
  }
  if (actualBytes.length !== expectedBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < actualBytes.length; i++) diff |= actualBytes[i] ^ expectedBytes[i];
  return diff === 0;
}
function setSessionCookie(token: string) {
  setCookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
}
function clearSessionCookie() {
  deleteCookie(COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}

export type D1User = { id: string; email: string; display_name: string | null; gender: string | null; is_admin: boolean };

export async function getCurrentD1User(): Promise<D1User | null> {
  const token = getCookie(COOKIE);
  if (!token) return null;
  const db = getD1();
  const tokenHash = await sha256(token);
  const row = await db.prepare(`
    SELECT u.id, u.email, u.display_name,
      EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin') AS is_admin
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.blocked = 0
  `).bind(tokenHash).first<{id:string;email:string;display_name:string|null;gender:string|null;is_admin:number}>();
  if (!row) return null;
  return { ...row, is_admin: row.is_admin === 1 };
}

export async function registerD1User(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Vul een geldig e-mailadres in.");
  if (password.length < 10 || password.length > 200) throw new Error("Gebruik een wachtwoord van minimaal 10 tekens.");
  const db = getD1();
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) throw new Error("Er bestaat al een account met dit e-mailadres.");
  const id = crypto.randomUUID();
  const hash = await passwordHash(password);
  await db.prepare("INSERT INTO users (id,email,password_hash,email_verified) VALUES (?,?,?,1)").bind(id,email,hash).run();
  await createSession(id);
  return { id, email, is_admin: false };
}

export async function loginD1User(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const db = getD1();
  const row = await db.prepare("SELECT id,email,password_hash,blocked FROM users WHERE email = ?").bind(email).first<{id:string;email:string;password_hash:string;blocked:number}>();
  if (!row || row.blocked || !(await verifyPassword(password, row.password_hash))) {
    throw new Error("E-mailadres of wachtwoord is onjuist.");
  }
  await createSession(row.id);
  return { id: row.id, email: row.email };
}

async function createSession(userId: string) {
  const db = getD1();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString().slice(0, 19).replace("T", " ");
  await db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)")
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt).run();
  setSessionCookie(token);
}

export async function logoutD1User() {
  const token = getCookie(COOKIE);
  if (token) {
    const db = getD1();
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  clearSessionCookie();
}


/** Reset an existing account using the private bootstrap secret during initial setup. */
export async function resetD1Password(emailInput: string, password: string, token: string) {
  const env = (await import("./d1.server")).getCloudflareEnv();
  const configured = env.ADMIN_BOOTSTRAP_TOKEN;
  if (typeof configured !== "string" || configured.length < 32) {
    throw new Error("Wachtwoordherstel is niet beschikbaar: de tijdelijke Cloudflare-code ontbreekt.");
  }
  const a = new TextEncoder().encode(token);
  const b = new TextEncoder().encode(configured);
  if (a.length !== b.length) throw new Error("De Cloudflare-code is onjuist.");
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  if (mismatch !== 0) throw new Error("De Cloudflare-code is onjuist.");
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Vul een geldig e-mailadres in.");
  if (password.length < 10 || password.length > 200) throw new Error("Gebruik minimaal 10 tekens voor je nieuwe wachtwoord.");
  const db = getD1();
  const user = await db.prepare("SELECT id FROM users WHERE email = ? AND blocked = 0").bind(email).first<{id:string}>();
  if (!user) throw new Error("Er is geen actief account met dit e-mailadres gevonden.");
  const hash = await passwordHash(password);
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(hash, user.id).run();
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  return { ok: true };
}

/** One-time bootstrap: only works while no administrator exists and the secret is set in Cloudflare. */
export async function claimInitialD1Admin(token: string) {
  const env = (await import("./d1.server")).getCloudflareEnv();
  const configured = env.ADMIN_BOOTSTRAP_TOKEN;
  if (typeof configured !== "string" || configured.length < 32) {
    throw new Error("De eenmalige beheerderscode is nog niet ingesteld in Cloudflare.");
  }
  const user = await getCurrentD1User();
  if (!user) throw new Error("Log eerst in met je account.");
  const db = getD1();
  const admin = await db.prepare("SELECT id FROM user_roles WHERE role = 'admin' LIMIT 1").first();
  if (admin) throw new Error("De eerste beheerder is al ingesteld.");
  const a = new TextEncoder().encode(token);
  const b = new TextEncoder().encode(configured);
  if (a.length !== b.length) throw new Error("De beheerderscode is onjuist.");
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  if (mismatch !== 0) throw new Error("De beheerderscode is onjuist.");
  await db.prepare("INSERT INTO user_roles (id,user_id,role) VALUES (?,?, 'admin')")
    .bind(crypto.randomUUID(), user.id).run();
  return { ok: true };
}

/** Change password for the currently signed-in account without exposing credentials to the client. */
export async function changeD1Password(currentPassword: string, newPassword: string) {
  const user = await getCurrentD1User();
  if (!user) throw new Error("Je bent niet ingelogd.");
  if (newPassword.length < 10 || newPassword.length > 200) {
    throw new Error("Gebruik een nieuw wachtwoord van minimaal 10 tekens.");
  }
  const db = getD1();
  const row = await db.prepare("SELECT password_hash FROM users WHERE id = ? AND blocked = 0")
    .bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    throw new Error("Je huidige wachtwoord is onjuist.");
  }
  const hash = await passwordHash(newPassword);
  await db.prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(hash, user.id).run();
  const token = getCookie(COOKIE);
  if (token) {
    const currentHash = await sha256(token);
    await db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
      .bind(user.id, currentHash).run();
  }
  return { ok: true };
}
