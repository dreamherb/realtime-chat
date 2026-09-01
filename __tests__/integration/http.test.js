const request = require("supertest");
const app = require("../../app");
const { encrypt } = require("../../auth/auth.crypto");
const { pool } = require("../../infrastructure/database");

const createdEmails = [];

function uniqueEmail() {
  const email = `jest-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}@example.com`;
  createdEmails.push(email);
  return email;
}

async function cleanupCreatedUsers() {
  for (const email of createdEmails) {
    const [rows] = await pool.query("SELECT id FROM users WHERE email = ?", [
      encrypt(email),
    ]);
    const userId = rows[0]?.id;
    if (!userId) continue;
    await pool.query("DELETE FROM users_sessions WHERE user_id = ?", [userId]);
    await pool.query("DELETE FROM users WHERE id = ?", [userId]);
  }
  createdEmails.length = 0;
}

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    throw new Error(
      `통합 테스트는 MySQL이 필요합니다. DB를 띄운 뒤 yarn test:int 를 실행하세요. (${error.message})`,
    );
  }
});

afterAll(async () => {
  await cleanupCreatedUsers();
});

describe("GET /health", () => {
  test("정상일 때 ok를 반환한다", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  test("종료 중이면 503이다", async () => {
    app.set("shuttingDown", true);
    try {
      const res = await request(app).get("/health");
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: "stopping" });
    } finally {
      app.set("shuttingDown", false);
    }
  });
});

describe("회원가입 / 로그인", () => {
  test("필드가 비면 400이다", async () => {
    const res = await request(app).post("/auth/signup").send({
      nickname: "jest",
      email: "",
      password: "secret12",
      confirmPassword: "secret12",
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("가입 후 로그인하면 세션 쿠키를 준다", async () => {
    const email = uniqueEmail();
    const password = "secret12";

    const signup = await request(app).post("/auth/signup").send({
      nickname: `jest-${Date.now()}`,
      email,
      password,
      confirmPassword: password,
    });
    expect(signup.status).toBe(201);
    expect(signup.body.success).toBe(true);

    const dup = await request(app).post("/auth/signup").send({
      nickname: "jest-dup",
      email,
      password,
      confirmPassword: password,
    });
    expect(dup.status).toBe(400);
    expect(dup.body.message).toBe("이미 사용 중인 이메일입니다.");

    const login = await request(app)
      .post("/auth/login")
      .set("User-Agent", "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36")
      .send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.success).toBe(true);
    expect(login.body.accessToken).toBeTruthy();

    const cookies = login.headers["set-cookie"] || [];
    expect(cookies.some((cookie) => cookie.startsWith("usi="))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith("did="))).toBe(true);

    const bad = await request(app).post("/auth/login").send({
      email,
      password: "wrong-password",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.success).toBe(false);
  });
});
