const { clearSessionCookie } = require("../auth/auth.middleware");
const authService = require("../auth/auth.service");
const chatService = require("../chat/chat.service");

const dashboardController = {
  async getDashboard(req, res) {
    try {
      const userId = req.user.id;
      const dbUser = await authService.findUserById(userId);
      if (!dbUser) {
        clearSessionCookie(res);
        return res.redirect("/");
      }

      const roomId = Number(req.query.roomId);
      let messages = [];
      let currentRoom = "채팅방을 선택해 주세요";
      let selectedRoomId = null;

      if (Number.isFinite(roomId)) {
        const isMember = await chatService.isRoomMember(roomId, userId);
        if (isMember) {
          await chatService.markRoomAsRead(roomId, userId);
          selectedRoomId = roomId;
          messages = await chatService.getMessagesForRoom(roomId, userId);
          currentRoom =
            (await chatService.getRoomDisplayName(roomId, userId)) || "채팅방";
        }
      }

      return res.render("dashboard", {
        user: {
          id: dbUser.id,
          name: dbUser.nickname,
        },
        rooms: await chatService.listRoomsForUser(userId),
        joinableGroups: await chatService.listJoinableGroups(userId),
        messages,
        currentRoom,
        selectedRoomId,
      });
    } catch (error) {
      console.error("ERROR IN GET /dashboard : ", error.stack);
      return res.status(500).render("error");
    }
  },
};

module.exports = dashboardController;
