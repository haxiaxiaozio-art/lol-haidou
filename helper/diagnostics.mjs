const diagnosticCopy = {
  "client-login": {
    title: "客户端未登录",
    suggestion: "启动国服 LOL 客户端并完成登录，然后重新检测。",
  },
  "region-unavailable": {
    title: "当前大区不可用",
    suggestion: "确认客户端大区，助手会继续尝试 LCU 和本机日志。",
  },
  "interface-timeout": {
    title: "接口超时或暂时不可用",
    suggestion: "保持客户端在线后重试；连续失败时可重启客户端和数据助手。",
  },
  "permission-denied": {
    title: "连接权限不足",
    suggestion: "重新启动最新版数据助手，并允许浏览器访问本机网络。",
  },
  "field-missing": {
    title: "战绩字段缺失",
    suggestion: "更新数据助手；该来源会被跳过，不完整数据不会进入评分。",
  },
};

const errorCode = (error) => String(error?.code ?? "UNKNOWN_ERROR").toUpperCase();

export function diagnoseSyncError(error, source = "helper", severity = "error") {
  const code = errorCode(error);
  let category = "interface-timeout";
  if (/CLIENT_(?:UNAVAILABLE|NOT_LOGGED|NOT_READY)/.test(code)) category = "client-login";
  else if (/REGION_UNSUPPORTED|REGION_UNAVAILABLE/.test(code)) category = "region-unavailable";
  else if (/AUTH|PERMISSION|ORIGIN_NOT_ALLOWED|SESSION_REQUIRED|HTTP_40[13]/.test(code)) category = "permission-denied";
  else if (/FIELD|INVALID_RESPONSE|PLAYER_UNAVAILABLE|ENDPOINT_UNAVAILABLE/.test(code)) category = "field-missing";
  else if (/TIMEOUT|REQUEST_FAILED|NETWORK_ERROR|UNAVAILABLE/.test(code)) category = "interface-timeout";
  const copy = diagnosticCopy[category];
  return {
    category,
    code,
    source,
    severity,
    title: copy.title,
    message: error instanceof Error ? error.message : "同步链路返回了未知错误。",
    suggestion: copy.suggestion,
    retryable: category !== "field-missing",
  };
}

export function missingFieldDiagnostic(source, message) {
  return diagnoseSyncError(
    Object.assign(new Error(message), { code: "MATCH_FIELD_MISSING" }),
    source,
    "warning",
  );
}
