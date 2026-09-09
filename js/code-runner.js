/* ════════════════════════════════════════════════
   HireView — In-browser code execution engine
   File: js/code-runner.js

   Replaces the old JDoodle-backed server execution for Python and
   JavaScript: both now run entirely in the candidate's own browser,
   so there's no external "~20 calls/day, shared across everyone"
   quota to run out of. C, C++, and Java have no in-browser runtime
   here (yet) and are marked "Coming soon" in the UI — see coding.js /
   questionbank.js's language dropdowns.

   IMPORTANT — this file only ever produces an *actual_output* string
   (plus error/timeout info) for a given (source_code, stdin) pair. It
   never sees or compares against expected_output. Hidden test cases'
   expected_output still lives only on the server (routes/coding.py),
   which is what actually grades a submission — same trust model as
   before, just with the compute moved client-side. See _grade_cases
   in routes/coding.py.

   Exposes: window.HVCodeRunner = {
     AVAILABLE_LANGUAGES: ['python', 'javascript'],
     isAvailable(languageId) -> bool,
     preload(languageId) -> Promise<void>   // warm up Pyodide early
     run(languageId, sourceCode, stdin, timeoutMs) ->
       Promise<{ output: string, error: string|null, timed_out: boolean }>
   }
   ════════════════════════════════════════════════ */

(function () {
  const AVAILABLE_LANGUAGES = ['python', 'javascript'];
  const DEFAULT_TIMEOUT_MS = 8000; // mirrors the old CODE_RUN_TIMEOUT_SECONDS

  // ────────────────────────────────────────────
  // Python — Pyodide (WebAssembly CPython), loaded lazily from jsDelivr
  // so pages that never open the coding editor don't pay for it.
  // ────────────────────────────────────────────
  const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  let pyodidePromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-hv-src="${src}"]`);
      if (existing) { existing.addEventListener('load', resolve); existing.addEventListener('error', reject); if (existing.dataset.hvLoaded) resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.dataset.hvSrc = src;
      s.onload = () => { s.dataset.hvLoaded = '1'; resolve(); };
      s.onerror = () => reject(new Error(`Couldn't load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function getPyodide() {
    if (!pyodidePromise) {
      pyodidePromise = (async () => {
        await loadScript(`${PYODIDE_CDN}pyodide.js`);
        const pyodide = await window.loadPyodide({ indexURL: PYODIDE_CDN });
        return pyodide;
      })();
    }
    return pyodidePromise;
  }

  async function runPython(sourceCode, stdin, timeoutMs) {
    const pyodide = await withTimeout(getPyodide(), timeoutMs, 'Loading the Python runtime');

    // Feed stdin via a small in-memory line reader so `input()` in the
    // candidate's program works the same way it would reading real
    // stdin. Captures stdout/stderr separately, same shape Judge0 used
    // to give us (and JDoodle, notably, did not).
    pyodide.runPython(`
import sys, io
_hv_stdin_lines = ${JSON.stringify((stdin || '').split('\n'))}
_hv_stdin_iter = iter(_hv_stdin_lines)
def _hv_input(prompt=''):
    try:
        return next(_hv_stdin_iter)
    except StopIteration:
        raise EOFError('EOF when reading a line')
import builtins
builtins.input = _hv_input
sys.stdin = io.StringIO("\\n".join(_hv_stdin_lines))
_hv_stdout = io.StringIO()
_hv_stderr = io.StringIO()
`);
    pyodide.setStdout({ batched: (s) => { pyodide._hv_out = (pyodide._hv_out || '') + s + '\n'; } });
    pyodide.setStderr({ batched: (s) => { pyodide._hv_err = (pyodide._hv_err || '') + s + '\n'; } });
    pyodide._hv_out = '';
    pyodide._hv_err = '';

    let error = null;
    try {
      await withTimeout(pyodide.runPythonAsync(sourceCode), timeoutMs, 'Running your program');
    } catch (e) {
      error = (pyodide._hv_err || '') + String(e && e.message ? e.message : e);
    }
    return { output: pyodide._hv_out || '', error: error ? error.slice(0, 2000) : null, timed_out: false };
  }

  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} took too long (possible infinite loop).`), { hvTimeout: true })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // ────────────────────────────────────────────
  // JavaScript — runs inside a sandboxed Web Worker (its own thread,
  // no DOM/network/cookie access) so a candidate's code can't touch
  // the page it's being graded from. stdin is exposed as a global
  // `readLine()` helper plus a `stdinLines` array, since a Worker has
  // no real stdin. console.log output is captured as the program's
  // stdout.
  // ────────────────────────────────────────────
  const JS_WORKER_SRC = `
    let __lines = [];
    let __idx = 0;
    let __out = [];
    self.console = {
      log: (...args) => __out.push(args.map(String).join(' ')),
      error: (...args) => __out.push(args.map(String).join(' ')),
      warn: (...args) => __out.push(args.map(String).join(' ')),
      info: (...args) => __out.push(args.map(String).join(' ')),
    };
    function readLine() { return __idx < __lines.length ? __lines[__idx++] : null; }
    self.onmessage = async (e) => {
      __lines = e.data.stdin;
      __out = [];
      const stdinLines = __lines;
      let error = null;
      try {
        const fn = new Function('readLine', 'stdinLines', e.data.code);
        await fn(readLine, stdinLines);
      } catch (err) {
        error = String(err && err.stack ? err.stack : err).slice(0, 2000);
      }
      self.postMessage({ output: __out.join('\\n'), error });
    };
  `;

  function runJavaScript(sourceCode, stdin, timeoutMs) {
    return new Promise((resolve) => {
      const blob = new Blob([JS_WORKER_SRC], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ output: '', error: null, timed_out: true });
      }, timeoutMs);

      worker.onmessage = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ output: e.data.output || '', error: e.data.error || null, timed_out: false });
      };
      worker.onerror = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ output: '', error: String(e.message || 'Script error').slice(0, 2000), timed_out: false });
      };

      worker.postMessage({ code: sourceCode, stdin: (stdin || '').split('\n') });
    });
  }

  // ────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────
  async function run(languageId, sourceCode, stdin, timeoutMs) {
    const ms = timeoutMs || DEFAULT_TIMEOUT_MS;
    if (languageId === 'python') {
      try {
        return await runPython(sourceCode, stdin, ms);
      } catch (e) {
        return { output: '', error: null, timed_out: !!(e && e.hvTimeout) };
      }
    }
    if (languageId === 'javascript') {
      return runJavaScript(sourceCode, stdin, ms);
    }
    throw new Error(`${languageId} isn't runnable in the browser yet — coming soon.`);
  }

  window.HVCodeRunner = {
    AVAILABLE_LANGUAGES,
    isAvailable: (id) => AVAILABLE_LANGUAGES.includes(id),
    preload: (id) => (id === 'python' ? getPyodide() : Promise.resolve()),
    run,
  };
})();