const {
  encryptEmail,
  hashPassword,
} = require("./auth.crypto");

// GET /auth/login
async function getLogin(req, res, next) {
  try {
    return res.render("login");
  } catch (error) {
    console.error("ERROR IN GET /auth/login : ", error);
    res.status(500).send("An error occurred while getting /auth/login");
    return res.render("error");
  }
}

// GET /auth/signup
async function getSignup(req, res, next) {
  try {
    return res.render("signup");
  } catch (error) {
    console.error("ERROR IN GET /auth/signup : ", error);
    res.status(500).send("An error occurred while getting /auth/signup");
    return res.render("error");
  }
}

// POST /auth/login
async function postLogin(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "이메일과 비밀번호를 입력해주세요.",
      });
    }

    // TODO: DB에서 사용자 조회 후 비밀번호 검증

    return res.status(200).json({
      success: true,
      message: "로그인되었습니다.",
      redirectUrl: "/dashboard",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/login : ", error);
    return res.status(500).json({
      success: false,
      message: "로그인 처리 중 오류가 발생했습니다.",
    });
  }
}

// POST /auth/signup
// - 이메일: 복호화 가능한 양방향 암호화
// - 비밀번호: bcrypt 단방향 해시
async function postSignup(req, res, next) {
  try {
    const { nickname, email, password, confirmPassword } = req.body || {};

    if (!nickname || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "닉네임, 이메일, 비밀번호를 모두 입력해주세요.",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "비밀번호와 비밀번호 확인이 일치하지 않습니다.",
      });
    }

    const encryptedEmail = encryptEmail(email);
    const passwordHash = await hashPassword(password);

    // TODO: DB에 사용자 정보 저장
    // await User.create({ nickname, email: encryptedEmail, password: passwordHash });

    console.log("[signup] encryptedEmail:", encryptedEmail);
    console.log("[signup] passwordHash:", passwordHash);

    return res.status(201).json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      redirectUrl: "/auth/login",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/signup : ", error);
    return res.status(500).json({
      success: false,
      message: "회원가입 처리 중 오류가 발생했습니다.",
    });
  }
}

module.exports = {
  getLogin,
  getSignup,
  postLogin,
  postSignup,
};

