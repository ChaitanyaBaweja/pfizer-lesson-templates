# Pfizer externship: interactive Python lessons

Static lesson pages for Project 2 of the Pfizer Supply Chain Document Processing externship (Extern). Each lesson runs real Python in the browser with Pyodide and is embedded in the course's Notion pages.

- `concept.html?lesson=<id>`: concept lesson (Template A)
- `lessons/<id>.json`: one data file per lesson
- `shared/`: runtime, checker, loader and styles
- `tests/`: `npm install && npm test`

Local preview: `npm run serve`, then open http://localhost:8765/concept.html?lesson=lists
