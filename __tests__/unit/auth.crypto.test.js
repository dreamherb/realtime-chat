const { encrypt, hashPassword, verifyPassword } = require("../../auth/auth.crypto");

describe("auth.crypto", () => {
  test("같은 입력을 암호화하면 결과가 같다", () => {
    expect(encrypt("user@example.com")).toBe(encrypt("user@example.com"));
  });

  test("다른 입력은 암호문도 다르다", () => {
    expect(encrypt("a@example.com")).not.toBe(encrypt("b@example.com"));
  });

  test("비밀번호 해시와 원문이 일치한다", async () => {
    const hashed = await hashPassword("secret-pass");
    expect(hashed).not.toBe("secret-pass");
    await expect(verifyPassword("secret-pass", hashed)).resolves.toBe(true);
    await expect(verifyPassword("wrong-pass", hashed)).resolves.toBe(false);
  });
});
