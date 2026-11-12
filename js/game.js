const KEY = "qr-pateka-v3";
const NAME_KEY = "qr-pateka-name";

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function loadProgress(trailId) {
  const trail = readAll()[trailId];
  return trail && typeof trail === "object" ? trail : {};
}

export function bestOf(trailId, stationId) {
  return loadProgress(trailId)[stationId] || null;
}

export function starsFor(points) {
  if (points >= 100) return 3;
  if (points >= 60) return 2;
  return 1;
}

export function scoreFor(attempts, hintUsed) {
  if (hintUsed || attempts >= 3) return 30;
  if (attempts <= 1) return 100;
  return 60;
}

export function recordSuccess(trailId, stationId, points) {
  const all = readAll();
  const trail = all[trailId] && typeof all[trailId] === "object" ? all[trailId] : {};
  const stars = starsFor(points);
  const prev = trail[stationId];
  const kept = Boolean(prev && points <= prev.points);
  if (!kept) {
    trail[stationId] = { points, stars };
    all[trailId] = trail;
    localStorage.setItem(KEY, JSON.stringify(all));
  }
  return { points, stars, kept, best: kept ? prev.points : points };
}

export function isUnlocked(stationList, index, progress) {
  for (let i = 0; i < index; i += 1) {
    if (!progress[stationList[i].id]) return false;
  }
  return true;
}

export function canOpen(stationList, index, progress) {
  if (progress[stationList[index].id]) return true;
  return isUnlocked(stationList, index, progress);
}

export function totalPoints(stationList, progress) {
  return stationList.reduce((sum, station) => sum + (progress[station.id]?.points || 0), 0);
}

export function clearProgress(trailId) {
  const all = readAll();
  delete all[trailId];
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function getName() {
  return (localStorage.getItem(NAME_KEY) || "").trim();
}

export function setName(name) {
  localStorage.setItem(NAME_KEY, name.trim());
}

export function parseNumber(raw) {
  if (raw == null) return null;
  const text = String(raw).trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function sameNumber(a, b) {
  return Math.abs(a - b) < 0.001;
}

export function starsText(count) {
  return "★".repeat(count) + "☆".repeat(3 - count);
}

export function classRanking(trails, results, className) {
  const classKey = className.trim().toLocaleLowerCase("bg");
  const ids = new Set(
    trails.filter((trail) => trail.className.trim().toLocaleLowerCase("bg") === classKey).map((trail) => trail.id)
  );
  const people = new Map();
  results.forEach((row) => {
    if (!ids.has(row.trailId)) return;
    const key = row.nameKey || row.name.trim().toLocaleLowerCase("bg");
    if (!people.has(key)) {
      people.set(key, { name: row.name, stars: 0, points: 0, stations: 0 });
    }
    const person = people.get(key);
    person.name = row.name;
    person.stars += Number(row.stars) || 0;
    person.points += Number(row.points) || 0;
    person.stations += 1;
  });
  return [...people.values()].sort((a, b) => b.stars - a.stars || b.points - a.points || a.name.localeCompare(b.name, "bg"));
}
