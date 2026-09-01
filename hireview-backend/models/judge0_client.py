# ============================================================
# Judge0 Client
# File: models/judge0_client.py
#
# Thin wrapper around Judge0 CE (https://judge0.com) — a sandboxed
# multi-language code execution API. This is what actually compiles/
# runs a candidate's submitted code for the Coding Round; routes/coding.py
# never executes untrusted code itself.
#
# We initially built this against Piston's public API, but as of
# Feb 15 2026 Piston's public API requires manual approval from its
# maintainer and — per their own README — keys are NOT granted for
# commercial or portfolio projects. Judge0 CE has a genuinely
# self-serve free tier instead (see setup below), so that's what
# this module talks to now.
#
# ── One-time setup (takes ~2 minutes) ──
#   1. Go to https://rapidapi.com/judge0-official/api/judge0-ce and
#      subscribe to the FREE "Basic" plan (no approval needed).
#   2. Copy your RapidAPI key from that page.
#   3. Set it as JUDGE0_API_KEY in the backend's environment
#      (e.g. in your .env file locally, or in Render/wherever you
#      host the backend's environment variables).
# No other config is required — JUDGE0_API_URL/JUDGE0_API_HOST already
# default to the right values in config.py.
#
# LANGUAGES is the single source of truth for "which popular languages
# does the Coding Round support" — both the /coding/languages endpoint
# and the grading logic in routes/coding.py read from this list.
# ============================================================

import httpx
import config

# Judge0 CE's numeric language_id per runtime — these have been stable
# across Judge0 CE releases for years. If one ever starts erroring,
# GET https://judge0-ce.p.rapidapi.com/languages (with your API key)
# to fetch the current id for that runtime and update it here.
LANGUAGES = [
    {"id": "c", "label": "C (GCC)", "judge0_id": 50, "monaco_language": "c"},
    {"id": "cpp", "label": "C++ (GCC)", "judge0_id": 54, "monaco_language": "cpp"},
    {"id": "python", "label": "Python 3", "judge0_id": 71, "monaco_language": "python"},
    {"id": "java", "label": "Java", "judge0_id": 62, "monaco_language": "java"},
    {"id": "javascript", "label": "JavaScript (Node.js)", "judge0_id": 63, "monaco_language": "javascript"},
]

LANGUAGES_BY_ID = {lang["id"]: lang for lang in LANGUAGES}

# Judge0 status ids that matter to us (full list has ~14 statuses, these
# are the only ones we branch on): 3 = Accepted, 5 = Time Limit Exceeded,
# 6 = Compilation Error. Everything else (4, 7-12) is some flavor of
# runtime error and just surfaces via stderr/message like a normal crash.
STATUS_ACCEPTED = 3
STATUS_TIME_LIMIT_EXCEEDED = 5
STATUS_COMPILATION_ERROR = 6


class Judge0Error(Exception):
    """Raised when the execution service itself can't be reached, isn't
    configured, or errors out (as opposed to the candidate's code simply
    failing/erroring, which is a normal, expected outcome and never
    raises)."""
    pass


def execute_code(language_id: str, source_code: str, stdin: str) -> dict:
    """Run one piece of source code against one stdin payload via Judge0 CE.

    Returns a dict:
      {
        "stdout": str,
        "stderr": str,
        "exit_code": int,
        "compile_stderr": str | None,   # non-empty only if compilation failed
        "timed_out": bool,
      }

    Raises Judge0Error if the execution service itself is unreachable or
    unconfigured — callers should turn that into a 503 rather than a
    graded failure, since it says nothing about whether the candidate's
    code is correct.
    """
    lang = LANGUAGES_BY_ID.get(language_id)
    if not lang:
        raise ValueError(f"Unsupported language: {language_id}")

    if not config.JUDGE0_API_KEY:
        raise Judge0Error(
            "Code execution isn't configured yet — set JUDGE0_API_KEY in the "
            "backend's environment (see the setup note at the top of "
            "models/judge0_client.py)."
        )

    headers = {
        "content-type": "application/json",
        "X-RapidAPI-Key": config.JUDGE0_API_KEY,
        "X-RapidAPI-Host": config.JUDGE0_API_HOST,
    }
    payload = {
        "source_code": source_code,
        "language_id": lang["judge0_id"],
        "stdin": stdin or "",
        "cpu_time_limit": config.CODE_RUN_TIMEOUT_SECONDS,
    }

    try:
        resp = httpx.post(
            f"{config.JUDGE0_API_URL}/submissions",
            params={"base64_encoded": "false", "wait": "true"},
            json=payload,
            headers=headers,
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        raise Judge0Error(f"Couldn't reach the code execution service: {e}")

    status_id = (data.get("status") or {}).get("id")

    return {
        "stdout": data.get("stdout") or "",
        "stderr": data.get("stderr") or data.get("message") or "",
        "exit_code": 0 if status_id == STATUS_ACCEPTED else 1,
        "compile_stderr": data.get("compile_output") if status_id == STATUS_COMPILATION_ERROR else None,
        "timed_out": status_id == STATUS_TIME_LIMIT_EXCEEDED,
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