import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpEventStream } from "../../src/lib/legislative/datagouv-mcp.js";

test("parses the streamable HTTP response used by data.gouv MCP", () => {
  assert.deepEqual(parseMcpEventStream('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}\n'), { content: [] });
});
