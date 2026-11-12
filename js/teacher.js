import { getState, login, postJson, setTeacherToken } from "./api.js";
import { classRanking } from "./game.js";

const qrcodeApi = window.qrcode;
if (qrcodeApi.stringToBytesFuncs && qrcodeApi.stringToBytesFuncs["UTF-8"]) {
  qrcodeApi.stringToBytes = qrcodeApi.stringToBytesFuncs["UTF-8"];
}

const editor = document.querySelector("#editor");
const sheet = document.querySelector("#sheet");
const printHead = document.querySelector("#print-head");
let state = { trails: [], results: [] };
let signedIn = false;
let stationType = "yesno";
let rows = [];
let shownTrail = "";
let editingId = "";
let pendingDelete = "";
let draft = emptyDraft();

function emptyDraft() {
  return { title: "", teaser: "", printPrompt: "", hint: "", success: "", story: "", shown: "", wrong: "" };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function trailIdFromHash() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return hash.get("trail") || "";
}

function qrDataUrl(text) {
  const qr = qrcodeApi(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(5);
}

function stationUrl(trail, station) {
  const url = new URL("play.html", window.location.href);
  url.search = `?trail=${encodeURIComponent(trail.id)}&station=${encodeURIComponent(station.id)}`;
  return url.href;
}

function hostNote() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return `<p class="host-note">Този адрес е само за този компютър. Постоянният адрес за всеки компютър и всеки телефон е https://qr-pateka.thevibehosting.com/. Печатай QR от него.</p>`;
  }
  return "";
}

function blankRows(type) {
  if (type === "choice") {
    return [
      { text: "", correct: true },
      { text: "", correct: false },
      { text: "", correct: false }
    ];
  }
  if (type === "numbers") return [{ expr: "", name: "x", answer: "" }];
  return [{ expr: "", answer: "yes" }];
}

