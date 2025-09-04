const signInBtn = document.getElementById("signInBtn");

const checkEmailValid = () => {
  const email = document.getElementById("email").value;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    return false;
  }
  return true;
};

function isTextEmpty(val) {
  if (val === null || val === undefined) {
    return true;
  }

  if (typeof val === "string") {
    return val.trim() === "";
  }

  return false;
}

function signIn() {
  const isEmailValid = checkEmailValid();
  if (!isEmailValid) {
    return showModal("올바른 이메일 형식을 입력해주세요.");
  }

  const pwd = document.getElementById("password").value.trim();

  if (isTextEmpty(pwd)) {
    return showModal("비밀번호를 입력해주세요.");
  }

  // 로그인 성공 시 ajax로 로그인 로직 호출
}

signInBtn.addEventListener("click", signIn);
