function showAlertModal(message) {
  document.getElementById("alertModalMsg").innerText = message;
  document.getElementById("alertModalOverlay").style.display = "flex";
}
function closeAlertModal() {
  document.getElementById("alertModalOverlay").style.display = "none";
  document.getElementById("alertModalMsg").innerText = "";
}

const checkEmailValid = () => {
  const email = document.getElementById("email").value;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    return false;
  }
  return true;
};

const ALLOWED_SPECIAL = `!@#$%^&*()[]{}_-+=|\\:;"'<>,.?/~\``;

function isValidPassword(pw) {
  // 정규식 구성:
  // (?=.*[A-Za-z])   → 영문자 최소 1개
  // (?=.*\\d)        → 숫자 최소 1개
  // (?=.*[...])      → 특수문자 최소 1개
  // (?!.*\\s)        → 공백 금지
  // 전체 허용 문자 집합 & 길이 제한: {8,15}
  const re = new RegExp(
    `^(?=.*[A-Za-z])(?=.*\\d)(?=.*[${escapeForClass(
      ALLOWED_SPECIAL
    )}])(?!.*\\s)[A-Za-z\\d${escapeForClass(ALLOWED_SPECIAL)}]{8,15}$`
  );
  return re.test(pw);
}

// 정규식 문자 클래스에 들어갈 특수문자 안전 처리
function escapeForClass(str) {
  return str.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function isTextEmpty(val) {
  if (val === null || val === undefined) {
    return true;
  }

  if (typeof val === "string") {
    return val.trim() === "";
  }

  return false;
}
