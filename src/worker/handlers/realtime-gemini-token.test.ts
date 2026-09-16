import { describe, expect, it } from "vitest";
import { buildGeminiAuthTokenRequest } from "./realtime-gemini-token";

describe("buildGeminiAuthTokenRequest", () => {
  it("targets the Gemini v1alpha auth_tokens endpoint", () => {
    const req = buildGeminiAuthTokenRequest("test key", "gemini-3.1-flash-live-preview", 0);

    expect(req.url).toBe("https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=test%20key");
    expect(req.body).toMatchObject({
      uses: 1,
      bidiGenerateContentSetup: {
        model: "models/gemini-3.1-flash-live-preview",
        generationConfig: { responseModalities: ["AUDIO"] },
      },
    });
  });

  it("does not double-prefix model resource names", () => {
    const req = buildGeminiAuthTokenRequest("key", "models/gemini-3.1-flash-live-preview", 0);

    expect(req.body.bidiGenerateContentSetup.model).toBe("models/gemini-3.1-flash-live-preview");
  });
});
