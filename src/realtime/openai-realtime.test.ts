import { describe, expect, it } from "vitest";
import { parseOpenAIRealtimeToolCall } from "./openai-realtime";

describe("parseOpenAIRealtimeToolCall", () => {
  it("parses response.function_call_arguments.done events", () => {
    const parsed = parseOpenAIRealtimeToolCall({
      type: "response.function_call_arguments.done",
      call_id: "call_1",
      name: "take_night_shift",
      arguments: "{}",
    });

    expect(parsed?.callId).toBe("call_1");
    expect(parsed?.call.name).toBe("take_night_shift");
    expect(parsed?.call.args).toEqual({});
  });

  it("parses response.output_item.done function-call items", () => {
    const parsed = parseOpenAIRealtimeToolCall({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call_2",
        name: "raise_resentment",
        arguments: "{\"delta\":12}",
      },
    });

    expect(parsed?.callId).toBe("call_2");
    expect(parsed?.call.name).toBe("raise_resentment");
    expect(parsed?.call.args).toEqual({ delta: 12 });
  });
});
