import process from "process";

function getBaseUrl(): string {
  const raw = process.env.HONGGUO_NSH_BACKEND;
  if (!raw) throw new Error("请使用完整目录里的「红果开源播放器.exe」启动播放器");
  const { port, token } = JSON.parse(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("本地片源服务启动异常，请关闭后重新打开播放器");
  }
  return `http://127.0.0.1:${port}/${token}`;
}

export async function backendRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(getBaseUrl() + endpoint, options);
  const result = await response.json() as T & { error?: string };
  if (!response.ok || result.error) throw new Error(result.error || `片源服务请求失败 (${response.status})`);
  return result;
}

export async function prepareHongguoEpisode(vid: string, signal: AbortSignal, refresh = false) {
  const result = await backendRequest<{ path: string; sizeBytes: number }>(`/prepare/${encodeURIComponent(vid)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh }), signal,
  });
  return { resolvedUrl: getBaseUrl() + result.path, sizeBytes: result.sizeBytes };
}