function rankingTable(trail) {
  const rowsRanked = classRanking(state.trails, state.results, trail.className);
  if (!rowsRanked.length) {
    return `<p class="saved">Все още няма решени станции за ${escapeHtml(trail.className)}.</p>`;
  }
  const body = rowsRanked.map((person, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(person.name)}</td>
      <td>${person.stars}</td>
      <td>${person.points}</td>
      <td>${person.stations}</td>
    </tr>`).join("");
  return `
    <table class="rank-table">
      <thead>
        <tr><th>Място</th><th>Име</th><th>Звезди</th><th>Точки</th><th>Станции</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderSheet(trail) {
  printHead.innerHTML = `
    <h1>${escapeHtml(trail.title)} · ${escapeHtml(trail.className)}</h1>
    <p>Напиши си името, после реши задачата. Не пиши отговора върху листа.</p>`;
  sheet.innerHTML = trail.stations.map((station, index) => `
    <article class="qr-card">
      <div>
        <p class="station-no">Станция ${index + 1}</p>
        <h2>${escapeHtml(station.title)}</h2>
        <p>${escapeHtml(station.printPrompt)}</p>
      </div>
      <img src="${qrDataUrl(stationUrl(trail, station))}" alt="QR код за станция ${index + 1}">
    </article>`).join("");
}

function rowFields() {
  if (stationType === "yesno") {
    return rows.map((row, index) => `
      <div class="row-line">
        <input data-row="${index}" data-field="expr" type="text" value="${escapeHtml(row.expr)}" placeholder="Запис">
        <select data-row="${index}" data-field="answer">
          <option value="yes" ${row.answer === "yes" ? "selected" : ""}>ДА</option>
          <option value="no" ${row.answer === "no" ? "selected" : ""}>НЕ</option>
        </select>
      </div>`).join("");
  }
  if (stationType === "numbers") {
    return rows.map((row, index) => `
      <div class="row-line">
        <input data-row="${index}" data-field="expr" type="text" value="${escapeHtml(row.expr)}" placeholder="Уравнение или въпрос">
        <input data-row="${index}" data-field="name" type="text" value="${escapeHtml(row.name)}" placeholder="буква">
        <input data-row="${index}" data-field="answer" type="text" value="${escapeHtml(row.answer)}" placeholder="отговор">
      </div>`).join("");
  }
  return rows.map((row, index) => `
    <div class="row-line">
      <input data-row="${index}" data-field="text" type="text" value="${escapeHtml(row.text)}" placeholder="Отговор ${index + 1}">
      <label class="check-label"><input data-row="${index}" data-field="correct" type="radio" name="correct-choice" ${row.correct ? "checked" : ""}> верен</label>
    </div>`).join("");
}

function readDraft() {
  const value = (id) => document.querySelector(id)?.value ?? null;
  if (value("#station-title") == null) return;
  draft = {
    title: value("#station-title"),
    teaser: value("#teaser"),
    printPrompt: value("#print-prompt"),
    hint: value("#hint"),
    success: value("#success"),
    story: value("#story") || "",
    shown: value("#shown") || "",
    wrong: value("#wrong") || ""
  };
}

function readRows() {
  document.querySelectorAll("[data-row]").forEach((field) => {
    const index = Number(field.dataset.row);
    const key = field.dataset.field;
    if (!rows[index]) return;
    if (field.type === "radio") {
      if (field.checked) rows.forEach((row, rowIndex) => { row.correct = rowIndex === index; });
      return;
    }
    rows[index][key] = field.value;
  });
}

function stationForm(trail) {
  const choiceExtra = stationType === "choice" ? `
    <label for="shown">Даден запис</label>
    <input id="shown" type="text" value="${escapeHtml(draft.shown)}">
    <label for="wrong">Чуждо решение</label>
    <input id="wrong" type="text" value="${escapeHtml(draft.wrong)}">` : `
    <label for="story">Условие, ако има текст</label>
    <textarea id="story">${escapeHtml(draft.story)}</textarea>`;
  return `
    <form class="task form-grid" id="station-form">
      <h2>${editingId ? "Редакция на станцията" : "Нова станция"}</h2>
      <label for="station-title">Заглавие</label>
      <input id="station-title" type="text" maxlength="80" required value="${escapeHtml(draft.title)}">
      <label for="teaser">Кратко за ученика</label>
      <input id="teaser" type="text" maxlength="160" required value="${escapeHtml(draft.teaser)}">
      <label for="print-prompt">Текст на листа, без отговор</label>
      <textarea id="print-prompt" required>${escapeHtml(draft.printPrompt)}</textarea>
      <label for="hint">Подсказка</label>
      <textarea id="hint" required>${escapeHtml(draft.hint)}</textarea>
      <label for="success">Обяснение след верен отговор</label>
      <textarea id="success" required>${escapeHtml(draft.success)}</textarea>
      <label for="station-type">Вид</label>
      <select id="station-type">
        <option value="yesno" ${stationType === "yesno" ? "selected" : ""}>ДА / НЕ</option>
        <option value="numbers" ${stationType === "numbers" ? "selected" : ""}>Числа</option>
        <option value="choice" ${stationType === "choice" ? "selected" : ""}>Избор</option>
      </select>
      ${choiceExtra}
      <div class="form-grid" id="rows">${rowFields()}</div>
      <p class="row-actions">
        <button type="button" class="btn btn-ghost" id="add-row">Още ред</button>
        <button type="submit" class="btn btn-primary">${editingId ? "Запази" : "Добави станцията"}</button>
        ${editingId ? `<button type="button" class="btn btn-ghost" id="cancel-edit">Отказ</button>` : ""}
      </p>
      <p class="feedback" id="form-error" hidden></p>
    </form>`;
}

function stationList(trail) {
  if (!trail.stations.length) return `<p class="saved">Още няма станция.</p>`;
  return trail.stations.map((station, index) => {
    const last = index === trail.stations.length - 1;
    const confirm = pendingDelete === station.id
      ? `<p class="saved">Кодът към тази станция вече няма да отваря задача. Останалите кодове остават.</p>
         <p class="row-actions"><button type="button" class="btn btn-danger" data-del-yes="${escapeHtml(station.id)}">Изтрий</button></p>`
      : "";
    return `
      <div class="station-row">
        <span>${index + 1}. ${escapeHtml(station.title)}</span>
        <button type="button" class="btn btn-ghost" data-edit="${escapeHtml(station.id)}">Редактирай</button>
        <button type="button" class="btn btn-ghost" data-up="${escapeHtml(station.id)}" ${index === 0 ? "disabled" : ""}>Нагоре</button>
        <button type="button" class="btn btn-ghost" data-down="${escapeHtml(station.id)}" ${last ? "disabled" : ""}>Надолу</button>
        <button type="button" class="btn btn-ghost" data-del="${escapeHtml(station.id)}">Изтрий</button>
      </div>
      ${confirm}`;
  }).join("");
}

function fillFromStation(station) {
  editingId = station.id;
  pendingDelete = "";
  stationType = station.type;
  draft = {
    title: station.title || "",
    teaser: station.teaser || "",
    printPrompt: station.printPrompt || "",
    hint: station.hint || "",
    success: station.success || "",
    story: station.story || "",
    shown: station.shown || "",
    wrong: station.wrong || ""
  };
  if (station.type === "yesno") {
    rows = station.items.map((item) => ({ expr: item.expr, answer: item.answer ? "yes" : "no" }));
  } else if (station.type === "numbers") {
    rows = station.items.map((item) => ({
      expr: item.expr,
      name: item.name,
      answer: String(item.answer).replace(".", ",")
    }));
  } else {
    rows = station.choices.map((choice) => ({ text: choice.text, correct: Boolean(choice.correct) }));
  }
}

function renderList() {
  sheet.innerHTML = "";
  printHead.innerHTML = "";
  const cards = state.trails.map((trail) => `
    <a class="card trail-card" href="#trail=${encodeURIComponent(trail.id)}">
      <h2>${escapeHtml(trail.title)}</h2>
      <p>${escapeHtml(trail.className)} · ${trail.stations.length} станции</p>
    </a>`).join("");
  editor.innerHTML = `
    <p class="eyebrow">Учител</p>
    <h1>Трасета</h1>
    <p class="lead">Всяко трасе е за един клас. В него добавяш станциите, печаташ кодовете и виждаш класацията.</p>
    ${hostNote()}
    <div class="trail-list">${cards || `<p class="saved">Още няма трасе.</p>`}</div>
    <form class="task form-grid" id="trail-form">
      <h2>Ново трасе</h2>
      <label for="trail-title">Име на трасето</label>
      <input id="trail-title" type="text" maxlength="80" required placeholder="Например: Дроби">
      <label for="class-name">Клас</label>
      <input id="class-name" type="text" maxlength="60" required placeholder="Например: 5А">
      <button class="btn btn-primary" type="submit">Създай трасе</button>
    </form>`;
  document.querySelector("#trail-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const trail = await postJson("/api/trails", {
        title: document.querySelector("#trail-title").value,
        className: document.querySelector("#class-name").value
      }, true);
      location.hash = `trail=${encodeURIComponent(trail.id)}`;
      await load();
    } catch (err) {
      if (err.status === 401) renderLogin();
    }
  });
}

