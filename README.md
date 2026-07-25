# HireView — AI Mock Interview Platform

**Practice Like It's Real. Perform Like a Pro.**

🔗 **Live:** [hireview-ai.vercel.app](https://hireview-ai.vercel.app)

HireView is an AI-powered mock interview platform built for Indian job seekers. It conducts real, adaptive interviews using a conversational AI interviewer named Arjun, provides detailed feedback, and detects cheating using computer vision and behavioral signals.

## Why HireView

Most job seekers in India walk into interviews having never practiced one in a realistic setting — friends and family can't simulate real interview pressure, and generic question banks don't adapt to *your* resume or push back on vague answers. HireView fixes that: an AI interviewer that reads your resume, asks follow-up questions the way a real recruiter would, scores your performance honestly, and flags integrity issues the same way a proctored exam would — so practice actually prepares you for the real thing.

## Features

**Interview Experience**
- AI Interviewer (Arjun) — powered by Groq (`openai/gpt-oss-120b`), structured Introduction → Basic → Deep Dive flow
- Voice-first — Arjun speaks questions aloud (browser TTS), candidate responds by speaking or typing
- Resume-aware — questions tailored to the candidate's actual resume (PDF/TXT upload)
- Adaptive difficulty, cross-questioning on vague answers, English + Hinglish support
- Regional/multilingual interview flow for the Government Sector track, gated by an admin-managed list of government domains
- Back-to-home navigation on the interview screen

**Integrity Detection**
- Tab switch detection, MediaPipe multi-face detection (HTTPS only), response-timing analysis, full integrity report per session
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

**Monetization**
- Free trial (3 interviews) plus a paid Practice Pack tier and a custom Institute/B2B tier; subscription fields tracked per user

**Admin Panel**
- Separate admin login and dashboard (`admin-template/`) to manage users, interviews, questions, feedback, platform stats, visitor counts, and the government-domain allow-list

**Polish / SEO**
- Custom favicon set, Open Graph/Twitter meta tags, canonical URLs, `robots.txt` + `sitemap.xml`, Google Search Console verification, mobile-responsive layout across all pages

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript |
| AI Interviewer | Groq API — `openai/gpt-oss-120b` |
| Speech | Web Speech API (STT) + browser TTS |
| Face Detection | MediaPipe Face Detection |
| Backend | Python, FastAPI |
| Database | SQLite (swap `DATABASE_URL` for Postgres in production if you outgrow SQLite on Render's free tier) |
| Auth | JWT + bcrypt + email OTP |
| Email | Dedicated email service (OTP, password reset, email-change verification) |
| Deployment | Render (backend) + Vercel (frontend) |

## Project Structure

```
HireView/
├── index.html            # Landing page
├── auth.html              # Login / Signup
├── interview.html         # Interview screen
├── dashboard.html         # User dashboard
├── history.html           # Interview history
├── privacy.html            # Privacy policy
├── admin-template/
│   └── index.html          # Admin panel UI
├── css/main.css
├── js/
│   ├── config.template.js  # Backend URL template, global state (no secrets)
│   ├── auth.js              # Login, signup, OTP, forgot/change password & email
│   ├── cheating.js          # Integrity detection
│   └── interview.js         # Interview flow, AI calls, speech, feedback
├── assets/                  # avatar video, favicons, OG image
├── build.js                 # Vercel build step (injects config.js from env)
├── robots.txt / sitemap.xml # SEO
├── render.yaml              # Render blueprint (backend)
├── vercel.json               # Vercel static-site config (frontend)
└── hireview-backend/
    ├── main.py              # FastAPI app entry point
    ├── config.py             # Settings (reads env vars)
    ├── requirements.txt
    ├── Procfile
    ├── models/
    │   ├── __init__.py
    │   ├── database.py       # SQLAlchemy models
    │   ├── schemas.py         # Pydantic schemas
    │   ├── auth_utils.py      # bcrypt hashing + JWT
    │   └── otp_utils.py       # OTP generation/verification
    └── routes/
        ├── auth.py            # Register, login, /me, profile, OTP, password/email flows
        ├── interviews.py      # Interview CRUD, feedback, terminate/fail, /chat proxy
        ├── admin.py           # Admin auth, user/interview/question/feedback management
        ├── visits.py          # Visitor tracking/count
        └── email_Service.py   # Email sending (OTP, password reset, email change)
```

## Getting Started (Local Development)

**Prerequisites:** Python 3.11+, Node.js (for the frontend build step), a free [Groq API key](https://console.groq.com), and optionally a [Brevo](https://app.brevo.com) API key if you want OTP/password-reset emails to actually send locally.

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
cp .env.example .env          # fill in GROQ_API_KEY, SECRET_KEY (and BREVO_* if testing email)
python main.py                # runs on http://localhost:8000, docs at /docs
```

`DATABASE_URL` is optional — leave it unset and it falls back to a local SQLite file under `hireview-backend/database/`.

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
3. Set these environment variables in the Render dashboard:
   - `GROQ_API_KEY` — your Groq key (get one at console.groq.com)
   - `FRONTEND_URL` — set this **after** step 2 below, once you know your Vercel URL (e.g. `https://hireview-anmol.vercel.app`)
   - `SECRET_KEY` is auto-generated by the blueprint — leave it as is.
4. Deploy. Confirm `https://<your-service>.onrender.com/api/health` returns `{"status":"ok"}`.

Note: any `*.vercel.app` origin is already allowed via CORS regex, so preview deployments work immediately — `FRONTEND_URL` is just for extra clarity/explicit allow-listing of your production domain.

### 2. Frontend → Vercel

1. In Vercel: **Add New → Project**, import this repo.
2. Framework preset: **Other** (it's a static multi-page site — `vercel.json` already tells Vercel not to run a build step).
3. Root directory: leave as repo root (the backend folder is excluded via `.vercelignore`).
4. Deploy.
5. If your Render backend URL ever changes, update `BACKEND_URL` in `js/config.js` and redeploy.

## API Endpoints

**Auth & Profile**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/send-email-otp` | Send signup email OTP |
| POST | `/api/auth/verify-email-otp` | Verify signup email OTP |
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/forgot-password/request` | Request password reset |
| POST | `/api/auth/forgot-password/reset` | Reset password |
| GET | `/api/auth/me` | Current user |
| PUT | `/api/auth/profile` | Update profile (incl. profile picture) |
| POST | `/api/auth/change-password` | Change password |
| POST | `/api/auth/change-email/request` | Request email change |
| POST | `/api/auth/change-email/verify` | Verify new email |

**Interviews**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/interviews` | Start interview |
| GET | `/api/interviews` | List interviews |
| GET | `/api/interviews/{id}` | Interview detail |
| POST | `/api/interviews/{id}/questions` | Save Q&A |
| POST | `/api/interviews/{id}/feedback` | Save feedback |
| POST | `/api/interviews/{id}/fail` | Mark as failed |
| POST | `/api/interviews/{id}/terminate` | Mark as cheating-terminated |
| DELETE | `/api/interviews/cleanup` | Purge stale in-progress interviews (7+ days old) |
| GET | `/api/dashboard` | User stats |
| GET | `/api/history` | Interview history |
| POST | `/api/chat` | Groq proxy (auth required, key stays server-side) |

**Admin**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/admin/login` | Admin login |
| GET | `/api/admin/stats` | Platform stats |
| GET | `/api/admin/government-domains` | Government-domain allow-list |
| GET/PUT/DELETE | `/api/admin/users/{id}` | Manage a user |
| GET/PUT/DELETE | `/api/admin/interviews/{id}` | Manage an interview |
| PUT/DELETE | `/api/admin/questions/{id}` | Manage a question |
| PUT/DELETE | `/api/admin/feedback/{id}` | Manage feedback |

**Visits**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/visits/track` | Record a site visit |
| GET | `/api/visits/count` | Get visitor count |

## Roadmap
- Confidence meter & eye contact scoring (MediaPipe FaceMesh)
- Personality & behavior detection (Vision AI)
- Expanded regional language support (Hindi, Bengali, Tamil, Telugu)
- Razorpay payment integration

## Team

Built by a 4-person CSE team:
- **Anmol Pandey** — [GitHub](https://github.com/AnmolPandey9119) · [LinkedIn](https://www.linkedin.com/in/anmol-pandey-240105376)
- **Aryan Srivastava**
- **Prateek Tripathi**
- **Anshika Mishra**

## Contact

📧 [hireviewadmin@gmail.com](mailto:hireviewadmin@gmail.com)

## License

Proprietary — all rights reserved. Not licensed for reuse or redistribution without permission.

---

HireView is currently in active development. Feedback and contributions welcome.