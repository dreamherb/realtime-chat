const signInBtn = document.getElementById("signInBtn");

const checkEmailValid = () => {
  const emailInput = document.getElementById("email");
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(emailInput)) {
    return false;
  }
  return true;
};

function signIn() {
  const isEmailValid = checkEmailValid();
  if (!isEmailValid) {
    return alert("올바른 이메일 형식을 입력해주세요.");
  }
}

signInBtn.addEventListener("click", signIn);
