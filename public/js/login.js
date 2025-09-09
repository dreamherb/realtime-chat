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

  // 로그인 성공 시 ajax로 로그인 로직 호출
}

signInBtn.addEventListener("click", signIn);
