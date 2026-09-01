const express = require("express");
const router = express.Router();
const { requireAuth } = require("../auth/auth.middleware");
const notificationsController = require("./notifications.controller");

router.get(
  "/notifications",
  requireAuth("page"),
  notificationsController.getNotificationsPage,
);

router.get(
  "/api/push/vapid-public-key",
  requireAuth("api"),
  notificationsController.getVapidPublicKey,
);

router.get(
  "/api/push/status",
  requireAuth("api"),
  notificationsController.getStatus,
);

router.post(
  "/api/push/preference",
  requireAuth("api"),
  notificationsController.postPreference,
);

router.post(
  "/api/push/subscribe",
  requireAuth("api"),
  notificationsController.postSubscribe,
);

router.delete(
  "/api/push/subscribe",
  requireAuth("api"),
  notificationsController.deleteSubscribe,
);

module.exports = router;
