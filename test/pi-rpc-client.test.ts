import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PiRpcClient } from "../src/pi-rpc-client";

describe("Pi RPC client", () => {
  test("reports first-run UI requests without mistaking pricing warnings for the cause", async () => {
    const fixture = join(import.meta.dir, "fixtures", "fake-setup-pi.ts");
    const client = new PiRpcClient(
      [Bun.which("bun") ?? "bun", fixture],
      1_000,
    );

    try {
      await expect(client.prompt("draft an email")).rejects.toThrow(
        "Pi RPC requires interactive setup: Use exe.dev LLM integrations?",
      );
    } finally {
      await client.close();
    }
  });
});
