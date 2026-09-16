import { describe, expect, it } from "vitest";
import { geminiLiveWebSocketUrl } from "./gemini-live";

describe("geminiLiveWebSocketUrl", () => {
  it("uses the constrained v1alpha websocket for auth_tokens", () => {
    const url = geminiLiveWebSocketUrl({
      ephemeralToken: "auth_tokens/abc123",
      model: "gemini-3.1-flash-live-preview",
      source: "auth_token_v1alpha",
    });

    expect(url).toContain("google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained");
    expect(url).toContain("access_token=auth_tokens%2Fabc123");
  });

  it("uses the v1beta api-key websocket for master-key fallback", () => {
    const url = geminiLiveWebSocketUrl({
      ephemeralToken: "AIza-example",
      model: "gemini-3.1-flash-live-preview",
      source: "master_key_fallback",
    });

    expect(url).toContain("google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent");
    expect(url).toContain("key=AIza-example");
  });
});
