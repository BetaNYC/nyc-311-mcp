import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("server lists the expected tools", async () => {
  const client = new Client({ name: "smoke-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/index.js", import.meta.url).pathname],
  });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "get_calendar",
      "get_service_request",
      "get_service_request_list",
      "get_status",
    ]);
    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} has a description`);
      assert.equal(tool.inputSchema.type, "object");
    }
    const status = tools.find((t) => t.name === "get_status");
    assert.deepEqual(status.inputSchema.required, ["type"]);
    assert.deepEqual(status.inputSchema.properties.type.enum, [
      "CodeBlue",
      "FireHydrant",
      "OEM",
      "SnowOnSidewalk",
      "SnowOnStreet",
    ]);
    const calendar = tools.find((t) => t.name === "get_calendar");
    assert.deepEqual(Object.keys(calendar.inputSchema.properties).sort(), [
      "date",
      "from_date",
      "to_date",
    ]);
  } finally {
    await client.close();
  }
});
