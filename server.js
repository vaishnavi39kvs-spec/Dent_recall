const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
require("dotenv").config();

const port = Number(process.env.PORT || 3000);
const root = __dirname;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS dentrecall_patients (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS dentrecall_visits (
        id text PRIMARY KEY,
        patient_id text NOT NULL,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error("Request body is too large."));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("Request body must be valid JSON.")); }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/health") {
    const result = await pool.query("SELECT current_database() AS name");
    return sendJson(res, 200, { ok: true, database: "connected", databaseName: result.rows[0].name });
  }
  if (req.method === "GET" && req.url === "/api/state") {
    const patients = await pool.query("SELECT data FROM dentrecall_patients ORDER BY updated_at, id");
    const visits = await pool.query("SELECT data FROM dentrecall_visits ORDER BY updated_at, id");
    return sendJson(res, 200, {
      patients: patients.rows.map(row => row.data),
      visits: visits.rows.map(row => row.data)
    });
  }
  if (req.method === "POST" && req.url === "/api/state") {
    const data = await parseBody(req);
    if (!Array.isArray(data.patients) || !Array.isArray(data.visits)) {
      return sendJson(res, 400, { error: "patients and visits must be arrays." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM dentrecall_visits");
      await client.query("DELETE FROM dentrecall_patients");
      for (const patient of data.patients) {
        await client.query(
          "INSERT INTO dentrecall_patients (id, data) VALUES ($1, $2::jsonb)",
          [patient.id, JSON.stringify(patient)]
        );
      }
      for (const visit of data.visits) {
        await client.query(
          "INSERT INTO dentrecall_visits (id, patient_id, data) VALUES ($1, $2, $3::jsonb)",
          [visit.id, visit.patientId, JSON.stringify(visit)]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 404, { error: "Not found." });
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(root + path.sep)) return sendJson(res, 403, { error: "Forbidden." });
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(res, 404, { error: "File not found." });
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) await handleApi(req, res);
    else serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error." });
  }
});

ensureSchema()
  .then(() => server.listen(port, () => console.log(`DentRecall running at http://localhost:${port}`)))
  .catch(error => { console.error("Database initialization failed:", error.message); process.exit(1); });

process.on("SIGTERM", async () => { await pool.end(); server.close(); });
