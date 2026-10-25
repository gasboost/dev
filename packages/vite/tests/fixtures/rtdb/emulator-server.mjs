import http from "node:http";

const requests = [];
const server = http.createServer((request, response) => {
  if (request.url === "/requests") {
    response.end(JSON.stringify(requests));
    return;
  }
  let payload = "";
  request.on("data", (chunk) => {
    payload += chunk;
  });
  request.on("end", () => {
    requests.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      payload,
    });
    const rejected =
      new URL(request.url, "http://localhost").searchParams.get("ns") ===
      "rejected";
    response.writeHead(rejected ? 503 : 200);
    response.end(rejected ? "emulator unavailable" : "{}");
  });
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
});
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
