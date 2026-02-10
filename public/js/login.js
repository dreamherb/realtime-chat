const signInBtn = document.getElementById("signInBtn");

function signIn() {
  const isEmailValid = checkEmailValid();
  if (!isEmailValid) {
    return showAlertModal("올바른 이메일 형식을 입력해주세요.");
  }

  const pwd = document.getElementById("password").value.trim();
  if (isTextEmpty(pwd)) {
    return showAlertModal("비밀번호를 입력해주세요.");
  }

  const email = document.getElementById("email").value.trim();

  $.ajax({
    url: "/auth/login",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ email, password: pwd }),
    success: function (data) {
      if (!data.success) {
        return showAlertModal(data.message || "로그인에 실패했습니다.");
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    },
    error: function (xhr) {
      try {
        const data = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(data.message || "로그인에 실패했습니다.");
      } catch (err) {
        console.error("login request error:", err);
        showAlertModal("로그인 요청 중 오류가 발생했습니다.");
      }
    },
  });
}

signInBtn.addEventListener("click", signIn);
