import { getBoard } from "./api.js";
import { canOpen, clearProgress, isUnlocked, loadProgress, totalPoints } from "./game.js";

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function starsMarkup(count) {
  return `<p class="stars" aria-label="${count} от 3 звезди">${"★".repeat(count).replaceAll("★", '<span class="on">★</span>')}${"☆".repeat(3 - count)}</p>`;
}

function renderTrail(trail) {
  const stations = trail.stations || [];
  const progress = loadProgress(trail.id);
  const currentIndex = stations.findIndex((_, index) => isUnlocked(stations, index, progress) && !progress[stations[index].id]);
  const stops = stations.map((station, index) => {
    const saved = progress[station.id];
    const open = canOpen(stations, index, progress);
    const classes = [
      "stop",
      saved ? "is-done" : "",
      !open ? "is-locked" : "",
      index === currentIndex ? "is-current" : ""
    ].filter(Boolean).join(" ");
    const body = `
      <h2>${escapeHtml(station.title)}</h2>
      <p>${escapeHtml(station.teaser)}</p>
      ${saved ? `${starsMarkup(saved.stars)}<p>${saved.points} точки</p>` : ""}
      ${!open ? '<p class="lock">Заключена</p>' : ""}`;
    const inner = open
      ? `<a class="stop-link" href="play.html?trail=${encodeURIComponent(trail.id)}&station=${encodeURIComponent(station.id)}&from=map">${body}</a>`
      : body;
    return `<li class="${classes}" id="stop-${station.id}"><span class="num">${index + 1}</span><div class="stop-body">${inner}</div></li>`;
  }).join("");
  app.innerHTML = `
    <p class="eyebrow">${escapeHtml(trail.className)}</p>
    <h1>${escapeHtml(trail.title)}</h1>
    <p class="lead">Станциите се отварят по ред. Отпечатаният QR код отваря своята станция и без отключване.</p>
    <p class="total">Събрани точки: <strong>${totalPoints(stations, progress)}</strong> от <strong>${stations.length * 100}</strong></p>
    <ol class="path">${stops}</ol>
    <p class="row-actions">
      <button type="button" class="btn btn-ghost" id="reset">Изчисти напредъка</button>
    </p>`;
  document.querySelector("#reset").addEventListener("click", () => {
    clearProgress(trail.id);
    renderTrail(trail);
  });
}

function renderScan() {
  app.innerHTML = `
    <h1>Сканирай кода</h1>
    <p class="lead">Задачите са на листовете в стаята. Отвори камерата и сканирай QR кода на станцията. Първо ще си напишеш името.</p>`;
}

async function init() {
  try {
    const state = await getBoard();
    const requested = new URLSearchParams(location.search).get("trail");
    const trail = state.trails.find((item) => item.id === requested);
    if (trail) renderTrail(trail);
    else renderScan();
  } catch {
    app.innerHTML = `<h1>Няма връзка със сървъра</h1><p>Отвори https://qr-pateka.thevibehosting.com/.</p>`;
  }
}

init();
