const nodemailer = require("nodemailer");

function createTransportSafe() {
  const host = process.env.SMTP_HOST;
  if (!host) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
  });
}

/**
 * @param {{ to: string, code: string }} param0
 */
async function sendPasswordResetOtp({ to, code }) {
  const transporter = createTransportSafe();
  const from = process.env.SMTP_USER;

  if (!transporter) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[mailer] SMTP 미설정 — 개발 모드에서 콘솔로 OTP 출력: ${to} => ${code}`,
      );
      return;
    }
    throw new Error("SMTP 설정(SMTP_HOST 등)이 없습니다.");
  }

  if (!from) {
    throw new Error("SMTP_USER이 필요합니다.");
  }

  await transporter.sendMail({
    from,
    to,
    subject: "[Realtime Chat] 비밀번호 재설정 인증번호",
    text: `인증번호: ${code}\n5분 이내에 입력해 주세요.`,
  });
}

module.exports = {
  createTransportSafe,
  sendPasswordResetOtp,
};
