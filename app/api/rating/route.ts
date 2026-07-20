import { getD1 } from "../../../db";
import { handleRatingGet, handleRatingPost } from "../../../lib/rating-api";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    return await handleRatingGet(await getD1(), request);
  } catch {
    return Response.json({ error: "Rating service is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    return await handleRatingPost(await getD1(), request);
  } catch {
    return Response.json({ error: "Rating service is temporarily unavailable." }, { status: 503 });
  }
}
