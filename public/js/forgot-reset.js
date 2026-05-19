const resetPwdBtn = document.getElementById("resetPwdBtn");

function submitReset() {
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (isTextEmpty(password) || isTextEmpty(confirmPassword)) {
    return showAlertModal("비밀번호를 입력해 주세요.");
  }
  if (password.length < 8) {
    return showAlertModal("비밀번호는 8자 이상이어야 합니다.");
  }
  if (password !== confirmPassword) {
    return showAlertModal("비밀번호가 서로 일치하지 않습니다.");
  }

  $.ajax({
    url: "/auth/forgot/reset",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ password, confirmPassword }),
    success: function (data) {
      if (!data.success) {
        return showAlertModal(data.message || "변경에 실패했습니다.");
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    },
    error: function (xhr) {
      try {
        const data = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(data.message || "변경에 실패했습니다.");
      } catch (err) {
        console.error(err);
        showAlertModal("요청 중 오류가 발생했습니다.");
      }
    },
  });
}

resetPwdBtn.addEventListener("click", submitReset);
