import { handleRatingGet, handleRatingPost } from "../lib/rating-api";
import { handleCalibrationGet, handleCalibrationPost } from "../lib/calibration-api";

interface Env { DB: D1Database }

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/calibration") {
      if (request.method === "GET") return handleCalibrationGet(env.DB);
      if (request.method === "POST") return handleCalibrationPost(env.DB, request);
      return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (url.pathname !== "/api/rating") return Response.json({ error: "Not found." }, { status: 404 });
    if (request.method === "GET") return handleRatingGet(env.DB, request);
    if (request.method === "POST") return handleRatingPost(env.DB, request);
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
  },
};

export default worker;
