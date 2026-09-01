const { mapRoomSummary, formatMessagePreview } = require("../../chat/chat.service");

describe("formatMessagePreview", () => {
  test("시스템 입장/퇴장 문구를 만든다", () => {
    expect(formatMessagePreview("SYSTEM_JOIN", "호온", "")).toBe("호온님이 입장했습니다.");
    expect(formatMessagePreview("SYSTEM_LEAVE", "호온", "")).toBe("호온님이 퇴장했습니다.");
  });

  test("긴 본문은 42자로 자른다", () => {
    const long = "가".repeat(50);
    expect(formatMessagePreview("TEXT", "호온", long)).toBe(`${"가".repeat(42)}…`);
  });
});

describe("mapRoomSummary", () => {
  test("안 읽은 메시지가 없으면 preview가 없다", () => {
    expect(
      mapRoomSummary({
        id: 1,
        type: "DM",
        display_name: "상대",
        unread_count: 0,
        preview_type: "TEXT",
        preview_from: "상대",
        preview_text: "안녕",
      }),
    ).toEqual({
      id: 1,
      type: "DM",
      name: "상대",
      unreadCount: 0,
      unreadPreview: null,
    });
  });

  test("MySQL 문자열 카운트도 숫자로 바꾼다", () => {
    const summary = mapRoomSummary({
      id: 2,
      type: "GROUP",
      display_name: "팀",
      unread_count: "3",
      preview_type: "TEXT",
      preview_from: "호온",
      preview_text: "hello",
    });
    expect(summary.unreadCount).toBe(3);
    expect(summary.unreadPreview).toBe("hello");
  });
});