function updateMenu() {
  document.querySelector("#menu-code").hidden = !signedIn;
  document.querySelector("#menu-ranking").hidden = !signedIn;
  document.querySelector("#menu-logout").hidden = !signedIn;
}

function closeMenu() {
  document.querySelector("#menu-panel").hidden = true;
  document.querySelector("#menu-button").setAttribute("aria-expanded", "false");
}

function renderLogin() {
  signedIn = false;
  updateMenu();
  sheet.innerHTML = "";
  printHead.innerHTML = "";
  editor.innerHTML = `
    <p class="eyebrow">Учител</p>
    <h1>Код за учителя</h1>
    <form class="task form-grid" id="login-form">
      <label for="teacher-code">Код</label>
      <input id="teacher-code" type="password" autocomplete="current-password" required>
      <button class="btn btn-primary" type="submit">Вход</button>
      <p class="feedback error" id="login-error" hidden></p>
    </form>`;
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#login-error");
    try {
      await login(document.querySelector("#teacher-code").value);
      await load();
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message === "request" ? "Кодът не е верен." : err.message;
    }
  });
}

function renderCode() {
  sheet.innerHTML = "";
  printHead.innerHTML = "";
  editor.innerHTML = `
    <p class="row-actions"><a class="btn btn-ghost" href="#">Трасета</a></p>
    <h1>Нов код</h1>
    <form class="task form-grid" id="code-form">
      <label for="old-code">Стар код</label>
      <input id="old-code" type="password" autocomplete="current-password" required>
      <label for="new-code">Нов код</label>
      <input id="new-code" type="password" minlength="4" maxlength="40" autocomplete="new-password" required>
      <label for="confirm-code">Потвърди новия код</label>
      <input id="confirm-code" type="password" minlength="4" maxlength="40" autocomplete="new-password" required>
      <button class="btn btn-primary" type="submit">Запази</button>
      <p class="feedback" id="code-note" hidden></p>
    </form>`;
  document.querySelector("#code-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = document.querySelector("#code-note");
    const next = document.querySelector("#new-code").value.trim();
    const again = document.querySelector("#confirm-code").value.trim();
    if (next !== again) {
      note.hidden = false;
      note.className = "feedback error";
      note.textContent = "Новият код и потвърждението не съвпадат.";
      return;
    }
    try {
      await postJson("/api/password", {
        oldPassword: document.querySelector("#old-code").value.trim(),
        password: next
      }, true);
      note.hidden = false;
      note.className = "feedback ok";
      note.textContent = "Кодът е запазен.";
      document.querySelector("#code-form").reset();
    } catch (err) {
      if (err.status === 401) {
        renderLogin();
        return;
      }
      note.hidden = false;
      note.className = "feedback error";
      note.textContent = err.message === "request" ? "Кодът не е запазен." : err.message;
    }
  });
}

