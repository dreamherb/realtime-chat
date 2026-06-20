const { pool } = require("../infrastructure/database");

let tableReady = false;

async function ensurePushSubscriptionsTable() {
  if (tableReady) return;

  const sql = `
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      endpoint VARCHAR(768) NOT NULL,
      p256dh VARCHAR(255) NOT NULL,
      auth VARCHAR(255) NOT NULL,
      user_agent VARCHAR(512) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_push_endpoint (endpoint),
      KEY idx_push_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;

  await pool.query(sql);
  tableReady = true;
}

function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function isPushConfigured() {
  return Boolean(getVapidPublicKey() && process.env.VAPID_PRIVATE_KEY);
}

async function savePushSubscription(userId, subscription, userAgent) {
  await ensurePushSubscriptionsTable();

  const endpoint = subscription?.endpoint;
  const keys = subscription?.keys || {};
  const p256dh = keys.p256dh;
  const auth = keys.auth;

  if (!endpoint || !p256dh || !auth) {
    return { ok: false, reason: "INVALID_SUBSCRIPTION" };
  }

  const sql = `
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      user_id = VALUES(user_id),
      p256dh = VALUES(p256dh),
      auth = VALUES(auth),
      user_agent = VALUES(user_agent),
      updated_at = CURRENT_TIMESTAMP
  `;

  await pool.query(sql, [userId, endpoint, p256dh, auth, userAgent || null]);
  return { ok: true };
}

async function removePushSubscription(userId, endpoint) {
  await ensurePushSubscriptionsTable();

  if (!endpoint) {
    await pool.query("DELETE FROM push_subscriptions WHERE user_id = ?", [userId]);
    return { ok: true };
  }

  await pool.query(
    "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
    [userId, endpoint],
  );
  return { ok: true };
}

async function listPushSubscriptionsForUser(userId) {
  await ensurePushSubscriptionsTable();

  const [rows] = await pool.query(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    [userId],
  );
  return rows;
}

/**
 * Web Push 전송은 web-push 패키지 연동 후 chat.realtime에서 호출 예정.
 * 현재는 구독 저장까지만 지원합니다.
 */
async function sendPushToUser(userId, payload) {
  if (!isPushConfigured()) return { ok: false, reason: "NOT_CONFIGURED" };

  const subscriptions = await listPushSubscriptionsForUser(userId);
  if (!subscriptions.length) {
    return { ok: false, reason: "NO_SUBSCRIPTIONS" };
  }

  return {
    ok: true,
    pending: true,
    subscriptionCount: subscriptions.length,
    payload,
  };
}

module.exports = {
  getVapidPublicKey,
  isPushConfigured,
  savePushSubscription,
  removePushSubscription,
  listPushSubscriptionsForUser,
  sendPushToUser,
};
