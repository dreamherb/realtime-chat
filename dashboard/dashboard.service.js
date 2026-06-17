const authService = require("../auth/auth.service");
const chatService = require("../chat/chat.service");

async function getDashboardViewData(userId, roomId) {
  const dbUser = await authService.findUserById(userId);

  if (!dbUser) {
    return null;
  }

  if (roomId) {
    const numericRoomId = Number(roomId);
    const isMember = await chatService.isRoomMember(numericRoomId, userId);

    if (isMember) {
      await chatService.markRoomAsRead(numericRoomId, userId);
    }
  }

  const rooms = await chatService.listRoomsForUser(userId);
  const joinableGroups = await chatService.listJoinableGroups(userId);
  let messages = [];
  let currentRoom = "채팅방을 선택해 주세요";
  let selectedRoomId = null;

  if (roomId) {
    const numericRoomId = Number(roomId);
    const isMember = await chatService.isRoomMember(numericRoomId, userId);

    if (isMember) {
      selectedRoomId = numericRoomId;
      messages = await chatService.getMessagesForRoom(numericRoomId, userId);
      currentRoom =
        (await chatService.getRoomDisplayName(numericRoomId, userId)) ||
        "채팅방";
    }
  }

  return {
    user: {
      id: dbUser.id,
      name: dbUser.nickname,
    },
    rooms,
    joinableGroups,
    messages,
    currentRoom,
    selectedRoomId,
  };
}

module.exports = {
  getDashboardViewData,
};