function renderRanking() {
  sheet.innerHTML = "";
  printHead.innerHTML = "";
  const classes = [];
  state.trails.forEach((trail) => {
    const key = trail.className.trim().toLocaleLowerCase("bg");
    if (!classes.some((item) => item.key === key)) classes.push({ key, name: trail.className });
  });
  const blocks = classes.map((item) => `
    <section class="task">
      <h2>${escapeHtml(item.name)}</h2>
      ${rankingTable({ className: item.name })}
    </section>`).join("");
  editor.innerHTML = `
    <p class="row-actions"><a class="btn btn-ghost" href="#">Трасета</a></p>
    <h1>Класация</h1>
    ${blocks || `<p class="saved">Още няма трасе.</p>`}`;
}

function renderTrail(trail) {
  renderSheet(trail);
  editor.innerHTML = `
    <p class="row-actions"><a class="btn btn-ghost" href="#">Всички трасета</a></p>
    <p class="eyebrow">${escapeHtml(trail.className)}</p>
    <h1>${escapeHtml(trail.title)}</h1>
    ${hostNote()}
    <p class="row-actions">
      <button type="button" class="btn btn-primary" id="print">Печат на станциите</button>
      <a class="btn btn-secondary" href="map.html?trail=${encodeURIComponent(trail.id)}">Пътека на ученика</a>
    </p>
    <form class="task form-grid" id="trail-edit">
      <h2>Трасето</h2>
      <label for="edit-title">Име</label>
      <input id="edit-title" type="text" maxlength="80" required value="${escapeHtml(trail.title)}">
      <label for="edit-class">Клас</label>
      <input id="edit-class" type="text" maxlength="60" required value="${escapeHtml(trail.className)}">
      <p class="saved">Отпечатаните кодове остават същите, докато трасето не се изтрие.</p>
      <p class="row-actions">
        <button class="btn btn-secondary" type="submit">Запази</button>
        <button class="btn btn-ghost" type="button" id="delete-trail">Изтрий трасето</button>
      </p>
      <p class="feedback" id="trail-note" hidden></p>
      <div id="delete-box" hidden>
        <p>Станциите и резултатите на това трасе се махат.</p>
        <button class="btn btn-danger" type="button" id="delete-yes">Изтрий</button>
      </div>
    </form>
    <section class="task">
      <h2>Класиране за ${escapeHtml(trail.className)}</h2>
      <p class="saved">Звездите се събират от всички трасета на този клас.</p>
      ${rankingTable(trail)}
    </section>
    <section class="task">
      <h2>Станции</h2>
      ${stationList(trail)}
    </section>
    ${stationForm(trail)}`;
  document.querySelector("#print").addEventListener("click", () => window.print());
  document.querySelector("#trail-edit").addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = document.querySelector("#trail-note");
    try {
      await postJson("/api/trails/update", {
        id: trail.id,
        title: document.querySelector("#edit-title").value,
        className: document.querySelector("#edit-class").value
      }, true);
      await load();
    } catch (err) {
      if (err.status === 401) {
        renderLogin();
        return;
      }
      note.hidden = false;
      note.className = "feedback error";
      note.textContent = err.message === "request" ? "Трасето не е запазено." : err.message;
    }
  });
  document.querySelector("#delete-trail").addEventListener("click", () => {
    document.querySelector("#delete-box").hidden = false;
  });
  document.querySelector("#delete-yes").addEventListener("click", async () => {
    try {
      await postJson("/api/trails/delete", { id: trail.id }, true);
      location.hash = "";
      await load();
    } catch (err) {
      if (err.status === 401) {
        renderLogin();
        return;
      }
      const note = document.querySelector("#trail-note");
      note.hidden = false;
      note.className = "feedback error";
      note.textContent = err.message === "request" ? "Трасето не е изтрито." : err.message;
    }
  });
  document.querySelector("#station-type").addEventListener("change", (event) => {
    readDraft();
    readRows();
    stationType = event.target.value;
    rows = blankRows(stationType);
    renderTrail(trail);
  });
  document.querySelector("#add-row").addEventListener("click", () => {
    readDraft();
    readRows();
    if (rows.length >= 8) return;
    if (stationType === "choice") rows.push({ text: "", correct: false });
    else if (stationType === "numbers") rows.push({ expr: "", name: "x", answer: "" });
    else rows.push({ expr: "", answer: "yes" });
    renderTrail(trail);
  });
  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const station = trail.stations.find((item) => item.id === button.dataset.edit);
      if (!station) return;
      fillFromStation(station);
      renderTrail(trail);
      document.querySelector("#station-form")?.scrollIntoView({ block: "start" });
    });
  });
  document.querySelectorAll("[data-up], [data-down]").forEach((button) => {
    button.addEventListener("click", async () => {
      const stationId = button.dataset.up || button.dataset.down;
      const direction = button.dataset.up ? "up" : "down";
      try {
        await postJson("/api/stations/move", { trailId: trail.id, stationId, direction }, true);
        await load();
      } catch (err) {
        if (err.status === 401) renderLogin();
      }
    });
  });
  document.querySelectorAll("[data-del]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingDelete = button.dataset.del;
      renderTrail(trail);
    });
  });
  document.querySelectorAll("[data-del-yes]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await postJson("/api/stations/delete", { trailId: trail.id, stationId: button.dataset.delYes }, true);
        if (editingId === button.dataset.delYes) {
          editingId = "";
          draft = emptyDraft();
          rows = blankRows(stationType);
        }
        pendingDelete = "";
        await load();
      } catch (err) {
        if (err.status === 401) renderLogin();
      }
    });
  });
  const cancelEdit = document.querySelector("#cancel-edit");
  if (cancelEdit) {
    cancelEdit.addEventListener("click", () => {
      editingId = "";
      draft = emptyDraft();
      rows = blankRows(stationType);
      renderTrail(trail);
    });
  }
  document.querySelector("#station-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    readRows();
    const error = document.querySelector("#form-error");
    try {
      const path = editingId ? "/api/stations/update" : "/api/stations";
      const body = { trailId: trail.id, station: collectStation() };
      if (editingId) body.stationId = editingId;
      await postJson(path, body, true);
      editingId = "";
      pendingDelete = "";
      draft = emptyDraft();
      rows = blankRows(stationType);
      await load();
    } catch (err) {
      if (err.status === 401) {
        renderLogin();
        return;
      }
      error.hidden = false;
      error.className = "feedback error";
      error.textContent = err.message === "request" ? "Станцията не е попълнена докрай." : err.message;
    }
  });
}

