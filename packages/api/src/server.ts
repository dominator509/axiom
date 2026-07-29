import { serve } from "@hono/node-server";
import app from "./index.js";

const PORT = parseInt(process.env.API_PORT || "3001", 10);

serve(
  { fetch: app.fetch, port: PORT },
  (info) => console.log(`AXIOM API running on port ${info.port}`)
);
