# HireView — AI Mock Interview Platform

**Practice Like It's Real. Perform Like a Pro.**

🔗 **Live:** [hireview-ai.vercel.app](https://hireview-ai.vercel.app)
📂 **Repo:** [github.com/AnmolPandey9119/HireView](https://github.com/AnmolPandey9119/HireView)

HireView is an AI-powered mock interview platform built for Indian job seekers. It conducts real, adaptive interviews using a conversational AI interviewer named **Arjun**, provides detailed feedback, and detects cheating using computer vision and behavioral signals — in English, Hinglish, or any of 11 Indian regional languages.

## Why HireView

Most job seekers in India walk into interviews having never practiced one in a realistic setting — friends and family can't simulate real interview pressure, and generic question banks don't adapt to *your* resume or push back on vague answers. HireView fixes that: an AI interviewer that reads your resume (and the actual job description, if you have one), asks follow-up questions the way a real recruiter would, scores your performance honestly, and flags integrity issues the same way a proctored exam would — so practice actually prepares you for the real thing.

## Features

**Interview Experience**
- AI Interviewer (Arjun) — powered by Groq (`openai/gpt-oss-120b`), structured Introduction → Basic → Deep Dive flow
- Voice-first — Arjun speaks questions aloud (browser TTS), candidate responds by speaking or typing; mic stays live for the full session so nothing is missed mid-answer
- Resume-aware — questions tailored to the candidate's actual resume (PDF/TXT upload)
- **Job Description mode (new)** — paste or upload a JD alongside the resume; domain/role become optional and Arjun cross-checks the candidate's resume against the JD's actual requirements, calling out gaps
- Adaptive difficulty, cross-questioning on vague answers, and a smart silence watchdog that nudges the candidate before moving on if they go quiet
- **Government Sector track** — regional-language interview flow gated by an admin-managed list of government domains/roles, built for exams like UPSC/SSC/IBPS
- **11 Indian language support (new)** — Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu, plus English and Hinglish — wired through the AI prompts, speech-to-text, and text-to-speech
- Back-to-home navigation on the interview screen

**Integrity Detection**
- Tab/window switch detection — interview auto-terminates after more than 2 switches
- MediaPipe face detection (HTTPS only) — blocks interview start if no face is visible, and auto-ends the session if the candidate disappears mid-interview
- Background audio-noise monitoring, response-timing analysis, and a full integrity report generated per session
- Interviews can be auto-terminated or flagged as failed when cheating is detected

**Feedback & Analytics**
- AI-generated scoring (overall / technical / soft skills), strengths & areas to improve
- Interview recording (download or delete — never stored server-side)
- Dashboard with progress tracking, full history with Q&A + feedback, and stale in-progress cleanup

**Accounts & Security**
- JWT auth, bcrypt password hashing (direct `bcrypt`, no passlib)
- Email-based OTP verification on signup, forgot-password flow, and email-change flow (via a dedicated email service)
- Profile management, including profile picture upload
- Groq API key never touches the frontend — all AI calls are proxied through `/api/chat` on the backend
- Admin panel is served from a randomly generated, private URL slug at deploy time — never a guessable path

**Monetization (live, not just planned)**
- Free trial (3 interviews), Weekly (₹99 / 7 days) and Monthly (₹299 / 30 days) paid plans
- **Razorpay payment integration (new)** — order creation, signature verification, webhook handling, and payment history, all server-side

**Admin Panel**
- Separate admin login and dashboard to manage users, interviews, questions, feedback, platform stats, visitor counts, payment/subscription records, and the government-domain allow-list

**Content & SEO**
- Blog with interview-prep guides (HR questions for freshers, UPSC/SSC personality test prep) and a dedicated FAQ page
- Custom favicon set, Open Graph/Twitter meta tags, canonical URLs, `robots.txt` + `sitemap.xml`, Google Search Console verification, mobile-responsive layout across all pages

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript |
| AI Interviewer | Groq API — `openai/gpt-oss-120b` |
| Speech | Web Speech API (STT) + browser TTS, 13 language/locale combinations |
| Face Detection | MediaPipe Face Detection |
| Backend | Python, FastAPI |
| Database | PostgreSQL (Neon) in production, SQLite fallback for local dev |
| Auth | JWT + bcrypt + email OTP |
| Payments | Razorpay (orders, signature verification, webhooks) |
| Email | Dedicated email service (OTP, password reset, email-change verification) |
| Deployment | Render (backend) + Vercel (frontend) |

## Project Structure

```
HireView/
├── index.html              # Landing page
├── auth.html                # Login / Signup
├── interview.html           # Interview screen (resume + JD upload, language/domain setup)
├── dashboard.html           # User dashboard
├── history.html             # Interview history
├── privacy.html             # Privacy policy
├── terms.html                # Terms of service
├── refund-policy.html        # Refund policy
├── faq.html                  # FAQ
├── blog/                     # Interview-prep articles
├── admin-template/
│   └── index.html            # Admin panel UI (renamed to a private slug at deploy time)
├── css/main.css
├── js/
│   ├── config.template.js    # Backend URL template, global state (no secrets)
│   ├── auth.js                # Login, signup, OTP, forgot/change password & email
│   ├── cheating.js            # Tab-switch + face-presence integrity detection
│   ├── interview.js           # Interview flow, resume/JD parsing, AI calls, speech, feedback
│   └── translate.js           # Multilingual UI strings
├── assets/                    # Avatar video, favicons, OG image
├── build.js                   # Vercel build step — injects config.js + renames admin folder
├── robots.txt / sitemap.xml   # SEO
├── render.yaml                # Render blueprint (backend)
├── vercel.json                 # Vercel static-site config (frontend)
└── hireview-backend/
    ├── main.py                # FastAPI app entry point
    ├── config.py               # Settings (reads env vars)
    ├── requirements.txt
    ├── Procfile
    ├── models/
    │   ├── database.py         # SQLAlchemy models
    │   ├── schemas.py            # Pydantic schemas
    │   ├── auth_utils.py         # bcrypt hashing + JWT
    │   └── otp_utils.py          # OTP generation/verification
    └── routes/
        ├── auth.py              # Register, login, /me, profile, OTP, password/email flows
        ├── interviews.py        # Interview CRUD, feedback, terminate/fail, /chat proxy
        ├── payments.py           # Razorpay order creation, verification, webhook, history
        ├── admin.py              # Admin auth, user/interview/question/feedback management
        ├── visits.py             # Visitor tracking/count
        └── email_Service.py      # Email sending (OTP, password reset, email change)
```

## Getting Started (Local Development)

**Prerequisites:** Python 3.11+, Node.js (for the frontend build step), a free [Groq API key](https://console.groq.com), and optionally a [Brevo](https://app.brevo.com) API key and Razorpay test keys if you want email/payment flows to work locally.

```bash
git clone https://github.com/AnmolPandey9119/HireView.git
cd HireView
```

### 1. Backend

```bash
cd hireview-backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # fill in GROQ_API_KEY, SECRET_KEY, and others as needed
python main.py                # runs on http://localhost:8000, docs at /docs
```

`DATABASE_URL` is optional locally — leave it unset and it falls back to a local SQLite file under `hireview-backend/database/`. In production it points at a managed Postgres instance.

### 2. Frontend

The real `js/config.js` is generated at deploy time by `build.js` and isn't committed to git, so for local dev you create it yourself from the template:

```bash
cd ..   # back to repo root
cp js/config.template.js js/config.js
```

Open `js/config.js` and replace `__BACKEND_URL__` with `http://localhost:8000`, then serve the folder as static files:

```bash
python -m http.server 5500
# or: npx serve .
```

Visit `http://localhost:5500/auth.html` to sign up / log in, `index.html` for the landing page, and `admin-template/index.html` for the admin panel (in production `build.js` renames this folder to a private random slug — locally the plain `admin-template/` path works fine).

**Note:** speech recognition and face detection require HTTPS or `localhost` — they won't work over `file://` or plain HTTP on a non-localhost address.

## Deploying

### 1. Backend → Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at this repo. It will read `render.yaml` and pre-fill everything (root dir, build/start commands, health check).
3. Set the required environment variables in the Render dashboard (Groq key, database URL, Razorpay keys, email service keys, frontend URL, etc.) — see `.env.example` for the full list.
4. Deploy. Confirm `https://<your-service>.onrender.com/api/health` returns `{"status":"ok"}`.

Any `*.vercel.app` origin is already allowed via CORS regex, so preview deployments work immediately — `FRONTEND_URL` is just for extra clarity/explicit allow-listing of your production domain.

### 2. Frontend → Vercel

1. In Vercel: **Add New → Project**, import this repo.
2. Framework preset: **Other** (it's a static multi-page site — `vercel.json` already tells Vercel not to run a build step).
3. Root directory: leave as repo root (the backend folder is excluded via `.vercelignore`).
4. Deploy — `build.js` handles injecting `config.js` and renaming the admin folder to a private slug.
5. If your Render backend URL ever changes, update `BACKEND_URL` via the env var and redeploy.

## API Overview

The backend exposes REST endpoints under `/api/` for auth & profile (OTP-based signup, login, password/email change), interviews (create, list, save Q&A/feedback, terminate/fail, history, the `/chat` Groq proxy), payments (Razorpay order creation, verification, webhook, history), admin (login, stats, user/interview/question/feedback management, government-domain allow-list), and visit tracking. Full interactive docs are available at `/docs` on the running backend (Swagger UI via FastAPI).

## Roadmap
- Confidence meter & eye contact scoring (MediaPipe FaceMesh)
- Personality & behavior detection (Vision AI)
- Deeper analytics on integrity/cheating trends for the admin panel

## Team

Built by a CSE team:
- **Anmol Pandey** — [GitHub](https://github.com/AnmolPandey9119) · [LinkedIn](https://www.linkedin.com/in/anmol-pandey-240105376)
- **Aryan Srivastava**
- **Prateek Tripathi**
- **Anshika Mishra**

## Contact

📧 [hireviewadmin@gmail.com](mailto:hireviewadmin@gmail.com)

## License

Proprietary — all rights reserved. Not licensed for reuse or redistribution without permission. See `LICENSE` for full terms.

---

HireView is currently in active development. Feedback and contributions welcome.