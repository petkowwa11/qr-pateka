import { getBoard, postJson } from "./api.js";
import { bestOf, getName, loadProgress, parseNumber, recordSuccess, setName, starsText, totalPoints } from "./game.js";

const params = new URLSearchParams(window.location.search);
const app = document.querySelector("#app");
let trail = null;
let stations = [];
let station = null;

let attempts = 0;
let hintUsed = false;
let picks = {};
let choiceId = null;
let numberValue = "";
const numberValues = {};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function missingAnswer() {
  if (!station) return "Няма станция.";
  if (station.type === "yesno") {
    return station.items.some((item) => picks[item.id] !== "yes" && picks[item.id] !== "no");
  }
  if (station.type === "number") return parseNumber(numberValue) == null;
  if (station.type === "numbers") {
    return station.items.some((item) => parseNumber(numberValues[item.id]) == null);
  }
  if (station.type === "choice") return !choiceId;
  return false;
}

function readFields() {
  if (station.type === "number") {
    const input = document.querySelector("#answer");
    if (input) numberValue = input.value;
  }
  if (station.type === "numbers") {
    station.items.forEach((item) => {
      const input = document.querySelector(`#answer-${item.id}`);
      if (input) numberValues[item.id] = input.value;
    });
  }
}

function showFeedback(kind, text) {
  const box = document.querySelector("#feedback");
  box.hidden = false;
  box.className = `feedback ${kind}`;
  box.textContent = text;
}

function markWrong(ids) {
  const set = new Set(ids || []);
  document.querySelectorAll(".item").forEach((node) => node.classList.remove("is-wrong"));
  document.querySelectorAll("input").forEach((input) => input.removeAttribute("aria-invalid"));
  document.querySelectorAll(".choices button").forEach((button) => button.classList.remove("is-wrong"));
  set.forEach((id) => {
    if (id === "choice" && choiceId) {
      document.querySelector(`[data-choice="${choiceId}"]`)?.classList.add("is-wrong");
      return;
    }
    if (id === "value") {
      document.querySelector("#answer")?.setAttribute("aria-invalid", "true");
      return;
    }
    document.querySelector(`[data-item-card="${id}"]`)?.classList.add("is-wrong");
    document.querySelector(`#answer-${id}`)?.setAttribute("aria-invalid", "true");
  });
}

function wrongMessage() {
  if (station.type === "yesno") return "Има грешен избор. Погледни отново записите и опитай пак.";
  if (station.type === "choice") return "Този ход не оправя решението.";
  return "Коренът не съвпада. Направи проверка чрез заместване.";
}

function needMessage() {
  if (station.type === "yesno") return "Избери ДА или НЕ за всеки запис.";
  if (station.type === "choice") return "Избери един от ходовете.";
  return "Запиши число. Може и със запетая, например 24,5.";
}

function bindForm() {
  document.querySelectorAll("[data-yesno]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.item;
      picks[itemId] = button.dataset.yesno;
      document.querySelectorAll(`[data-item="${itemId}"]`).forEach((peer) => {
        peer.setAttribute("aria-pressed", peer === button ? "true" : "false");
      });
    });
  });
  document.querySelectorAll("[data-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      choiceId = button.dataset.choice;
      document.querySelectorAll("[data-choice]").forEach((peer) => {
        peer.setAttribute("aria-pressed", peer === button ? "true" : "false");
      });
    });
  });
  document.querySelector("#task-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    onSubmit();
  });
  document.querySelector("#hint")?.addEventListener("click", () => {
    hintUsed = true;
    const box = document.querySelector("#hint-box");
    box.hidden = false;
    box.textContent = station.hint;
    document.querySelector("#hint").hidden = true;
  });
}

function answerPayload() {
  if (station.type === "yesno") {
    const answers = {};
    station.items.forEach((item) => { answers[item.id] = picks[item.id] === "yes"; });
    return answers;
  }
  if (station.type === "number") return { value: parseNumber(numberValue) };
  if (station.type === "numbers") {
    const answers = {};
    station.items.forEach((item) => { answers[item.id] = parseNumber(numberValues[item.id]); });
    return answers;
  }
  return { choice: choiceId };
}

function stationPlace() {
  return stations.findIndex((item) => item.id === station.id);
}

