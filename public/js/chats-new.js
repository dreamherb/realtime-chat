const createChatBtn = document.getElementById("createChatBtn");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createDmChat() {
  const targetEmail = document.getElementById("targetEmail").value.trim();

  if (!emailPattern.test(targetEmail)) {
    return showAlertModal("올바른 이메일 형식을 입력해주세요.");
  }

  $.ajax({
    url: "/api/rooms",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      type: "DM",
      targetEmail,
    }),
    success: function (data) {
      if (!data.success) {
        return showAlertModal(data.message || "채팅방 생성에 실패했습니다.");
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    },
    error: function (xhr) {
      try {
        const data = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(data.message || "채팅방 생성에 실패했습니다.");
      } catch (err) {
        console.error("create chat error:", err);
        showAlertModal("채팅방 생성 요청 중 오류가 발생했습니다.");
      }
    },
  });
}

createChatBtn.addEventListener("click", createDmChat);
