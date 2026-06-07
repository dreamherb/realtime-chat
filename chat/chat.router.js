const express = require("express");
const router = express.Router();
const { requireUsiForPage, requireAuth } = require("../auth/auth.middleware");
const chatController = require("./chat.controller");

router.get("/chats/new", requireUsiForPage, chatController.getNewChatPage);
router.get("/groups/new", requireUsiForPage, chatController.getNewGroupPage);
router.post("/api/rooms", requireAuth, chatController.postCreateRoom);
router.post(
  "/api/rooms/:roomId/join",
  requireAuth,
  chatController.postJoinRoom,
);
router.post(
  "/api/rooms/:roomId/leave",
  requireAuth,
  chatController.postLeaveRoom,
);

module.exports = router;
