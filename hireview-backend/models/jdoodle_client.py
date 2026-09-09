# ============================================================
# JDoodle Client
# File: models/jdoodle_client.py
#
# Thin wrapper around the JDoodle Compiler API (https://jdoodle.com/compiler-api)
# — this is what actually compiles/runs a candidate's submitted code for
# the Coding Round; routes/coding.py never executes untrusted code itself.
#
# We moved here from Judge0 CE (models/judge0_client.py, kept in the repo
# for reference/rollback) because Judge0's free RapidAPI tier requires a
# credit card on file even to activate the free plan. JDoodle's free tier
# doesn't: you only need an email address.
#
# ── One-time setup (takes ~2 minutes, no card) ──
#   1. Go to https://www.jdoodle.com/compiler-api and sign up / log in.
#   2. Open the "Compiler API" tab of your account — it shows a
#      clientId and clientSecret pair (generated automatically).
#   3. Set them as JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET in the
#      backend's environment (.env locally, or Render's env vars).
# No other config is required.
#
# ── The catch: 200 free executions/day, shared across ALL users ──
# JDoodle's free tier is capped at 200 API calls/day for the whole
# account — not per user. Every call to execute_code() below spends one,
# so with multiple concurrent candidates this WILL run out on a busy day.
# Two things in this codebase exist specifically to manage that:
#   1. config.MAX_TEST_CASES_PER_RUN / MAX_TEST_CASES_PER_SUBMIT cap how
#      many test cases get executed per Run/Submit click (see
#      routes/coding.py's _run_against_cases) — tune these down if you're
#      burning through the quota too fast, up if you have headroom.
#   2. JdoodleQuotaExceeded (below) is raised distinctly from other
#      errors so routes/coding.py can show the candidate a clear
#      "come back tomorrow" message instead of a generic failure.
# If/when you outgrow this, models/judge0_client.py + a paid Judge0 plan,
# or a self-hosted sandbox, are the next steps — see the conversation
# that added this file for the fuller comparison.
#
# ── Known limitation vs. Judge0: no separate compile-error signal ──
# Judge0 returns stdout/stderr/compile_output as separate fields, so
# routes/coding.py can detect "compilation failed" and stop burning API
# calls re-running the same broken code against every remaining test
# case. JDoodle's /execute only returns a single merged `output` string
# (stdout + stderr + any compiler diagnostics, all mixed together) — it
# does NOT tell you whether that output came from a compiler or the
# program itself. So here, compile_stderr is always None and a
# compilation failure just shows up as a non-matching `stdout` on every
# test case (each one still costs a call). If that quota cost becomes a
# problem, self-hosting Piston/Judge0 (which DO separate compile errors)
# is the fix — see the note above.
# ============================================================

import httpx
import config

# JDoodle's language code + versionIndex per runtime. These are the
# versions available on JDoodle's free tier as of when this was written —
# if compilation starts failing with an "invalid version index" style
# message, check https://www.jdoodle.com/compiler-api for current values
# and update here.
LANGUAGES = [
    {"id": "c", "label": "C (GCC)", "jdoodle_language": "c", "jdoodle_version_index": "5", "monaco_language": "c"},
    {"id": "cpp", "label": "C++ (GCC)", "jdoodle_language": "cpp17", "jdoodle_version_index": "1", "monaco_language": "cpp"},
    {"id": "python", "label": "Python 3", "jdoodle_language": "python3", "jdoodle_version_index": "4", "monaco_language": "python"},
    {"id": "java", "label": "Java", "jdoodle_language": "java", "jdoodle_version_index": "4", "monaco_language": "java"},
    {"id": "javascript", "label": "JavaScript (Node.js)", "jdoodle_language": "nodejs", "jdoodle_version_index": "4", "monaco_language": "javascript"},
]

LANGUAGES_BY_ID = {lang["id"]: lang for lang in LANGUAGES}

# JDoodle statusCodes that matter to us — see
# https://www.jdoodle.com/compiler-api for the full list.
STATUS_INVALID_REQUEST = 400
STATUS_UNAUTHORIZED = 401
STATUS_UNSUPPORTED_MEDIA_TYPE = 415
STATUS_DAILY_LIMIT_REACHED = 429
STATUS_SERVER_ERROR = 500