function collectStation() {
  const station = {
    title: document.querySelector("#station-title").value,
    teaser: document.querySelector("#teaser").value,
    printPrompt: document.querySelector("#print-prompt").value,
    hint: document.querySelector("#hint").value,
    success: document.querySelector("#success").value,
    type: stationType
  };
  const story = document.querySelector("#story");
  if (story) station.story = story.value;
  if (stationType === "yesno") {
    station.items = rows.map((row) => ({ expr: row.expr, answer: row.answer === "yes" }));
  } else if (stationType === "numbers") {
    station.items = rows.map((row) => ({
      expr: row.expr,
      name: row.name,
      answer: Number(String(row.answer).trim().replace(",", "."))
    }));
  } else {
    station.shown = document.querySelector("#shown").value;
    station.wrong = document.querySelector("#wrong").value;
    station.choices = rows.map((row) => ({ text: row.text, correct: Boolean(row.correct) }));
  }
  return station;
}

function render() {
  if (!signedIn) return;
  const hash = location.hash.replace(/^#/, "");
  if (hash === "code") {
    shownTrail = "";
    renderCode();
    return;
  }
  if (hash === "ranking") {
    shownTrail = "";
    renderRanking();
    return;
  }
  const id = trailIdFromHash();
  const trail = state.trails.find((item) => item.id === id);
  if (!trail) {
    shownTrail = "";
    renderList();
    return;
  }
  if (shownTrail !== trail.id) {
    shownTrail = trail.id;
    editingId = "";
    pendingDelete = "";
    stationType = "yesno";
    rows = blankRows(stationType);
    draft = emptyDraft();
  }
  if (!rows.length) rows = blankRows(stationType);
  renderTrail(trail);
}

async function load() {
  state = await getState();
  signedIn = true;
  updateMenu();
  render();
}

function bindMenu() {
  const button = document.querySelector("#menu-button");
  const panel = document.querySelector("#menu-panel");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!signedIn) return;
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", () => closeMenu());
  panel.addEventListener("click", (event) => event.stopPropagation());
  panel.querySelectorAll("a, button").forEach((item) => {
    item.addEventListener("click", () => closeMenu());
  });
  document.querySelector("#menu-logout").addEventListener("click", () => {
    setTeacherToken("");
    signedIn = false;
    location.hash = "";
    renderLogin();
  });
}

window.addEventListener("hashchange", render);
bindMenu();
updateMenu();
rows = blankRows(stationType);
load().catch((err) => {
  if (err.message === "login" || err.status === 401) {
    renderLogin();
    return;
  }
  editor.innerHTML = `<h1>Няма връзка със сървъра</h1><p>Отвори https://qr-pateka.thevibehosting.com/.</p>`;
});
