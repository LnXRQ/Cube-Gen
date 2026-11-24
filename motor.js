// Der Draft-Motor: dieselbe draft.py wie am PC, im Browser per Pyodide (Python als WebAssembly).
// Läuft in einem eigenen Thread, damit die Oberfläche flüssig bleibt. Zustand hält die App, nicht der Motor.
importScripts("pyodide/pyodide.js");

const PYTHON = `
import sys, types, json, random
# Auf dem Handy gibt es keine Datenbank – draft.py braucht sie nur zum Laden am PC
s = types.ModuleType("sqlite3")
class _Fehler(Exception): pass
for n in ("Error", "OperationalError", "IntegrityError", "DatabaseError", "ProgrammingError"): setattr(s, n, _Fehler)
s.Row = object; s.Connection = object
def _keine(*a, **k): raise _Fehler("keine Datenbank auf dem Handy")
s.connect = _keine
sys.modules["sqlite3"] = s
sys.path.insert(0, "/app")
from cubegen import draft, handy

def _aus(z, **extra):
    return json.dumps({"z": json.dumps(z, ensure_ascii=False), "a": draft.ansicht(z), **extra}, ensure_ascii=False)

def aufruf(op, roh):
    d = json.loads(roh)
    if op == "bereit":
        return json.dumps({"ok": True})
    if op == "aus_scryfall":
        return json.dumps(handy.aus_scryfall(d["karten"], d["format"], d.get("bekannt")), ensure_ascii=False)
    if op == "neu":
        p, t = d["paket"], d["tisch"]
        karten = p["karten"]
        spieler = max(2, min(12, int(t.get("spieler") or p.get("spieler") or 8)))
        runden = max(1, min(6, int(t.get("runden") or p.get("runden") or 3)))
        groesse = max(5, min(30, int(t.get("groesse") or p.get("groesse") or 15)))
        while spieler * runden * groesse > len(karten) and groesse > 8:
            groesse -= 1
        picks = max(1, min(3, int(t.get("picks") or draft.standard_picks(p["format"], groesse))))
        z = draft._neu_zustand(karten, p["name"], p["format"], "handy:" + str(p.get("id") or ""), spieler, runden, groesse,
                               int(t.get("seed") or random.randrange(1, 10 ** 9)), picks=picks, mono=p.get("mono", True),
                               bot_stufe=t.get("bots") or "normal", themen=p.get("themen"), staemme=p.get("staemme"),
                               archetypen=p.get("archetypen"))
        z["syn"] = p.get("syn") or {}
        z["handy"] = True
        return _aus(z)
    z = json.loads(d["z"])
    if op == "pick":
        draft.pick(z, d.get("karten") or None, auto=bool(d.get("auto")))
        return _aus(z)
    if op == "ansicht":
        return _aus(z)
    if op == "deck":
        deck = draft.deck_speichern(z, d.get("deck") or {})
        return _aus(z, deck=deck)
    if op == "auswertung":
        return json.dumps(draft.auswertung(z), ensure_ascii=False)
    raise ValueError("Unbekannter Auftrag: " + op)
`;

let aufruf = null;
const bereit = (async () => {
  const py = await loadPyodide({indexURL: new URL("pyodide/", self.location).href});
  const quellen = await (await fetch("py/cubegen.json")).json();
  py.FS.mkdirTree("/app/cubegen");
  for (const [name, text] of Object.entries(quellen)) py.FS.writeFile("/app/cubegen/" + name, text);
  py.runPython(PYTHON);
  aufruf = py.globals.get("aufruf");
})();

self.onmessage = async ev => {
  const {n, op, daten} = ev.data;
  try {
    await bereit;
    const r = aufruf(op, JSON.stringify(daten || {}));
    self.postMessage({n, ok: true, r});
  } catch (e) {
    let text = String((e && e.message) || e);
    const zeile = text.trim().split("\n").filter(Boolean).pop();      // bei Python-Fehlern zählt die letzte Zeile
    self.postMessage({n, ok: false, fehler: zeile || text});
  }
};
