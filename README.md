# Pfizer externship: interactive Python lessons

Static lesson pages for Project 2 of the Pfizer Supply Chain Document Processing externship (Extern). Each lesson runs real Python in the browser with Pyodide and is embedded in the course's Notion pages.

- `concept.html?lesson=<id>`: concept lesson (Template A)
- `read-code.html?lesson=<id>`: read the code (Template B)
- `fix-error.html?lesson=<id>`: fix the error (Template C)
- `lessons/<id>.json`: one data file per lesson
- `shared/`: runtime, checker, loader, styles, and `shell.js` (the page shell all three templates share)
- `tests/`: `npm install && npm test`

Local preview: `npm run serve`, then open http://localhost:8765/concept.html?lesson=lists

## Writing lessons

- Fix-the-error lessons: `learn.used_later` is shown as "Next error" and must read `<number+1> of 8 · <ErrorType>` (for example `6 of 8 · IndexError`); a test checks it against the next lesson's `error_type` once that file exists. Error 8 is the exception: it shows "Where you'll use this".
