# The same game server as start.ps1, for a host that stays on the internet.
import json
import os
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
STORE_PATH = DATA / "store.json"
SEED_PATH = DATA / "seed.json"
PASSWORD_PATH = DATA / "teacher-password.txt"
LOCK = threading.Lock()
TOKENS = set()
LETTERS = list("abcdefgh")

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
}


def prop(obj, name):
    if isinstance(obj, dict):
        return obj.get(name)
    return None


def clean_text(value, max_len, min_len=1):
    if not isinstance(value, str):
        return None
    text = value.strip()
    if len(text) < min_len or len(text) > max_len or "<" in text or ">" in text:
        return None
    return text


def to_float(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    text = value.strip().replace(" ", "")
    if "," in text and "." not in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def nearly(a, b):
    return abs(float(a) - float(b)) < 0.001


def new_id(prefix):
    return f"{prefix}-{int(time.time() * 1000)}-{secrets.randbelow(900) + 100}"


def read_store():
    if not STORE_PATH.exists():
        DATA.mkdir(parents=True, exist_ok=True)
        STORE_PATH.write_bytes(SEED_PATH.read_bytes())
    store = json.loads(STORE_PATH.read_text(encoding="utf-8-sig"))
    if not isinstance(store, dict):
        store = {}
    if not isinstance(store.get("trails"), list):
        store["trails"] = []
    if not isinstance(store.get("results"), list):
        store["results"] = []
    return store


def write_store(store):
    DATA.mkdir(parents=True, exist_ok=True)
    text = json.dumps(store, ensure_ascii=False, separators=(",", ":"))
    STORE_PATH.write_text(text, encoding="utf-8")


def teacher_password():
    if PASSWORD_PATH.exists():
        saved = PASSWORD_PATH.read_text(encoding="utf-8-sig").strip()
        if 4 <= len(saved) <= 40 and "<" not in saved and ">" not in saved:
            return saved
    code = f"{secrets.randbelow(900000) + 100000}"
    DATA.mkdir(parents=True, exist_ok=True)
    PASSWORD_PATH.write_text(code, encoding="utf-8")
    return code


def clean_station(raw, keep_id=None):
    if not isinstance(raw, dict):
        return None
    kind = str(prop(raw, "type") or "")
    if kind not in ("yesno", "numbers", "choice"):
        return None
    title = clean_text(prop(raw, "title"), 80)
    teaser = clean_text(prop(raw, "teaser"), 160)
    print_prompt = clean_text(prop(raw, "printPrompt"), 400)
    hint = clean_text(prop(raw, "hint"), 400)
    success = clean_text(prop(raw, "success"), 500)
    if not all((title, teaser, print_prompt, hint, success)):
        return None
    station = {
        "id": keep_id or new_id("st"),
        "title": title,
        "teaser": teaser,
        "printPrompt": print_prompt,
        "hint": hint,
        "success": success,
        "type": kind,
    }
    story = prop(raw, "story")
    if isinstance(story, str) and story.strip():
        clean_story = clean_text(story, 500)
        if not clean_story:
            return None
        station["story"] = clean_story
    if kind in ("yesno", "numbers"):
        items = prop(raw, "items")
        if not isinstance(items, list) or not 1 <= len(items) <= 8:
            return None
        clean = []
        for index, item in enumerate(items):
            expr = clean_text(prop(item, "expr"), 240)
            if not expr:
                return None
            if kind == "yesno":
                answer = prop(item, "answer")
                if not isinstance(answer, bool):
                    return None
                clean.append({"id": LETTERS[index], "expr": expr, "answer": answer})
            else:
                name = clean_text(prop(item, "name"), 20)
                number = to_float(prop(item, "answer"))
                if name is None or number is None:
                    return None
                clean.append({"id": LETTERS[index], "expr": expr, "name": name, "answer": number})
        station["items"] = clean
    else:
        shown = clean_text(prop(raw, "shown"), 240)
        wrong = clean_text(prop(raw, "wrong"), 300)
        choices = prop(raw, "choices")
        if not shown or not wrong or not isinstance(choices, list) or not 2 <= len(choices) <= 4:
            return None
        clean = []
        correct_count = 0
        for index, choice in enumerate(choices):
            text = clean_text(prop(choice, "text"), 240)
            correct = prop(choice, "correct")
            if not text or not isinstance(correct, bool):
                return None
            if correct:
                correct_count += 1
            clean.append({"id": LETTERS[index], "text": text, "correct": correct})
        if correct_count != 1:
            return None
        station["shown"] = shown
        station["wrong"] = wrong
        station["choices"] = clean
    return station


def public_station(station):
    kind = str(prop(station, "type") or "")
    public = {
        "id": str(prop(station, "id") or ""),
        "title": str(prop(station, "title") or ""),
        "teaser": str(prop(station, "teaser") or ""),
        "hint": str(prop(station, "hint") or ""),
        "type": kind,
    }
    story = prop(station, "story")
    if isinstance(story, str) and story:
        public["story"] = story
    if kind in ("yesno", "numbers"):
        items = []
        for item in prop(station, "items") or []:
            row = {"id": str(prop(item, "id") or ""), "expr": str(prop(item, "expr") or "")}
            if kind == "numbers":
                row["name"] = str(prop(item, "name") or "")
            items.append(row)
        public["items"] = items
    elif kind == "choice":
        public["shown"] = str(prop(station, "shown") or "")
        public["wrong"] = str(prop(station, "wrong") or "")
        public["choices"] = [
            {"id": str(prop(choice, "id") or ""), "text": str(prop(choice, "text") or "")}
            for choice in (prop(station, "choices") or [])
        ]
    elif kind == "number":
        public["prompt"] = str(prop(station, "prompt") or "")
    return public


def public_board(store):
    trails = []
    for trail in store.get("trails") or []:
        trails.append({
            "id": str(prop(trail, "id") or ""),
            "title": str(prop(trail, "title") or ""),
            "className": str(prop(trail, "className") or ""),
            "stations": [public_station(station) for station in (prop(trail, "stations") or [])],
        })
    return {"trails": trails}


def wrong_ids(station, answers):
    ids = []
    kind = str(prop(station, "type") or "")
    answers = answers if isinstance(answers, dict) else {}
    if kind in ("yesno", "numbers"):
        for item in prop(station, "items") or []:
            item_id = str(prop(item, "id") or "")
            given = answers.get(item_id)
            if kind == "yesno":
                ok = isinstance(given, bool) and given == bool(prop(item, "answer"))
            else:
                number = to_float(given)
                expected = to_float(prop(item, "answer"))
                ok = number is not None and expected is not None and nearly(number, expected)
            if not ok:
                ids.append(item_id)
    elif kind == "choice":
        picked = str(answers.get("choice") or "")
        ok = False
        for choice in prop(station, "choices") or []:
            if str(prop(choice, "id") or "") == picked and bool(prop(choice, "correct")):
                ok = True
        if not ok:
            ids.append("choice")
    elif kind == "number":
        given = to_float(answers.get("value"))
        expected = to_float(prop(station, "answer"))
        if given is None or expected is None or not nearly(given, expected):
            ids.append("value")
    else:
        ids.append("station")
    return ids


def score_for(attempts, hint_used):
    if hint_used or attempts >= 3:
        return 30
    if attempts <= 1:
        return 100
    return 60


def find_trail(store, trail_id):
    for trail in store.get("trails") or []:
        if str(prop(trail, "id") or "") == trail_id:
            return trail
    return None


def find_station(trail, station_id):
    for station in prop(trail, "stations") or []:
        if str(prop(station, "id") or "") == station_id:
            return station
    return None


def teacher_ok(header):
    match = re.search(r"(?im)^X-Teacher-Token:\s*(\S+)", header or "")
    return bool(match and match.group(1) in TOKENS)


class GameHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("%s %s" % (self.command, self.path.split("?", 1)[0]))

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, status, content_type, body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 1_000_000:
            return None
        text = self.rfile.read(length).decode("utf-8").strip("\x00").strip()
        if not text:
            return None
        return json.loads(text)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = unquote(self.path.split("?", 1)[0])
        if path == "/api/board":
            with LOCK:
                self.send_json(200, public_board(read_store()))
            return
        if path == "/api/state":
            if not teacher_ok(str(self.headers)):
                self.send_json(401, {"error": "Нужен е кодът на учителя."})
                return
            with LOCK:
                self.send_json(200, read_store())
            return
        if path.startswith("/api/"):
            self.send_json(404, {"error": "Няма такъв адрес."})
            return
        self.serve_file(path)

    def do_POST(self):
        path = unquote(self.path.split("?", 1)[0])
        if not path.startswith("/api/"):
            self.send_bytes(404, "text/plain; charset=utf-8", "Not found".encode("utf-8"))
            return
        try:
            payload = self.read_json()
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Празна заявка."})
            return
        if payload is None:
            self.send_json(400, {"error": "Празна заявка."})
            return
        self.handle_post(path, payload)

    def handle_post(self, path, payload):
        header = str(self.headers)
        if path == "/api/login":
            password = prop(payload, "password")
            if not isinstance(password, str):
                password = ""
            if password.strip() != teacher_password():
                self.send_json(401, {"error": "Кодът не е верен."})
                return
            token = secrets.token_hex(24)
            TOKENS.add(token)
            self.send_json(200, {"token": token})
            return
        if path == "/api/password":
            if not teacher_ok(header):
                self.send_json(401, {"error": "Нужен е кодът на учителя."})
                return
            old = prop(payload, "oldPassword")
            if not isinstance(old, str):
                old = ""
            if old.strip() != teacher_password():
                self.send_json(400, {"error": "Старият код не е верен."})
                return
            nxt = clean_text(prop(payload, "password"), 40, 4)
            if not nxt:
                self.send_json(400, {"error": "Новият код трябва да е от 4 до 40 знака, без < и >."})
                return
            PASSWORD_PATH.write_text(nxt, encoding="utf-8")
            self.send_json(200, {"ok": True})
            return
        guarded = {
            "/api/trails", "/api/trails/update", "/api/trails/delete",
            "/api/stations", "/api/stations/update", "/api/stations/delete", "/api/stations/move",
        }
        if path in guarded and not teacher_ok(header):
            self.send_json(401, {"error": "Нужен е кодът на учителя."})
            return
        with LOCK:
            store = read_store()
            if path == "/api/trails":
                self.create_trail(store, payload)
            elif path == "/api/trails/update":
                self.update_trail(store, payload)
            elif path == "/api/trails/delete":
                self.delete_trail(store, payload)
            elif path == "/api/stations":
                self.create_station(store, payload)
            elif path in ("/api/stations/update", "/api/stations/delete", "/api/stations/move"):
                self.change_station(store, path, payload)
            elif path == "/api/results":
                self.save_result(store, payload)
            else:
                self.send_json(404, {"error": "Няма такъв адрес."})

    def create_trail(self, store, payload):
        title = clean_text(prop(payload, "title"), 80)
        class_name = clean_text(prop(payload, "className"), 60)
        if not title or not class_name:
            self.send_json(400, {"error": "Попълни име на трасето и клас."})
            return
        trails = list(store.get("trails") or [])
        if len(trails) >= 40:
            self.send_json(400, {"error": "Твърде много трасета."})
            return
        trail = {"id": new_id("trail"), "title": title, "className": class_name, "stations": []}
        trails.append(trail)
        store["trails"] = trails
        write_store(store)
        self.send_json(200, trail)

    def update_trail(self, store, payload):
        title = clean_text(prop(payload, "title"), 80)
        class_name = clean_text(prop(payload, "className"), 60)
        trail = find_trail(store, str(prop(payload, "id") or ""))
        if not trail:
            self.send_json(404, {"error": "Няма такова трасе."})
            return
        if not title or not class_name:
            self.send_json(400, {"error": "Попълни име на трасето и клас."})
            return
        trail["title"] = title
        trail["className"] = class_name
        write_store(store)
        self.send_json(200, trail)

    def delete_trail(self, store, payload):
        trail_id = str(prop(payload, "id") or "")
        trails = list(store.get("trails") or [])
        kept = [trail for trail in trails if str(prop(trail, "id") or "") != trail_id]
        if len(kept) == len(trails):
            self.send_json(404, {"error": "Няма такова трасе."})
            return
        store["trails"] = kept
        store["results"] = [
            row for row in (store.get("results") or [])
            if str(prop(row, "trailId") or "") != trail_id
        ]
        write_store(store)
        self.send_json(200, {"ok": True})

    def create_station(self, store, payload):
        trail = find_trail(store, str(prop(payload, "trailId") or ""))
        if not trail:
            self.send_json(404, {"error": "Няма такова трасе."})
            return
        stations = list(prop(trail, "stations") or [])
        if len(stations) >= 30:
            self.send_json(400, {"error": "Трасето има твърде много станции."})
            return
        station = clean_station(prop(payload, "station"))
        if not station:
            self.send_json(400, {"error": "Станцията не е попълнена докрай."})
            return
        stations.append(station)
        trail["stations"] = stations
        write_store(store)
        self.send_json(200, station)

    def change_station(self, store, path, payload):
        trail = find_trail(store, str(prop(payload, "trailId") or ""))
        if not trail:
            self.send_json(404, {"error": "Няма такова трасе."})
            return
        station_id = str(prop(payload, "stationId") or "")
        stations = list(prop(trail, "stations") or [])
        index = next((i for i, item in enumerate(stations) if str(prop(item, "id") or "") == station_id), -1)
        if index < 0:
            self.send_json(404, {"error": "Няма такава станция."})
            return
        if path == "/api/stations/update":
            station = clean_station(prop(payload, "station"), station_id)
            if not station:
                self.send_json(400, {"error": "Станцията не е попълнена докрай."})
                return
            stations[index] = station
            trail["stations"] = stations
            write_store(store)
            self.send_json(200, station)
            return
        if path == "/api/stations/delete":
            trail["stations"] = [item for item in stations if str(prop(item, "id") or "") != station_id]
            trail_id = str(prop(trail, "id") or "")
            store["results"] = [
                row for row in (store.get("results") or [])
                if not (str(prop(row, "trailId") or "") == trail_id and str(prop(row, "stationId") or "") == station_id)
            ]
            write_store(store)
            self.send_json(200, {"ok": True})
            return
        direction = str(prop(payload, "direction") or "")
        delta = -1 if direction == "up" else 1 if direction == "down" else 0
        target = index + delta
        if delta == 0 or target < 0 or target >= len(stations):
            self.send_json(400, {"error": "Станцията не може да се премести."})
            return
        stations[index], stations[target] = stations[target], stations[index]
        trail["stations"] = stations
        write_store(store)
        self.send_json(200, {"ok": True})

    def save_result(self, store, payload):
        name = clean_text(prop(payload, "name"), 40)
        trail = find_trail(store, str(prop(payload, "trailId") or ""))
        station = find_station(trail, str(prop(payload, "stationId") or "")) if trail else None
        attempts_value = prop(payload, "attempts")
        hint_used = prop(payload, "hintUsed")
        attempts_ok = isinstance(attempts_value, int) and not isinstance(attempts_value, bool)
        if not name or not station or not isinstance(hint_used, bool) or not attempts_ok:
            self.send_json(400, {"error": "Липсват име или отговори."})
            return
        if attempts_value < 1 or attempts_value > 20:
            self.send_json(400, {"error": "Невалиден опит."})
            return
        wrong = wrong_ids(station, prop(payload, "answers"))
        if wrong:
            self.send_json(400, {"error": "Отговорите не се приемат.", "wrong": wrong})
            return
        points = score_for(attempts_value, hint_used)
        stars = 3 if points >= 100 else 2 if points >= 60 else 1
        name_key = name.lower()
        results = list(store.get("results") or [])
        kept = None
        for row in results:
            if (str(prop(row, "trailId") or "") == str(prop(trail, "id") or "")
                    and str(prop(row, "stationId") or "") == str(prop(station, "id") or "")
                    and str(prop(row, "nameKey") or "") == name_key):
                kept = row
                break
        if kept:
            old_stars = int(prop(kept, "stars") or 0)
            old_points = int(prop(kept, "points") or 0)
            if stars > old_stars or (stars == old_stars and points > old_points):
                kept["stars"] = stars
                kept["points"] = points
                kept["name"] = name
        else:
            results.append({
                "trailId": str(prop(trail, "id") or ""),
                "stationId": str(prop(station, "id") or ""),
                "name": name,
                "nameKey": name_key,
                "stars": stars,
                "points": points,
            })
        store["results"] = results
        write_store(store)
        self.send_json(200, {
            "ok": True,
            "stars": stars,
            "points": points,
            "success": str(prop(station, "success") or ""),
        })

    def serve_file(self, path):
        if path in ("", "/"):
            path = "/index.html"
        if path == "/favicon.ico":
            self.send_bytes(204, "image/x-icon", b"")
            return
        if ".." in path or "\\" in path or path.startswith("/data/"):
            self.send_bytes(400, "text/plain; charset=utf-8", b"Bad path")
            return
        candidate = (ROOT / path.lstrip("/")).resolve()
        if ROOT not in candidate.parents and candidate != ROOT:
            self.send_bytes(400, "text/plain; charset=utf-8", b"Bad path")
            return
        if not candidate.is_file():
            self.send_bytes(404, "text/plain; charset=utf-8", "Страницата липсва.".encode("utf-8"))
            return
        body = candidate.read_bytes()
        self.send_bytes(200, TYPES.get(candidate.suffix.lower(), "application/octet-stream"), body)


def main():
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), GameHandler)
    print(f"QR пътека слуша на порт {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
