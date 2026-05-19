const jwt = require("jsonwebtoken");
const { encryptEmail, hashPassword, verifyPassword } = require("./auth.crypto");
const authService = require("./auth.service");

// GET /auth/login
async function getLogin(req, res, next) {
  try {
    const user = req.user;
    if (user) {
      return res.redirect("/dashboard");
    } else {
      return res.render("login");
    }
  } catch (error) {
    console.error("ERROR IN GET /auth/login : ", error.stack);
    res.status(500).send("An error occurred while getting /auth/login");
    return res.render("error");
  }
}

// GET /auth/signup
async function getSignup(req, res, next) {
  try {
    return res.render("signup");
  } catch (error) {
    console.error("ERROR IN GET /auth/signup : ", error.stack);
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

    const encryptedEmail = encryptEmail(email);
    const user = await authService.findUserByEmail(encryptedEmail);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "이메일 또는 비밀번호가 일치하지 않습니다.",
      });
    }

    const isPasswordValid = await verifyPassword(password, user.password);

    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: "이메일 또는 비밀번호가 일치하지 않습니다.",
      });
    }

    // 로그인에 성공한 후 JWT 발급
    const jwtSecret = process.env.JWT_ACCESS_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        message: "JWT 설정이 누락되었습니다.",
      });
    }

    const accessToken = jwt.sign(
      {
        id: user.id,
        email: encryptedEmail,
        nickname: user.nickname,
      },
      jwtSecret,
      {
        expiresIn: "1h",
        issuer: "realtime-chat",
      },
    );

    res.cookie("usi", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 1000,
      path: "/",
    });

    return res.status(200).json({
      success: true,
      message: "로그인되었습니다.",
      accessToken,
      redirectUrl: "/dashboard",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/login : ", error.stack);
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

    await authService.createUser({
      nickname,
      encryptedEmail,
      passwordHash,
    });

    console.log("[signup] encryptedEmail:", encryptedEmail);
    console.log("[signup] passwordHash:", passwordHash);

    return res.status(201).json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      redirectUrl: "/auth/login",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/signup : ", error.stack);
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