class Judge0Error(Exception):
    """Kept as an alias of JdoodleError (see below) so any code still
    importing the old name from models.judge0_client keeps working."""
    pass


class JdoodleError(Judge0Error):
    """Raised when the execution service itself can't be reached, isn't
    configured, or errors out (as opposed to the candidate's code simply
    failing/erroring, which is a normal, expected outcome and never
    raises)."""
    pass


class JdoodleQuotaExceeded(JdoodleError):
    """Raised specifically when JDoodle's daily free-tier limit (200
    calls/day, shared across all users) has been hit. Kept as its own
    exception type so routes/coding.py can show a distinct, honest
    message instead of a generic 'execution service unreachable' one."""
    pass


def execute_code(language_id: str, source_code: str, stdin: str) -> dict:
    """Run one piece of source code against one stdin payload via JDoodle.

    Returns a dict:
      {
        "stdout": str,                  # JDoodle's merged output (see
                                         # module docstring — this may
                                         # include stderr/compiler text)
        "stderr": str,                  # always "" — JDoodle doesn't
                                         # separate this out
        "exit_code": int,                # always 0 — JDoodle doesn't
                                         # report a real exit code; rely
                                         # on comparing stdout instead
        "compile_stderr": str | None,   # always None, see module docstring
        "timed_out": bool,               # best-effort guess from the
                                         # output text; JDoodle doesn't
                                         # give a structured timeout flag
      }

    Raises JdoodleQuotaExceeded if the daily free-tier limit has been
    hit, or JdoodleError for any other configuration/connectivity issue.
    """
    lang = LANGUAGES_BY_ID.get(language_id)
    if not lang:
        raise ValueError(f"Unsupported language: {language_id}")

    if not config.JDOODLE_CLIENT_ID or not config.JDOODLE_CLIENT_SECRET:
        raise JdoodleError(
            "Code execution isn't configured yet — set JDOODLE_CLIENT_ID and "
            "JDOODLE_CLIENT_SECRET in the backend's environment (see the "
            "setup note at the top of models/jdoodle_client.py)."
        )

    payload = {
        "clientId": config.JDOODLE_CLIENT_ID,
        "clientSecret": config.JDOODLE_CLIENT_SECRET,
        "script": source_code,
        "language": lang["jdoodle_language"],
        "versionIndex": lang["jdoodle_version_index"],
        "stdin": stdin or "",
    }

    try:
        resp = httpx.post(
            f"{config.JDOODLE_API_URL}/execute",
            json=payload,
            timeout=30.0,
        )
        data = resp.json()
    except httpx.HTTPError as e:
        raise JdoodleError(f"Couldn't reach the code execution service: {e}")
    except ValueError:
        raise JdoodleError("Code execution service returned an unreadable response.")

    status_code = data.get("statusCode", resp.status_code)

    if status_code == STATUS_DAILY_LIMIT_REACHED:
        raise JdoodleQuotaExceeded(
            "We've hit today's free code-execution limit. Please try again after "
            "midnight UTC, when JDoodle's daily quota resets."
        )
    if status_code in (STATUS_UNAUTHORIZED,):
        raise JdoodleError(
            "Code execution service rejected our credentials — double-check "
            "JDOODLE_CLIENT_ID/JDOODLE_CLIENT_SECRET."
        )
    if status_code in (STATUS_INVALID_REQUEST, STATUS_UNSUPPORTED_MEDIA_TYPE, STATUS_SERVER_ERROR):
        raise JdoodleError(f"Code execution service error (status {status_code}).")

    output = data.get("output") or ""

    return {
        "stdout": output,
        "stderr": "",
        "exit_code": 0,
        "compile_stderr": None,
        # JDoodle has no structured timeout signal — this is a best-effort
        # text match on the couple of phrasings it's known to emit.
        "timed_out": "time limit" in output.lower() or "timed out" in output.lower(),
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
# Identical to the templates that lived in judge0_client.py — JDoodle
# vs. Judge0 doesn't change what a candidate's starting point should
# look like, only how the code gets executed.
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