const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { pool } = require("../infrastructure/database");
const { getRedisClient } = require("../infrastructure/redis/redis.client");

const SESSION_TTL_MS = 60 * 60 * 1000;
const DEVICE_COOKIE = "did";

function cacheKey(jti) {
  return `session:jti:${jti}`;
}

function detectPlatform(userAgent = "") {
  return /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent) ? "mobile" : "pc";
}

function deviceLabel(userAgent = "") {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/Chrome\//i.test(userAgent) && !/Edg\//i.test(userAgent)) return "Chrome";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "Browser";
}

function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().slice(0, 45);
  }
  return (req.ip || req.socket?.remoteAddress || "").slice(0, 45) || null;
}

async function cacheGet(jti) {
  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(cacheKey(jti));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error("[session] redis get error:", error.message);
    return null;
  }
}

async function cacheSet(jti, value, ttlSec) {
  const redis = await getRedisClient();
  if (!redis || ttlSec <= 0) return;
  try {
    await redis.set(cacheKey(jti), JSON.stringify(value), { EX: ttlSec });
  } catch (error) {
    console.error("[session] redis set error:", error.message);
  }
}

async function cacheDel(jtis) {
  const ids = (jtis || []).filter(Boolean);
  if (!ids.length) return;
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    for (const jti of ids) {
      await redis.del(cacheKey(jti));
    }
  } catch (error) {
    console.error("[session] redis del error:", error.message);
  }
}

function isActiveRow(row) {
  if (!row || row.revoked_at) return false;
  return new Date(row.expires_at) > new Date();
}

async function loadActiveByJti(jti) {
  const [rows] = await pool.query(
    `SELECT id, user_id, platform, expires_at, revoked_at
     FROM users_sessions
     WHERE token_jti = ?
     LIMIT 1`,
    [jti],
  );
  const row = rows[0];
  if (!isActiveRow(row)) return null;
  return row;
}

async function createSession(req, userId) {
  const userAgent = String(req.headers?.["user-agent"] || "").slice(0, 512);
  const platform = detectPlatform(userAgent);
  const deviceId =
    req.cookies?.[DEVICE_COOKIE] || crypto.randomUUID().replace(/-/g, "").slice(0, 64);
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const ip = clientIp(req);

  const conn = await pool.getConnection();
  let replacedJtis = [];
  let sessionId;
  try {
    await conn.beginTransaction();
    const [oldRows] = await conn.query(
      `SELECT token_jti FROM users_sessions
       WHERE user_id = ? AND platform = ? AND revoked_at IS NULL
       FOR UPDATE`,
      [userId, platform],
    );
    replacedJtis = oldRows.map((row) => row.token_jti);
    if (replacedJtis.length) {
      await conn.query(
        `UPDATE users_sessions
         SET revoked_at = NOW()
         WHERE user_id = ? AND platform = ? AND revoked_at IS NULL`,
        [userId, platform],
      );
    }
    const [result] = await conn.query(
      `INSERT INTO users_sessions (
         user_id, platform, device_id, device_label, token_jti, ip, user_agent,
         last_seen_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        userId,
        platform,
        deviceId,
        deviceLabel(userAgent),
        jti,
        ip,
        userAgent || null,
        expiresAt,
      ],
    );
    sessionId = result.insertId;
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  await cacheDel(replacedJtis);
  await cacheSet(
    jti,
    { userId: Number(userId), sessionId, platform },
    Math.ceil(SESSION_TTL_MS / 1000),
  );

  return {
    jti,
    sessionId,
    deviceId,
    platform,
    replacedJtis,
  };
}

async function assertSession(payload) {
  const jti = payload?.jti;
  const userId = Number(payload?.id);
  if (!jti || !userId) return false;

  const cached = await cacheGet(jti);
  if (cached) {
    return Number(cached.userId) === userId;
  }

  const row = await loadActiveByJti(jti);
  if (!row || Number(row.user_id) !== userId) return false;

  const ttlSec = Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000);
  await cacheSet(
    jti,
    { userId: Number(row.user_id), sessionId: row.id, platform: row.platform },
    ttlSec,
  );
  return true;
}

async function revokeByJti(jti) {
  if (!jti) return;
  await pool.query(
    `UPDATE users_sessions SET revoked_at = NOW()
     WHERE token_jti = ? AND revoked_at IS NULL`,
    [jti],
  );
  await cacheDel([jti]);
}

async function revokeAllForUser(userId) {
  const [rows] = await pool.query(
    `SELECT token_jti FROM users_sessions
     WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );
  const jtis = rows.map((row) => row.token_jti);
  if (!jtis.length) return;
  await pool.query(
    `UPDATE users_sessions SET revoked_at = NOW()
     WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );
  await cacheDel(jtis);
}

function readJtiFromToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.decode(token);
    return decoded?.jti || null;
  } catch {
    return null;
  }
}

module.exports = {
  SESSION_TTL_MS,
  DEVICE_COOKIE,
  detectPlatform,
  createSession,
  assertSession,
  revokeByJti,
  revokeAllForUser,
  readJtiFromToken,
};
