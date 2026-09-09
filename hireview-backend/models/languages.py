# ============================================================
# Coding Round — language metadata
# File: models/languages.py
#
# Replaces models/jdoodle_client.py. Code no longer runs on the
# server at all: Python and JavaScript now execute entirely in the
# candidate's browser (js/code-runner.js — Pyodide for Python, a
# sandboxed Web Worker for JavaScript), so there's no external
# execution-service quota (JDoodle's free plan was ~20 calls/day,
# shared across every candidate — not 200, whatever old comments in
# this codebase's history may have said) to run out of for those two
# languages.
#
# C, C++, and Java are listed here with available=False ("Coming
# soon" in the UI) — there's no in-browser runtime wired up for them
# yet. Bringing them back would mean either finding a WASM-based
# runtime for each (e.g. a WASM GCC build) or reintroducing a trusted
# server-side execution service; see the git history around the
# JDoodle -> in-browser migration for the fuller tradeoff writeup.
#
# This module only holds metadata, starter code, and the output
# comparison used to grade a submission — never test-case execution.
# routes/coding.py compares the *actual_output* the browser reports
# for each case (see /coding/questions/{id}/run and /submit) against
# the expected_output it already holds in the database. Hidden test
# cases' expected_output is still never sent to the browser — the
# browser only ever gets stdin to run against for those.
# ============================================================

LANGUAGES = [
    {"id": "python", "label": "Python 3", "monaco_language": "python", "available": True},
    {"id": "javascript", "label": "JavaScript (Node-style)", "monaco_language": "javascript", "available": True},
    {"id": "c", "label": "C (GCC)", "monaco_language": "c", "available": False},
    {"id": "cpp", "label": "C++ (GCC)", "monaco_language": "cpp", "available": False},
    {"id": "java", "label": "Java", "monaco_language": "java", "available": False},
]

LANGUAGES_BY_ID = {lang["id"]: lang for lang in LANGUAGES}
AVAILABLE_LANGUAGE_IDS = {lang["id"] for lang in LANGUAGES if lang["available"]}


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
# Per-language starter code — unchanged from the JDoodle/Judge0 era;
# switching where code runs never changed what a candidate's starting
# point should look like.
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
        "// `readLine()` returns the next line of stdin (or null at EOF).\n"
        "// `stdinLines` holds every line as an array, if you'd rather index into it.\n"
        "// console.log(...) is your stdout — print your answer with it.\n\n"
        "let line;\n"
        "while ((line = readLine()) !== null) {\n"
        "    // TODO: parse `line` per the input format in the problem statement,\n"
        "    // then console.log your answer.\n"
        "}\n"
    ),
}


def get_starter_code(language_id: str, db_starter_code: str | None) -> str:
    if language_id == "c":
        return db_starter_code or "#include <stdio.h>\n\nint main() {\n    return 0;\n}\n"
    return _GENERIC_TEMPLATES.get(language_id, "")