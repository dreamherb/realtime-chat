const { encrypt } = require("../auth/auth.crypto");
const authService = require("../auth/auth.service");
const chatService = require("./chat.service");
const {
  notifyDmRoomCreated,
  notifyGroupCreated,
  notifyRoomMemberJoined,
  notifyRoomMemberLeft,
} = require("./chat.realtime");

const ROOM_FAIL = {
  ROOM_NOT_FOUND: { status: 404, message: "채팅방을 찾을 수 없습니다." },
  NOT_JOINABLE: { status: 400, message: "참여할 수 없는 채팅방입니다." },
  NOT_MEMBER: { status: 400, message: "참여 중인 채팅방이 아닙니다." },
};

function sendRoomFail(res, reason, fallbackMessage) {
  const mapped = ROOM_FAIL[reason];
  return res.status(mapped?.status || 400).json({
    success: false,
    message: mapped?.message || fallbackMessage,
  });
}

const chatController = {
  async postCreateRoom(req, res) {
    try {
      const userId = req.user.id;
      const { type, targetEmail, name } = req.body || {};

      if (type === chatService.ROOM_TYPE.DM) {
        if (!targetEmail) {
          return res.status(400).json({
            success: false,
            message: "상대방 이메일을 입력해주세요.",
          });
        }

        const encryptedEmail = encrypt(targetEmail.trim());
        const targetUser = await authService.findUserByEmail(encryptedEmail);

        if (!targetUser) {
          return res.status(404).json({
            success: false,
            message: "해당 이메일의 사용자를 찾을 수 없습니다.",
          });
        }

        const result = await chatService.createDmRoom(
          userId,
          targetUser.id,
        );

        if (!result.ok) {
          return res.status(400).json({
            success: false,
            message: "자기 자신과는 채팅방을 만들 수 없습니다.",
          });
        }

        if (!result.existing || result.targetRestored) {
          await notifyDmRoomCreated(result.roomId, targetUser.id);
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

        const result = await chatService.createGroupRoom(userId, groupName);

        await notifyGroupCreated(result.roomId, userId, groupName);

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

  async postJoinRoom(req, res) {
    try {
      const userId = req.user.id;
      const roomId = Number(req.params.roomId);
      if (!Number.isFinite(roomId)) {
        return res.status(400).json({
          success: false,
          message: "유효하지 않은 채팅방입니다.",
        });
      }

      const result = await chatService.joinGroup(roomId, userId);

      // 가입 API 응답을 시스템 메시지 INSERT에 묶지 않음 (동시 입장 시 응답 latency 보호)
      if (result.ok && !result.alreadyMember) {
        notifyRoomMemberJoined(roomId, userId);
      }

      if (!result.ok) {
        return sendRoomFail(res, result.reason, "참여에 실패했습니다.");
      }

      return res.status(result.alreadyMember ? 200 : 201).json({
        success: true,
        message: result.alreadyMember
          ? "이미 참여 중인 채팅방입니다."
          : "그룹에 참여했습니다.",
        roomId: result.roomId,
        redirectUrl: `/dashboard?roomId=${result.roomId}`,
      });
    } catch (error) {
      console.error("ERROR IN POST /api/rooms/:roomId/join : ", error.stack);
      return res.status(500).json({
        success: false,
        message: "그룹 참여 중 오류가 발생했습니다.",
      });
    }
  },

  async postLeaveRoom(req, res) {
    try {
      const userId = req.user.id;
      const roomId = Number(req.params.roomId);
      if (!Number.isFinite(roomId)) {
        return res.status(400).json({
          success: false,
          message: "유효하지 않은 채팅방입니다.",
        });
      }

      const result = await chatService.leaveRoom(roomId, userId);

      if (result.ok) {
        notifyRoomMemberLeft(userId, roomId, {
          announce: result.roomType !== chatService.ROOM_TYPE.DM,
        });
      }

      if (!result.ok) {
        return sendRoomFail(res, result.reason, "퇴장에 실패했습니다.");
      }

      return res.status(200).json({
        success: true,
        message: "채팅방에서 퇴장했습니다.",
        redirectUrl: "/dashboard",
      });
    } catch (error) {
      console.error("ERROR IN POST /api/rooms/:roomId/leave : ", error.stack);
      return res.status(500).json({
        success: false,
        message: "퇴장 처리 중 오류가 발생했습니다.",
      });
    }
  },
};

module.exports = chatController;
