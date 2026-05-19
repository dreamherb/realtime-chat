const sendCodeBtn = document.getElementById("sendCodeBtn");
const verifyCodeBtn = document.getElementById("verifyCodeBtn");

function sendCode() {
  const email = document.getElementById("email").value.trim().toLowerCase();
  const isEmailValid = checkEmailValid();
  if (!isEmailValid) {
    return showAlertModal("올바른 이메일 형식을 입력해 주세요.");
  }

  $.ajax({
    url: "/auth/forgot/send-code",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ email }),
    success: function (data) {
      if (!data.success) {
        return showAlertModal(data.message || "요청에 실패했습니다.");
      }
      showAlertModal(data.message || "인증번호를 발송했습니다.");
    },
    error: function (xhr) {
      try {
        const data = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(data.message || "발송 요청 중 오류가 발생했습니다.");
      } catch (err) {
        console.error(err);
        showAlertModal("발송 요청 중 오류가 발생했습니다.");
      }
    },
  });
}

function verifyCode() {
  const email = document.getElementById("email").value.trim().toLowerCase();
  const code = document.getElementById("code").value.trim();

  if (!checkEmailValid()) {
    return showAlertModal("올바른 이메일 형식을 입력해 주세요.");
  }
  if (!/^\d{6}$/.test(code)) {
    return showAlertModal("6자리 인증번호를 입력해 주세요.");
  }

  $.ajax({
    url: "/auth/forgot/verify-code",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ email, code }),
    success: function (data) {
      if (!data.success) {
        return showAlertModal(data.message || "인증에 실패했습니다.");
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    },
    error: function (xhr) {
      try {
        const data = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(data.message || "인증에 실패했습니다.");
      } catch (err) {
        console.error(err);
        showAlertModal("인증 요청 중 오류가 발생했습니다.");
      }
    },
  });
}

sendCodeBtn.addEventListener("click", sendCode);
verifyCodeBtn.addEventListener("click", verifyCode);
