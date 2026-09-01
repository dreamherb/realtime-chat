const express = require("express");
const router = express.Router();
const { requireAuth } = require("../auth/auth.middleware");
const chatController = require("./chat.controller");

router.get("/chats/new", requireAuth("page"), (req, res) =>
  res.render("chats-new"),
);
router.get("/groups/new", requireAuth("page"), (req, res) =>
  res.render("groups-new"),
);
router.post("/api/rooms", requireAuth("api"), chatController.postCreateRoom);
router.post(
  "/api/rooms/:roomId/join",
  requireAuth("api"),
  chatController.postJoinRoom,
);
router.post(
  "/api/rooms/:roomId/leave",
  requireAuth("api"),
  chatController.postLeaveRoom,
);

module.exports = router;
