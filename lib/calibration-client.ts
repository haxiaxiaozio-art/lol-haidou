import type { CalibrationModel } from "./types";

const CALIBRATION_API = "https://lol-haidou-rating.haxiaxiaozio.workers.dev/api/calibration";

export async function fetchCommunityCalibration(): Promise<CalibrationModel> {
  const response = await fetch(CALIBRATION_API, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`社区校准模型暂时不可用（${response.status}）`);
  const body = await response.json() as { model?: CalibrationModel };
  if (!body.model || !Array.isArray(body.model.roles) || body.model.roles.length !== 6) throw new Error("社区校准模型返回的数据不完整");
  return body.model;
}
