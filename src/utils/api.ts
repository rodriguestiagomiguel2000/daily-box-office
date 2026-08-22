/**
 * Safe API request helpers ensuring proper Content-Type validation and error handling
 */

export class ApiError extends Error {
  status: number;
  statusText: string;
  data?: any;

  constructor(message: string, status: number, statusText: string, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.data = data;
  }
}

export async function fetchJson<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await res.text();
    // Non-JSON response received (e.g. HTML 404/502 page)
    throw new ApiError(
      `Server returned non-JSON response (status ${res.status}): ${text.slice(0, 100)}`,
      res.status,
      res.statusText
    );
  }

  const json = await res.json();

  if (!res.ok) {
    const errorMsg = json?.error || json?.message || `Request failed with status ${res.status}`;
    throw new ApiError(errorMsg, res.status, res.statusText, json);
  }

  return json as T;
}
