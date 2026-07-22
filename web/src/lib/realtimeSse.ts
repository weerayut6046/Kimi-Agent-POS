export type SseMessage = {
  event: string;
  data: string;
};

const MAX_BUFFER_LENGTH = 64 * 1024;

/** Small SSE parser for the app's deliberately tiny, single-purpose stream. */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = "";

  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (buffer.length > MAX_BUFFER_LENGTH) {
      buffer = "";
      throw new Error("Realtime stream frame is too large");
    }

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trimStart();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) onMessage({ event, data: data.join("\n") });
      boundary = buffer.indexOf("\n\n");
    }
  };
}
