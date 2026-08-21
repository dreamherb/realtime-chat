const webpush = require("web-push");
const { pool } = require("../infrastructure/database");

let vapidConfigured = false;

function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

async function isPushEnabled(userId) {
  if (!userId) return false;
  const [rows] = await pool.query(
    "SELECT push_enabled FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  return Boolean(rows[0]?.push_enabled);
}

async function setPushEnabled(userId, enabled) {
  await pool.query("UPDATE users SET push_enabled = ? WHERE id = ?", [
    enabled ? 1 : 0,
    userId,
  ]);
  if (!enabled) {
    await pool.query("DELETE FROM push_subscriptions WHERE user_id = ?", [
      userId,
    ]);
  }
  return { ok: true };
}

function isPushConfigured() {
  return Boolean(getVapidPublicKey() && process.env.VAPID_PRIVATE_KEY);
}

function ensureVapidConfigured() {
  if (vapidConfigured || !isPushConfigured()) return;

  webpush.setVapidDetails(
    process.env.VAPID_CONTACT_EMAIL || "mailto:noreply@localhost",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
}

async function savePushSubscription(userId, subscription, userAgent) {
  const endpoint = subscription?.endpoint;
  const keys = subscription?.keys || {};
  const p256dh = keys.p256dh;
  const auth = keys.auth;

  if (!endpoint || !p256dh || !auth) {
    return { ok: false, reason: "INVALID_SUBSCRIPTION" };
  }

  const [existing] = await pool.query(
    "SELECT user_id FROM push_subscriptions WHERE endpoint = ? LIMIT 1",
    [endpoint],
  );
  if (existing[0] && Number(existing[0].user_id) !== Number(userId)) {
    return { ok: false, reason: "ENDPOINT_OWNED" };
  }

  const sql = `
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      p256dh = VALUES(p256dh),
      auth = VALUES(auth),
      user_agent = VALUES(user_agent),
      updated_at = CURRENT_TIMESTAMP
  `;

  await pool.query(sql, [userId, endpoint, p256dh, auth, userAgent || null]);
  return { ok: true };
}

async function removePushSubscription(userId, endpoint) {

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

  const [rows] = await pool.query(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    [userId],
  );
  return rows;
}

async function sendPushToUser(userId, payload) {
  if (!isPushConfigured()) return { ok: false, reason: "NOT_CONFIGURED" };
  if (!(await isPushEnabled(userId))) {
    return { ok: false, reason: "DISABLED" };
  }

  ensureVapidConfigured();
  const subscriptions = await listPushSubscriptionsForUser(userId);
  if (!subscriptions.length) {
    return { ok: false, reason: "NO_SUBSCRIPTIONS" };
  }

  const body = JSON.stringify(payload);
  let sent = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        body,
      );
      sent += 1;
      if (process.env.NODE_ENV === "development") {
        console.log("[push] sent ok", userId, subscription.endpoint.slice(0, 48));
      }
    } catch (error) {
      const statusCode = error?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await removePushSubscription(userId, subscription.endpoint);
      }
      console.warn(
        "[push] send failed:",
        userId,
        subscription.endpoint,
        statusCode || error.message,
      );
    }
  }

  return { ok: sent > 0, sent, subscriptionCount: subscriptions.length };
}

module.exports = {
  getVapidPublicKey,
  isPushConfigured,
  isPushEnabled,
  setPushEnabled,
  savePushSubscription,
  removePushSubscription,
  listPushSubscriptionsForUser,
  sendPushToUser,
};
