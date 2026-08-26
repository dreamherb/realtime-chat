const jwt = require("jsonwebtoken");
const { encrypt, hashPassword, verifyPassword } = require("./auth.crypto");
const {
  SESSION_COOKIE,
  DEVICE_COOKIE,
  cookieBase,
  revokeRequestSession,
} = require("./auth.middleware");
const authService = require("./auth.service");
const {
  SESSION_TTL_MS,
  createSession,
} = require("./auth.sessions");
const { getIo } = require("../chat/chat.realtime");

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

    const encryptedEmail = encrypt(email);
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

    const session = await createSession(req, user.id);
    if (session.replacedJtis.length) {
      const io = getIo();
      io?.to(`user:${user.id}`).emit("session:replaced", {
        platform: session.platform,
      });
    }

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
        sid: session.sessionId,
        plat: session.platform,
      },
      jwtSecret,
      {
        expiresIn: "1h",
        issuer: "realtime-chat",
        jwtid: session.jti,
      },
    );

    res.cookie(SESSION_COOKIE, accessToken, {
      ...cookieBase(),
      maxAge: SESSION_TTL_MS,
    });
    res.cookie(DEVICE_COOKIE, session.deviceId, {
      ...cookieBase(),
      maxAge: 365 * 24 * 60 * 60 * 1000,
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

    const encryptedEmail = encrypt(email);
    const passwordHash = await hashPassword(password);

    await authService.createUser({
      nickname,
      encryptedEmail,
      passwordHash,
    });

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

// GET /auth/logout
async function getLogout(req, res) {
  try {
    await revokeRequestSession(req);
  } catch (error) {
    console.error("ERROR IN GET /auth/logout : ", error.stack);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  return res.redirect("/auth/login");
}

// POST /auth/logout
async function postLogout(req, res) {
  try {
    await revokeRequestSession(req);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return res.status(200).json({
      success: true,
      message: "로그아웃되었습니다.",
      redirectUrl: "/",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/logout : ", error.stack);
    return res.status(500).json({
      success: false,
      message: "로그아웃 처리 중 오류가 발생했습니다.",
    });
  }
}

module.exports = {
  getLogin,
  getSignup,
  getLogout,
  postLogin,
  postSignup,
  postLogout,
};
