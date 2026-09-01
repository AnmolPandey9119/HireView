# ============================================================
# Piston Execution Client
# File: models/piston_client.py
#
# Thin wrapper around the Piston API (https://github.com/engineer-man/piston)
# — a free, open-source, sandboxed multi-language code runner. This is
# what actually compiles/runs a candidate's submitted code for the
# Coding Round; routes/coding.py never executes untrusted code itself.
#
# LANGUAGES is the single source of truth for "which popular languages
# does the Coding Round support" — both the /coding/languages endpoint
# and the grading logic in routes/coding.py read from this list, so
# adding a language later is a one-line change here.
# ============================================================

import httpx
import config

# version="*" tells Piston "use whatever the latest available build of
# this runtime is" — avoids hardcoding a version string that drifts out
# of sync with what the (possibly self-hosted) Piston instance actually
# has installed.
LANGUAGES = [
    {
        "id": "c", "label": "C (GCC)", "piston_language": "c", "piston_version": "*",
        "filename": "main.c", "monaco_language": "c",
    },
    {
        "id": "cpp", "label": "C++ (G++)", "piston_language": "cpp", "piston_version": "*",
        "filename": "main.cpp", "monaco_language": "cpp",
    },
    {
        "id": "python", "label": "Python 3", "piston_language": "python", "piston_version": "*",
        "filename": "main.py", "monaco_language": "python",
    },
    {
        "id": "java", "label": "Java", "piston_language": "java", "piston_version": "*",
        "filename": "Main.java", "monaco_language": "java",
    },
    {
        "id": "javascript", "label": "JavaScript (Node.js)", "piston_language": "javascript", "piston_version": "*",
        "filename": "main.js", "monaco_language": "javascript",
    },
]

LANGUAGES_BY_ID = {lang["id"]: lang for lang in LANGUAGES}


class PistonError(Exception):
    """Raised when the execution service itself can't be reached or errors out
    (as opposed to the candidate's code simply failing/erroring, which is a
    normal, expected outcome and never raises)."""
    pass


def execute_code(language_id: str, source_code: str, stdin: str) -> dict:
    """Run one piece of source code against one stdin payload via Piston.

    Returns a dict:
      {
        "stdout": str,
        "stderr": str,
        "exit_code": int | None,
        "compile_stderr": str | None,   # non-empty only if compilation failed
        "timed_out": bool,
      }

    Raises PistonError if the execution service itself is unreachable —
    callers should turn that into a 503 rather than a graded failure, since
    it says nothing about whether the candidate's code is correct.
    """
    lang = LANGUAGES_BY_ID.get(language_id)
    if not lang:
        raise ValueError(f"Unsupported language: {language_id}")

    payload = {
        "language": lang["piston_language"],
        "version": lang["piston_version"],
        "files": [{"name": lang["filename"], "content": source_code}],
        "stdin": stdin or "",
        "run_timeout": config.CODE_RUN_TIMEOUT_MS,
        "compile_timeout": config.CODE_COMPILE_TIMEOUT_MS,
    }

    try:
        resp = httpx.post(f"{config.PISTON_API_URL}/execute", json=payload, timeout=25.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        raise PistonError(f"Couldn't reach the code execution service: {e}")

    compile_stage = data.get("compile") or {}
    run_stage = data.get("run") or {}

    compile_stderr = None
    # A compiled language (C/C++/Java) reports a non-zero compile exit code
    # on a syntax error; interpreted languages have no "compile" stage at all.
    if compile_stage and compile_stage.get("code") not in (0, None):
        compile_stderr = compile_stage.get("stderr") or compile_stage.get("output") or "Compilation failed."

    return {
        "stdout": run_stage.get("stdout", "") or "",
        "stderr": run_stage.get("stderr", "") or "",
        "exit_code": run_stage.get("code"),
        "compile_stderr": compile_stderr,
        # Piston reports a kill signal (SIGKILL) when the run/compile timeout
        # is hit — that's the practical way to detect "the code hung/looped".
        "timed_out": run_stage.get("signal") == "SIGKILL" or compile_stage.get("signal") == "SIGKILL",
    }


def normalize_output(s: str) -> str:
    """Normalizes program output before comparing it to expected_output:
    trims trailing whitespace on every line and trailing blank lines, so
    a trailing newline or trailing spaces (which almost every language's
    print/println adds) don't cause a false mismatch. Does NOT touch
    internal spacing/case — the actual content still has to match."""
    if s is None:
        return ""
    lines = s.replace("\r\n", "\n").strip("\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip()


# ============================================================
# Per-language starter code
# The question bank (seed_questions.py) only stores a C starter
# template per problem (scanf/printf boilerplate). For every other
# language we generate a generic "read stdin, write your solution,
# print stdout" skeleton here rather than pretending to auto-translate
# the C template — the candidate still has to read the problem's
# input/output format from the prompt itself, same as a real judge.
# ============================================================
_GENERIC_TEMPLATES = {
    "cpp": (
        "#include <bits/stdc++.h>\n"
        "using namespace std;\n\n"
        "int main() {\n"
        "    // TODO: read the input (see the problem statement for the exact format)\n"
        "    // and print your answer to stdout.\n\n"
        "    return 0;\n"
        "}\n"
    ),
    "python": (
        "import sys\n\n"
        "def main():\n"
        "    data = sys.stdin.read().split()\n"
        "    # TODO: parse `data` per the input format in the problem statement,\n"
        "    # then print your answer.\n\n"
        "if __name__ == '__main__':\n"
        "    main()\n"
    ),
    "java": (
        "import java.util.*;\n\n"
        "public class Main {\n"
        "    public static void main(String[] args) {\n"
        "        Scanner sc = new Scanner(System.in);\n"
        "        // TODO: read the input (see the problem statement for the exact format)\n"
        "        // and print your answer to stdout.\n"
        "    }\n"
        "}\n"
    ),
    "javascript": (
        "const lines = require('fs').readFileSync('/dev/stdin', 'utf8').split('\\n');\n\n"
        "// TODO: parse `lines`/the raw input per the problem statement,\n"
        "// then console.log your answer.\n"
    ),
}


def get_starter_code(language_id: str, db_starter_code: str | None) -> str:
    if language_id == "c":
        return db_starter_code or "#include <stdio.h>\n\nint main() {\n    return 0;\n}\n"
    return _GENERIC_TEMPLATES.get(language_id, "")