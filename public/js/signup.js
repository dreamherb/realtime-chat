const createAccountBtn = document.getElementById("createAccountBtn");

function signUp() {
  const isEmailValid = checkEmailValid();
  if (!isEmailValid) {
    return showAlertModal("올바른 이메일 형식을 입력해주세요.");
  }

  const pwd = document.getElementById("password").value.trim();
  const confirmPassword = document
    .getElementById("confirmPassword")
    .value.trim();

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
}

createAccountBtn.addEventListener("click", signUp);
