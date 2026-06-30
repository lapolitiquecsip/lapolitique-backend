const DEFAULT_ENDPOINT = "https://mcp.data.gouv.fr/mcp";

export function parseMcpEventStream(body: string): any {
  const dataLine = body.split(/\r?\n/).find(line => line.startsWith("data:"));
  if (!dataLine) throw new Error("data.gouv MCP returned no JSON-RPC data event");
  const message = JSON.parse(dataLine.slice(5).trim());
  if (message.error) throw new Error(message.error.message ?? "data.gouv MCP error");
  return message.result;
}

export async function callDataGouvTool(name: string, args: Record<string, unknown>, endpoint = DEFAULT_ENDPOINT) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`data.gouv MCP HTTP ${response.status}`);
  return parseMcpEventStream(await response.text());
}
