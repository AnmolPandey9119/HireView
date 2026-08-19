# ============================================================
# Question Bank Seed Script — STARTER BATCH for review
# File: seed_questions.py (run from hireview-backend/ directory)
#
# Run once with: python seed_questions.py
# Safe to re-run — it skips insertion if the table already has rows,
# so it won't duplicate on every server restart.
#
# This is a STARTER batch only (10 aptitude / 10 coding / 10 interview)
# for AP to review before the full 100/100/25-30 set gets generated.
# ============================================================

import json
from models.database import SessionLocal, QuestionBank, CodingTestCase, init_db

def seed():
    init_db()
    db = SessionLocal()

    if db.query(QuestionBank).count() > 0:
        print("question_bank already has rows — skipping seed (delete rows manually to re-seed).")
        db.close()
        return

    # ============================================================
    # APTITUDE — 10 MCQs across topics: percentages, profit & loss,
    # time & work, averages, number series
    # ============================================================
    aptitude = [
        dict(topic="percentages", difficulty="easy",
             prompt="A number is increased by 20% and then decreased by 20%. What is the net percentage change?",
             options=["No change", "4% decrease", "4% increase", "20% decrease"],
             correct_index=1,
             explanation="Net change = -(20*20)/100 = -4%, i.e. a 4% decrease, because the second percentage is taken on the already-increased value."),
        dict(topic="percentages", difficulty="medium",
             prompt="In an exam, 35% of students failed in Math and 45% failed in English. If 20% failed in both, what percentage passed in both subjects?",
             options=["30%", "35%", "40%", "60%"],
             correct_index=2,
             explanation="Failed in at least one = 35+45-20 = 60%. Passed in both = 100-60 = 40%."),
        dict(topic="percentages", difficulty="hard",
             prompt="The price of an item is first increased by 25% and then decreased by x% to bring it back to the original price. Find x.",
             options=["20%", "25%", "15%", "22.5%"],
             correct_index=0,
             explanation="If original = 100, after increase = 125. To return to 100: x = (25/125)*100 = 20%."),

        dict(topic="profit_and_loss", difficulty="easy",
             prompt="A shopkeeper buys an item for ₹400 and sells it for ₹460. What is the profit percentage?",
             options=["10%", "12%", "15%", "20%"],
             correct_index=2,
             explanation="Profit = 60. Profit% = (60/400)*100 = 15%."),
        dict(topic="profit_and_loss", difficulty="medium",
             prompt="A man sells two items at ₹1200 each. On one he gains 20% and on the other he loses 20%. Find his overall profit or loss percentage.",
             options=["No profit no loss", "4% loss", "4% profit", "8% loss"],
             correct_index=1,
             explanation="When cost prices differ (equal selling price, equal % gain/loss), there's always a net loss of (common%)^2 / 100 = 400/100 = 4%."),

        dict(topic="time_and_work", difficulty="easy",
             prompt="A can complete a piece of work in 10 days and B in 15 days. Working together, how many days will they take?",
             options=["5 days", "6 days", "8 days", "12 days"],
             correct_index=1,
             explanation="Combined rate = 1/10 + 1/15 = 1/6, so together they finish in 6 days."),
        dict(topic="time_and_work", difficulty="medium",
             prompt="A and B together can finish a job in 12 days. A alone can finish it in 20 days. In how many days can B alone finish it?",
             options=["24 days", "30 days", "36 days", "40 days"],
             correct_index=1,
             explanation="B's rate = 1/12 - 1/20 = 1/30, so B alone takes 30 days."),

        dict(topic="averages", difficulty="easy",
             prompt="The average of 5 numbers is 27. If one number is excluded, the average becomes 25. What is the excluded number?",
             options=["25", "30", "35", "40"],
             correct_index=2,
             explanation="Sum of 5 = 135. Sum of remaining 4 = 100. Excluded number = 135-100 = 35."),
        dict(topic="averages", difficulty="medium",
             prompt="The average age of a class of 24 students is 15 years. If the teacher's age (40 years) is included, what is the new average?",
             options=["15.5", "16", "16.5", "17"],
             correct_index=1,
             explanation="Total age of students = 24*15 = 360. Adding teacher: (360+40)/25 = 400/25 = 16."),

        dict(topic="number_series", difficulty="hard",
             prompt="Find the next number in the series: 2, 6, 12, 20, 30, ?",
             options=["40", "42", "36", "48"],
             correct_index=1,
             explanation="Differences are 4, 6, 8, 10, 12 (each +2), so next term = 30+12 = 42."),
    ]

    for a in aptitude:
        db.add(QuestionBank(
            category="aptitude", topic=a["topic"], difficulty=a["difficulty"],
            prompt=a["prompt"], options=json.dumps(a["options"]),
            correct_index=a["correct_index"], explanation=a["explanation"],
        ))

    # ============================================================
    # CODING — 10 problems across topics: arrays, strings, math,
    # recursion, sorting — with sample + hidden test cases.
    # starter_code is C, matching the "C compiler first" scope for Phase 4.
    # ============================================================
    coding = [
        dict(topic="arrays", difficulty="easy",
             prompt="Given an array of n integers, print the largest element.",
             constraints="1 <= n <= 1000, -10^6 <= arr[i] <= 10^6",
             starter_code="#include <stdio.h>\n\nint main() {\n    int n;\n    scanf(\"%d\", &n);\n    int arr[n];\n    for (int i = 0; i < n; i++) scanf(\"%d\", &arr[i]);\n\n    // TODO: find and print the largest element\n\n    return 0;\n}\n",
             cases=[("5\n3 7 2 9 4", "9", True), ("3\n-1 -5 -2", "-1", True), ("1\n42", "42", False), ("4\n0 0 0 0", "0", False)]),
        dict(topic="arrays", difficulty="medium",
             prompt="Given an array of n integers, reverse the array in place and print it.",
             constraints="1 <= n <= 1000",
             starter_code="#include <stdio.h>\n\nint main() {\n    int n;\n    scanf(\"%d\", &n);\n    int arr[n];\n    for (int i = 0; i < n; i++) scanf(\"%d\", &arr[i]);\n\n    // TODO: reverse arr in place and print space-separated\n\n    return 0;\n}\n",
             cases=[("5\n1 2 3 4 5", "5 4 3 2 1", True), ("3\n9 8 7", "7 8 9", True), ("1\n1", "1", False)]),
        dict(topic="strings", difficulty="easy",
             prompt="Read a string and print 1 if it is a palindrome, 0 otherwise.",
             constraints="1 <= length <= 1000, lowercase letters only",
             starter_code="#include <stdio.h>\n#include <string.h>\n\nint main() {\n    char s[1001];\n    scanf(\"%s\", s);\n\n    // TODO: check palindrome, print 1 or 0\n\n    return 0;\n}\n",
             cases=[("madam", "1", True), ("hello", "0", True), ("a", "1", False), ("ab", "0", False)]),
        dict(topic="strings", difficulty="medium",
             prompt="Read a string and print the count of each distinct character in the order of first appearance, as 'char:count' pairs separated by spaces.",
             constraints="1 <= length <= 1000, lowercase letters only",
             starter_code="#include <stdio.h>\n#include <string.h>\n\nint main() {\n    char s[1001];\n    scanf(\"%s\", s);\n\n    // TODO: print char:count pairs in first-appearance order\n\n    return 0;\n}\n",
             cases=[("aabbbc", "a:2 b:3 c:1", True), ("xyz", "x:1 y:1 z:1", True)]),
        dict(topic="math", difficulty="easy",
             prompt="Read an integer n and print whether it is prime (1) or not (0).",
             constraints="1 <= n <= 10^6",
             starter_code="#include <stdio.h>\n\nint main() {\n    int n;\n    scanf(\"%d\", &n);\n\n    // TODO: print 1 if prime, else 0\n\n    return 0;\n}\n",
             cases=[("7", "1", True), ("10", "0", True), ("1", "0", False), ("2", "1", False)]),
        dict(topic="math", difficulty="medium",
             prompt="Read an integer n and print its factorial. n is guaranteed small enough to fit in a long long.",
             constraints="0 <= n <= 20",
             starter_code="#include <stdio.h>\n\nint main() {\n    int n;\n    scanf(\"%d\", &n);\n\n    // TODO: compute and print n! as a long long\n\n    return 0;\n}\n",
             cases=[("5", "120", True), ("0", "1", True), ("10", "3628800", False)]),
        dict(topic="recursion", difficulty="medium",
             prompt="Read two integers n and r, and print the value of nCr (combinations), using a recursive function.",
             constraints="0 <= r <= n <= 20",
             starter_code="#include <stdio.h>\n\n// TODO: implement recursively\nlong long nCr(int n, int r) {\n    return 0;\n}\n\nint main() {\n    int n, r;\n    scanf(\"%d %d\", &n, &r);\n    printf(\"%lld\\n\", nCr(n, r));\n    return 0;\n}\n",
             cases=[("5 2", "10", True), ("6 0", "1", True), ("6 6", "1", False)]),
        dict(topic="recursion", difficulty="hard",
             prompt="Read n and print the nth Fibonacci number (0-indexed: fib(0)=0, fib(1)=1), using recursion with memoization so it runs fast for large n.",
             constraints="0 <= n <= 40",
             starter_code="#include <stdio.h>\n\nlong long memo[41];\nint has[41];\n\n// TODO: implement recursively with memoization\nlong long fib(int n) {\n    return 0;\n}\n\nint main() {\n    int n;\n    scanf(\"%d\", &n);\n    printf(\"%lld\\n\", fib(n));\n    return 0;\n}\n",
             cases=[("10", "55", True), ("0", "0", True), ("40", "102334155", False)]),
        dict(topic="sorting", difficulty="medium",
             prompt="Read n integers and print them sorted in ascending order, space-separated. Implement the sort yourself (no qsort/library sort).",
             constraints="1 <= n <= 1000",
             starter_code="#include <stdio.h>\n\nint main() {\n    int n;\n    scanf(\"%d\", &n);\n    int arr[n];\n    for (int i = 0; i < n; i++) scanf(\"%d\", &arr[i]);\n\n    // TODO: sort arr ascending without qsort, print space-separated\n\n    return 0;\n}\n",
             cases=[("5\n5 3 1 4 2", "1 2 3 4 5", True), ("3\n3 3 1", "1 3 3", True)]),
        dict(topic="sorting", difficulty="hard",
             prompt="Read n integers and print the second largest DISTINCT value. If no such value exists, print -1.",
             constraints="1 <= n <= 1000",
             starter_code="#include <stdio.h>\n\nint main() {\n    int n;\n    scanf(\"%d\", &n);\n    int arr[n];\n    for (int i = 0; i < n; i++) scanf(\"%d\", &arr[i]);\n\n    // TODO: find second largest distinct value, or -1\n\n    return 0;\n}\n",
             cases=[("5\n5 3 9 9 7", "7", True), ("3\n4 4 4", "-1", True), ("2\n1 2", "1", False)]),
    ]

    for c in coding:
        q = QuestionBank(
            category="coding", topic=c["topic"], difficulty=c["difficulty"],
            prompt=c["prompt"], starter_code=c["starter_code"], constraints=c["constraints"],
        )
        db.add(q)
        db.flush()  # get q.id before adding test cases
        for i, (inp, out, is_sample) in enumerate(c["cases"]):
            db.add(CodingTestCase(question_id=q.id, input=inp, expected_output=out, is_sample=is_sample, order_index=i))

    # ============================================================
    # INTERVIEW — 10 open-ended questions across behavioral,
    # technical-conceptual, and situational categories.
    # guidance_notes are for future feedback-scoring use, not shown
    # to the candidate.
    # ============================================================
    interview = [
        dict(topic="behavioral", difficulty="easy",
             prompt="Tell me about yourself and walk me through your resume.",
             guidance_notes="Look for: clear structure (present -> past -> future), relevance to the role applied for, no rambling, confident delivery without reading verbatim from resume."),
        dict(topic="behavioral", difficulty="medium",
             prompt="Describe a time you disagreed with a teammate or manager. How did you handle it?",
             guidance_notes="Look for: specific example (not hypothetical), ownership of their own role in the disagreement, a constructive resolution, no blame-shifting."),
        dict(topic="behavioral", difficulty="medium",
             prompt="Tell me about a project that failed or didn't go as planned. What did you learn?",
             guidance_notes="Look for: honesty about failure (not deflecting to external factors only), concrete lesson learned, evidence they applied that lesson afterward."),
        dict(topic="behavioral", difficulty="hard",
             prompt="Describe a situation where you had to make a decision with incomplete information. What was your process?",
             guidance_notes="Look for: structured reasoning under uncertainty, risk assessment, willingness to revisit the decision if new info came in."),
        dict(topic="situational", difficulty="medium",
             prompt="If you were given a task with an unrealistic deadline by your manager, what would you do?",
             guidance_notes="Look for: proactive communication over silent overwork or silent refusal, prioritization/scoping discussion, professionalism."),
        dict(topic="situational", difficulty="hard",
             prompt="You discover a critical bug in production right before a big client demo. What do you do?",
             guidance_notes="Look for: triage instinct (severity first), transparent communication to stakeholders, calm under pressure, not hiding the issue."),
        dict(topic="technical_conceptual", difficulty="easy",
             prompt="What is the difference between a process and a thread?",
             guidance_notes="Look for: memory isolation vs shared memory, overhead differences, correct mention of context switching cost."),
        dict(topic="technical_conceptual", difficulty="medium",
             prompt="Explain the difference between SQL and NoSQL databases, and when you'd choose one over the other.",
             guidance_notes="Look for: schema flexibility, consistency vs scalability tradeoffs (ACID vs eventual consistency), a real example of when they used each."),
        dict(topic="technical_conceptual", difficulty="medium",
             prompt="What is REST, and what makes an API RESTful?",
             guidance_notes="Look for: statelessness, resource-based URLs, correct use of HTTP verbs, idempotency concept if they go deep enough."),
        dict(topic="technical_conceptual", difficulty="hard",
             prompt="How would you design a URL shortening service like bit.ly? Walk me through your approach.",
             guidance_notes="Look for: structured approach (requirements -> estimation -> high-level design -> deep dive), encoding scheme for short URLs, database choice reasoning, mention of caching/scaling."),
    ]

    for i in interview:
        db.add(QuestionBank(
            category="interview", topic=i["topic"], difficulty=i["difficulty"],
            prompt=i["prompt"], guidance_notes=i["guidance_notes"],
        ))

    db.commit()
    total = db.query(QuestionBank).count()
    print(f"Seeded {total} starter questions (aptitude: {len(aptitude)}, coding: {len(coding)}, interview: {len(interview)}).")
    db.close()


if __name__ == "__main__":
    seed()