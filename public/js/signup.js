const createAccountBtn = document.getElementById("createAccountBtn");

function signUp() {
  const isEmailValid = checkEmailValid();
  if (!isEmailValid) {
    return showAlertModal("올바른 이메일 형식을 입력해주세요.");
  }

  const nickname = document.getElementById("nickname").value.trim();
  const email = document.getElementById("email").value.trim();
  const pwd = document.getElementById("password").value.trim();
  const confirmPassword = document
    .getElementById("confirmPassword")
    .value.trim();

  if (isTextEmpty(nickname)) {
    return showAlertModal("닉네임을 입력해주세요.");
  }
  if (isTextEmpty(pwd)) {
    return showAlertModal("비밀번호를 입력해주세요.");
  }
  if (isValidPassword(pwd)) {
    return showAlertModal(
      "비밀 번호는 공백없이 영문, 숫자, 특수문자가 조합된 8 - 15자리여야 합니다."
    );
  }
  if (pwd !== confirmPassword) {
    return showAlertModal("입력한 비밀번호가 일치하지 않습니다.");
  }

  $.ajax({
    url: "/auth/signup",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      nickname,
      email,
      password: pwd,
      confirmPassword,
    }),
    success: function (data) {
      if (!data.success) {
        return showAlertModal(data.message || "회원가입에 실패했습니다.");
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        showAlertModal("회원가입이 완료되었습니다. 로그인 페이지로 이동해주세요.");
      }
    },
    error: function (xhr) {
      try {
        const data = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(data.message || "회원가입에 실패했습니다.");
      } catch (err) {
        console.error("signup request error:", err);
        showAlertModal("회원가입 요청 중 오류가 발생했습니다.");
      }
    },
  });
}

createAccountBtn.addEventListener("click", signUp);