async function onSubmit() {
  readFields();
  if (missingAnswer()) {
    showFeedback("need", needMessage());
    return;
  }
  attempts += 1;
  let data;
  try {
    data = await postJson("/api/results", {
      trailId: trail.id,
      stationId: station.id,
      name: getName(),
      attempts,
      hintUsed,
      answers: answerPayload()
    });
  } catch (err) {
    if (Array.isArray(err.wrong)) {
      showFeedback("error", wrongMessage());
      markWrong(err.wrong);
      const hint = document.querySelector("#hint");
      if (hint && !hintUsed) hint.hidden = false;
      return;
    }
    attempts -= 1;
    showFeedback("error", "Няма връзка със сървъра. Опитай пак.");
    return;
  }
  const saved = recordSuccess(trail.id, station.id, data.points);
  showSuccess(saved, data.success || "");
}

function finishMessage(points, maxPoints) {
  const ratio = maxPoints > 0 ? points / maxPoints : 0;
  if (ratio >= 0.85) return "Отлично. Почти всички точки са взети от първи опит, без подсказка.";
  if (ratio >= 0.65) return "Много добре. Повечето станции са решени чисто.";
  if (ratio >= 0.45) return "Добре. Задачите са минати, а част от точките са останали за повторен опит или за подсказка.";
  return "Стигна до края. Точките показват, че често е ползвана подсказка или е имало няколко опита. Една станция си струва да се реши още веднъж без подсказка.";
}

function finishBlock() {
  const progress = loadProgress(trail.id);
  const points = totalPoints(stations, progress);
  const stars = stations.reduce((sum, item) => sum + (progress[item.id]?.stars || 0), 0);
  const solved = stations.filter((item) => progress[item.id]).length;
  const maxPoints = stations.length * 100;
  const note = solved < stations.length
    ? `<p>На този телефон са записани ${solved} от ${stations.length} станции. Сборът е от тях.</p>`
    : "";
  return `
    <p class="score">Твоите точки от трасето: ${points} от ${maxPoints}</p>
    <p class="stars" aria-label="${stars} от ${stations.length * 3} звезди">${stars} от ${stations.length * 3} звезди</p>
    ${note}
    <p class="feedback ok">${finishMessage(points, maxPoints)}</p>`;
}

function showSuccess(saved, successText) {
  const index = stationPlace();
  const next = stations[index + 1];
  const keptLine = saved.kept
    ? `<p>Този опит носи ${saved.points} точки. Запазен е по-добрият резултат: ${saved.best} точки.</p>`
    : "";
  const nextLine = next
    ? `<p>Намери следващия лист и сканирай неговия код. Тази страница не отваря другите задачи.</p>`
    : finishBlock();
  app.innerHTML = `
    <p class="eyebrow">Станция ${index + 1} от ${stations.length}</p>
    <h1>${escapeHtml(station.title)}</h1>
    <section class="task">
      <p class="feedback ok">Вярно.</p>
      <p class="score" data-points="${saved.points}">${saved.points} точки</p>
      <p class="stars" aria-label="${saved.stars} от 3 звезди">${starsText(saved.stars).replaceAll("★", '<span class="on">★</span>').replaceAll("☆", "<span>☆</span>")}</p>
      ${keptLine}
      <p>${escapeHtml(successText)}</p>
      ${nextLine}
      <p class="row-actions">
        <button type="button" class="btn btn-ghost" id="retry">Реши отново</button>
      </p>
    </section>`;
  document.querySelector("#retry").addEventListener("click", () => {
    attempts = 0;
    hintUsed = false;
    picks = {};
    choiceId = null;
    numberValue = "";
    Object.keys(numberValues).forEach((key) => delete numberValues[key]);
    paint();
  });
}

function yesnoItems() {
  return station.items.map((item) => `
    <div class="item" data-item-card="${item.id}">
      <p class="expr">${escapeHtml(item.expr)}</p>
      <div class="yesno">
        <button type="button" data-item="${item.id}" data-yesno="yes" aria-pressed="${picks[item.id] === "yes" ? "true" : "false"}">ДА</button>
        <button type="button" data-item="${item.id}" data-yesno="no" aria-pressed="${picks[item.id] === "no" ? "true" : "false"}">НЕ</button>
      </div>
    </div>`).join("");
}

