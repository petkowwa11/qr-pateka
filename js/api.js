const tokenKey = "qr-teacher-token";

export function teacherToken() {
  return sessionStorage.getItem(tokenKey) || "";
}

export function setTeacherToken(token) {
  if (token) sessionStorage.setItem(tokenKey, token);
  else sessionStorage.removeItem(tokenKey);
}

function teacherHeaders() {
  return { "X-Teacher-Token": teacherToken() };
}

export async function getBoard() {
  const response = await fetch("/api/board");
  if (!response.ok) throw new Error("board");
  return response.json();
}

export async function getState() {
  const response = await fetch("/api/state", { headers: teacherHeaders() });
  if (response.status === 401) {
    const error = new Error("login");
    error.status = 401;
    throw error;
  }
  if (!response.ok) throw new Error("state");
  return response.json();
}

export async function login(password) {
  const data = await postJson("/api/login", { password });
  setTeacherToken(data.token);
  return data;
}

export async function postJson(path, body, teacher = false) {
  const headers = { "Content-Type": "application/json" };
  if (teacher) Object.assign(headers, teacherHeaders());
  const response = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "request");
    error.status = response.status;
    if (Array.isArray(data.wrong)) error.wrong = data.wrong;
    else if (typeof data.wrong === "string") error.wrong = [data.wrong];
    else error.wrong = null;
    throw error;
  }
  return data;
}
