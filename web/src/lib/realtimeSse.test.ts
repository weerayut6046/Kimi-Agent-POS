import { describe, expect, it } from "vitest";
import { createSseParser, type SseMessage } from "./realtimeSse";

describe("realtime SSE parser", () => {
  it("parses frames split across network chunks", () => {
    const messages: SseMessage[] = [];
    const parse = createSseParser(message => messages.push(message));

    parse("event: ready\r\ndata: {\r\n");
    parse("data: }\r\n\r\nevent: invalidate\ndata: {\"version\":1}\n\n");

    expect(messages).toEqual([
      { event: "ready", data: "{\n}" },
      { event: "invalidate", data: '{"version":1}' },
    ]);
  });

  it("rejects an unbounded frame", () => {
    const parse = createSseParser(() => undefined);
    expect(() => parse("x".repeat(64 * 1024 + 1))).toThrow(
      "Realtime stream frame is too large"
    );
  });
});