function numberFields() {
  const story = station.story ? `<p class="story">${escapeHtml(station.story)}</p>` : "";
  return `
    ${story}
    <p class="expr">${escapeHtml(station.prompt)}</p>
    <label for="answer">Корен</label>
    <input id="answer" name="answer" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(numberValue)}">`;
}

function numbersFields() {
  const story = station.story ? `<p class="story">${escapeHtml(station.story)}</p>` : "";
  return story + station.items.map((item) => `
    <div class="item" data-item-card="${item.id}">
      <p class="expr">${escapeHtml(item.expr)}</p>
      <label for="answer-${item.id}">${escapeHtml(item.name)} =</label>
      <input id="answer-${item.id}" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(numberValues[item.id] || "")}">
    </div>`).join("");
}

function choiceFields() {
  return `
    <p class="expr">${escapeHtml(station.shown)}</p>
    <p>Чуждо решение: ${escapeHtml(station.wrong)}</p>
    <div class="choices">
      ${station.choices.map((choice) => `
        <button type="button" data-choice="${choice.id}" aria-pressed="${choiceId === choice.id ? "true" : "false"}">${escapeHtml(choice.text)}</button>
      `).join("")}
    </div>`;
}

function paint() {
  if (!station) {
    app.innerHTML = `
      <h1>Няма такава станция</h1>
      <p>Попитай учителя за листа с тази задача.</p>`;
    return;
  }
  const index = stationPlace();
  const saved = bestOf(trail.id, station.id);
  const savedLine = saved
    ? `<p class="saved">Запазен резултат: ${saved.points} точки.</p>`
    : "";
  const fields = station.type === "yesno"
    ? yesnoItems()
    : station.type === "numbers"
      ? numbersFields()
      : station.type === "choice"
        ? choiceFields()
        : numberFields();
  document.title = `${station.title} · QR пътека`;
  app.innerHTML = `
    <p class="eyebrow">Станция ${index + 1} от ${stations.length}</p>
    <h1>${escapeHtml(station.title)}</h1>
    <p class="saved">Играе <strong>${escapeHtml(getName())}</strong> · <button type="button" class="linkish" id="rename">Друго име</button></p>
    ${savedLine}
    <form class="task" id="task-form">
      ${fields}
      <p class="feedback" id="feedback" hidden></p>
      <p class="hint-box" id="hint-box" hidden></p>
      <p class="row-actions">
        <button type="submit" class="btn btn-primary" id="submit">Провери</button>
        <button type="button" class="btn btn-ghost" id="hint" hidden>Подсказка</button>
      </p>
    </form>`;
  bindForm();
  document.querySelector("#rename").addEventListener("click", paintName);
}

function paintName() {
  app.innerHTML = `
    <p class="eyebrow">${escapeHtml(trail.className)} · ${escapeHtml(trail.title)}</p>
    <h1>Как се казваш?</h1>
    <p class="lead">Името се появява в класацията на ${escapeHtml(trail.className)}.</p>
    <form class="task form-grid" id="name-form">
      <label for="student-name">Име</label>
      <input id="student-name" type="text" maxlength="40" required value="${escapeHtml(getName())}">
      <button class="btn btn-primary" type="submit">Към задачата</button>
    </form>`;
  document.querySelector("#name-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.querySelector("#student-name").value.trim();
    if (!name) return;
    setName(name);
    paint();
  });
}

async function init() {
  try {
    const state = await getBoard();
    const requested = params.get("trail");
    trail = requested
      ? state.trails.find((item) => item.id === requested) || null
      : state.trails[0] || null;
    if (!trail) {
      app.innerHTML = `<h1>${requested ? "Това трасе вече го няма" : "Няма трасе"}</h1>`;
      return;
    }
    stations = trail.stations || [];
    station = stations.find((item) => item.id === params.get("station")) || null;
    if (!station) {
      app.innerHTML = `<h1>Тази станция вече я няма</h1><p>Попитай учителя. Този код вече не отваря задача.</p>`;
      return;
    }
    if (!getName()) paintName();
    else paint();
  } catch {
    app.innerHTML = `<h1>Няма връзка със сървъра</h1><p>Отвори https://qr-pateka.thevibehosting.com/.</p>`;
  }
}

init();
