const authService = require("../auth/auth.service");

/**
 * 대시보드 렌더링용 데이터
 * - users: nickname → view의 user.name
 * - rooms/messages: 채팅 테이블 도입 전까지 빈 배열
 */
async function getDashboardViewData(encryptedEmail) {
  const dbUser = await authService.findUserByEmail(encryptedEmail);

  if (!dbUser) {
    return null;
  }

  return {
    user: {
      // id: dbUser.id,
      name: dbUser.nickname,
    },
    rooms: [],
    messages: [],
    currentRoom: "채팅방을 선택해 주세요",
  };
}

module.exports = {
  getDashboardViewData,
};
