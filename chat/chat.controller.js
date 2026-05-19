const { encryptEmail } = require("../auth/auth.crypto");
const { resolveSessionUser } = require("../auth/auth.session");
const authService = require("../auth/auth.service");
const chatService = require("./chat.service");

const chatController = {
  async getNewChatPage(req, res) {
    try {
      return res.render("chats-new");
    } catch (error) {
      console.error("ERROR IN GET /chats/new : ", error.stack);
      return res.status(500).render("error");
    }
  },

  async getNewGroupPage(req, res) {
    try {
      return res.render("groups-new");
    } catch (error) {
      console.error("ERROR IN GET /groups/new : ", error.stack);
      return res.status(500).render("error");
    }
  },

  async postCreateRoom(req, res) {
    try {
      const sessionUser = await resolveSessionUser(req);
      if (!sessionUser) {
        return res.status(401).json({
          success: false,
          message: "로그인이 필요합니다.",
        });
      }

      const { type, targetEmail, name } = req.body || {};

      if (type === chatService.ROOM_TYPE.DM) {
        if (!targetEmail) {
          return res.status(400).json({
            success: false,
            message: "상대방 이메일을 입력해주세요.",
          });
        }

        const encryptedEmail = encryptEmail(targetEmail.trim());
        const targetUser = await authService.findUserByEmail(encryptedEmail);

        if (!targetUser) {
          return res.status(404).json({
            success: false,
            message: "해당 이메일의 사용자를 찾을 수 없습니다.",
          });
        }

        const result = await chatService.createDmRoom(
          sessionUser.id,
          targetUser.id,
        );

        if (!result.ok) {
          return res.status(400).json({
            success: false,
            message: "자기 자신과는 채팅방을 만들 수 없습니다.",
          });
        }

        return res.status(result.existing ? 200 : 201).json({
          success: true,
          message: result.existing
            ? "이미 존재하는 채팅방으로 이동합니다."
            : "채팅방이 생성되었습니다.",
          roomId: result.roomId,
          redirectUrl: `/dashboard?roomId=${result.roomId}`,
        });
      }

      if (type === chatService.ROOM_TYPE.GROUP) {
        const groupName = (name || "").trim();
        if (!groupName) {
          return res.status(400).json({
            success: false,
            message: "그룹 이름을 입력해주세요.",
          });
        }

        const result = await chatService.createGroupRoom(
          sessionUser.id,
          groupName,
        );

        return res.status(201).json({
          success: true,
          message: "그룹 채팅방이 생성되었습니다.",
          roomId: result.roomId,
          redirectUrl: `/dashboard?roomId=${result.roomId}`,
        });
      }

      return res.status(400).json({
        success: false,
        message: "유효하지 않은 채팅방 유형입니다.",
      });
    } catch (error) {
      console.error("ERROR IN POST /api/rooms : ", error.stack);
      return res.status(500).json({
        success: false,
        message: "채팅방 생성 중 오류가 발생했습니다.",
      });
    }
  },
};

module.exports = chatController;
