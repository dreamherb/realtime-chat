const { detectPlatform, deviceLabel } = require("../../auth/auth.sessions");

describe("detectPlatform", () => {
  test("모바일 UA는 mobile이다", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(
      "mobile",
    );
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0")).toBe(
      "mobile",
    );
  });

  test("그 외는 pc이다", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0")).toBe(
      "pc",
    );
    expect(detectPlatform("")).toBe("pc");
  });
});

describe("deviceLabel", () => {
  test("UA에서 기기/브라우저 라벨을 고른다", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("iOS");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14)")).toBe("Android");
    expect(deviceLabel("Mozilla/5.0 Chrome/120.0.0.0 Edg/120.0.0.0")).toBe("Edge");
    expect(deviceLabel("Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36")).toBe("Chrome");
    expect(deviceLabel("Mozilla/5.0 Firefox/121.0")).toBe("Firefox");
    expect(deviceLabel("Mozilla/5.0 Version/17.0 Safari/605.1.15")).toBe("Safari");
    expect(deviceLabel("curl/8.0")).toBe("Browser");
  });
});
