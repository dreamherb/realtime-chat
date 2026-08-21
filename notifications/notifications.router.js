const express = require("express");
const router = express.Router();
const { requireUsiForPage, requireAuth } = require("../auth/auth.middleware");
const notificationsController = require("./notifications.controller");

router.get("/notifications", requireUsiForPage, notificationsController.getNotificationsPage);

router.get(
  "/api/push/vapid-public-key",
  requireAuth,
  notificationsController.getVapidPublicKey,
);

router.get(
  "/api/push/status",
  requireAuth,
  notificationsController.getStatus,
);

router.post(
  "/api/push/preference",
  requireAuth,
  notificationsController.postPreference,
);

router.post(
  "/api/push/subscribe",
  requireAuth,
  notificationsController.postSubscribe,
);

router.delete(
  "/api/push/subscribe",
  requireAuth,
  notificationsController.deleteSubscribe,
);

module.exports = router;
