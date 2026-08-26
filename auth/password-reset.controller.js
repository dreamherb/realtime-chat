const crypto = require("crypto");
const { encrypt, hashPassword } = require("./auth.crypto");
const authService = require("./auth.service");
const { signPasswordResetJwt } = require("./password-reset.jwt");
const {
  PASSWORD_RESET_COOKIE,
  PASSWORD_RESET_COOKIE_PATH,
  OTP_TTL_MINUTES,
  RESET_TOKEN_TTL_MINUTES,
} = require("./password-reset.constants");
const passwordResetService = require("./password-reset.service");
const { sendPasswordResetOtp } = require("../infrastructure/mail/mailer");
const { clearPasswordResetCookie } = require("./password-reset.middleware");

const GENERIC_EMAIL_RESPONSE = {
  success: true,
  message: "등록된 이메일이 있으면 인증번호를 발송했습니다.",
};

function mysqlDateTimeFromNowMinutes(minutes) {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function setPasswordResetCookie(res, token) {
  res.cookie(PASSWORD_RESET_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: RESET_TOKEN_TTL_MINUTES * 60 * 1000,
    path: PASSWORD_RESET_COOKIE_PATH,
  });
}

// GET /auth/forgot
async function getForgotPage(req, res, next) {
  try {
    return res.render("forgot", {
      reason: req.query.reason || null,
    });
  } catch (error) {
    console.error("ERROR IN GET /auth/forgot : ", error.stack);
    return next(error);
  }
}

// GET /auth/forgot/reset (쿠키+JWT 검증은 미들웨어)
async function getResetPage(req, res, next) {
  try {
    return res.render("forgot-reset");
  } catch (error) {
    console.error("ERROR IN GET /auth/forgot/reset : ", error.stack);
    return next(error);
  }
}

// POST /auth/forgot/send-code
async function postSendForgotCode(req, res) {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "이메일을 입력해 주세요.",
      });
    }

    const encryptedEmail = encrypt(email);
    const user = await authService.findUserByEmail(encryptedEmail);

    if (!user) {
      return res.status(200).json(GENERIC_EMAIL_RESPONSE);
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = passwordResetService.hashOtpCode(code);
    const codeExpiresAt = mysqlDateTimeFromNowMinutes(OTP_TTL_MINUTES);

    await passwordResetService.upsertOtpForUser({
      userId: user.id,
      codeHash,
      codeExpiresAt,
    });

    try {
      await sendPasswordResetOtp({ to: email, code });
    } catch (mailErr) {
      console.error("[forgot] mail send failed:", mailErr);
      return res.status(500).json({
        success: false,
        message: "인증번호 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      });
    }

    return res.status(200).json(GENERIC_EMAIL_RESPONSE);
  } catch (error) {
    console.error("ERROR IN POST /auth/forgot/send-code : ", error.stack);
    return res.status(500).json({
      success: false,
      message: "요청 처리 중 오류가 발생했습니다.",
    });
  }
}

// POST /auth/forgot/verify-code
async function postVerifyForgotCode(req, res) {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    const code = (req.body?.code || "").trim();

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "이메일과 인증번호를 입력해 주세요.",
      });
    }

    const encryptedEmail = encrypt(email);
    const user = await authService.findUserByEmail(encryptedEmail);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "인증번호가 올바르지 않거나 만료되었습니다.",
      });
    }

    const jti = crypto.randomUUID();
    const resetJtiExpiresAt = mysqlDateTimeFromNowMinutes(RESET_TOKEN_TTL_MINUTES);

    const consumed = await passwordResetService.consumeOtpAndSetResetJti({
      userId: user.id,
      plainCode: code,
      jti,
      resetJtiExpiresAt,
    });

    if (!consumed.ok) {
      return res.status(400).json({
        success: false,
        message:
          consumed.reason === "EXPIRED"
            ? "인증번호 유효 시간이 지났습니다. 다시 발송해 주세요."
            : "인증번호가 올바르지 않습니다.",
      });
    }

    const token = signPasswordResetJwt({ userId: user.id, jti });
    setPasswordResetCookie(res, token);

    return res.status(200).json({
      success: true,
      message: "인증되었습니다. 새 비밀번호를 설정해 주세요.",
      redirectUrl: "/auth/forgot/reset",
    });
  } catch (error) {
    if (
      error.message &&
      error.message.includes("JWT_PASSWORD_RESET_SECRET")
    ) {
      console.error("POST /auth/forgot/verify-code: JWT secret missing");
      return res.status(500).json({
        success: false,
        message: "서버 설정 오류입니다.",
      });
    }
    console.error("ERROR IN POST /auth/forgot/verify-code : ", error.stack);
    return res.status(500).json({
      success: false,
      message: "요청 처리 중 오류가 발생했습니다.",
    });
  }
}

// POST /auth/forgot/reset
async function postCompleteReset(req, res) {
  try {
    const { userId, jti } = req.passwordResetClaims;
    const { password, confirmPassword } = req.body || {};

    if (!password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "비밀번호와 비밀번호 확인을 입력해 주세요.",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "비밀번호가 서로 일치하지 않습니다.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "비밀번호는 8자 이상이어야 합니다.",
      });
    }

    const passwordHash = await hashPassword(password);
    const result = await passwordResetService.applyNewPasswordAfterResetVerification({
      userId,
      jwtJti: jti,
      passwordHash,
    });

    if (!result.ok) {
      const msg =
        result.reason === "RESET_TOKEN_EXPIRED"
          ? "재설정 허용 시간이 만료되었습니다. 처음부터 다시 진행해 주세요."
          : "비밀번호를 변경할 수 없습니다. 다시 인증해 주세요.";
      clearPasswordResetCookie(res);
      return res.status(400).json({
        success: false,
        message: msg,
      });
    }

    clearPasswordResetCookie(res);
    return res.status(200).json({
      success: true,
      message: "비밀번호가 변경되었습니다.",
      redirectUrl: "/auth/login",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/forgot/reset : ", error.stack);
    clearPasswordResetCookie(res);
    return res.status(500).json({
      success: false,
      message: "비밀번호 변경 중 오류가 발생했습니다.",
    });
  }
}

module.exports = {
  getForgotPage,
  getResetPage,
  postSendForgotCode,
  postVerifyForgotCode,
  postCompleteReset,
};
