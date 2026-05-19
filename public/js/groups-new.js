const createGroupBtn = document.getElementById("createGroupBtn");

function createGroupChat() {
  const name = document.getElementById("groupName").value.trim();

  if (isTextEmpty(name)) {
    return showAlertModal("그룹 이름을 입력해주세요.");
  }

  $.ajax({
    url: "/api/rooms",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      type: "GROUP",
      name,
    }),
    success: function (data) {
      if (!data.success) {
        return showAlertModal(data.message || "그룹 생성에 실패했습니다.");
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    },
    error: function (xhr) {
      try {
        const data = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(data.message || "그룹 생성에 실패했습니다.");
      } catch (err) {
        console.error("create group error:", err);
        showAlertModal("그룹 생성 요청 중 오류가 발생했습니다.");
      }
    },
  });
}

createGroupBtn.addEventListener("click", createGroupChat);
