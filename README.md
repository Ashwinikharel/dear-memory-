---
title: Dear Memory
emoji: 📸
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 4000
pinned: false
---

# Dear Memory

> **Free version (no payment, no AWS):** in `server/.env` set `STORAGE=local` and `FACE_ENGINE=local`, then double-click **START-FREE.bat**. Photos stay on your computer, faces are matched by a free open-source model, and the tunnel window gives an https link for phones. Your computer must stay on while people use it.
>
> **Putting it online with AWS later (paid):** follow [GO-LIVE.md](GO-LIVE.md).

Secure, **view-only** event photo delivery.

Photographers upload photos from the camera → each team gets its own QR code → guests scan it, pass a live face check, and **see only the photos they appear in**. Guests can view, never download.

```
dear-memory/
├── server/            Node.js + Express API (SQLite, AWS S3, AWS Rekognition)
│   ├── src/
│   │   ├── index.js          start-up (admin seed, worker resume, retention timer)
│   │   ├── app.js            Express app, security headers, error handling
│   │   ├── config.js         all settings from .env
│   │   ├── db.js             database schema + audit log helper
│   │   ├── aws.js            S3 + Rekognition (and a local mock for testing)
│   │   ├── middleware/auth.js
│   │   ├── routes/           auth.js (staff), events.js (events/teams/QR/photos), guest.js
│   │   └── services/         faceWorker.js, images.js (watermark), matching.js, selfie.js, purge.js
│   ├── tools/watch-upload.js camera folder → website auto-uploader
│   └── test/                 unit + end-to-end tests
├── client/            React (Vite) frontend — also an installable phone app (PWA)
├── mobile/            Android / iPhone app (Capacitor) that opens the live site
├── Dockerfile         builds website + API into one container
└── render.yaml        one-click Render.com setup
    └── src/
        ├── pages/            Login, Dashboard, EventPage, Users, Audit, Account, Guest
        └── components/       PhotoUploader, TeamPhotos, SelfieCamera, LivenessCheck, SecureCanvas
```

---

## 1. Run it on your computer (test mode, no AWS needed)

You need **Node.js 22.13 or newer** (`node -v`). Node 24 LTS is recommended. No Python or C++ tools are needed.

```bash
# Terminal 1 - API
cd server
npm install
cp .env.example .env          # Windows: copy .env.example .env
```

Edit `server/.env` and set:

```
AWS_MOCK=1
JWT_SECRET=<paste a long random string>
```

Make a random secret with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

```bash
npm run dev                    # API on http://localhost:4000
npm test                       # runs the unit + end-to-end tests
```

```bash
# Terminal 2 - website
cd client
npm install
npm run dev                    # open http://localhost:5173
```

Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`, then change the password on the **Account** page.

> **Mock mode** stores photos in `server/data/mock-storage` and *pretends* to match faces (every guest sees all of their team's photos). It is only for trying out the screens. It refuses to start when `NODE_ENV=production`.

**Using it on a phone:** phones only allow the selfie camera on `https://` links, so start a free tunnel in a third terminal:

```bash
winget install --id Cloudflare.cloudflared      # once (Windows). Restart VS Code afterwards.
cloudflared tunnel --url http://localhost:5173  # prints https://<random>.trycloudflare.com
```

Open that https link (on your computer or phone) and log in. While `PUBLIC_APP_URL` is a localhost address, QR codes and guest links automatically use whatever address you opened the dashboard with, so the QR codes now point to the https link and work when scanned with any phone. Each team also has **Copy guest link** / **Open guest page** buttons. The tunnel link changes every time you restart it; for real events, deploy to your own domain and set `PUBLIC_APP_URL` to it.

---

## 2. Set up AWS (real face matching)

Pick one region for everything. `ap-south-1` (Mumbai) is closest to Nepal and supports Face Liveness — check the AWS docs to confirm Face Liveness availability for your region.

### a) S3 bucket
1. S3 → **Create bucket**, e.g. `dear-memory-photos`. Keep **Block all public access ON**.
2. Default encryption: SSE-S3 (the app also requests encryption on every upload).

### b) IAM user or role for the server
Create a policy with this JSON (replace the bucket name), attach it to an IAM role (EC2/ECS/Lightsail) or an IAM user whose keys go into `.env`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::dear-memory-photos/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateCollection", "rekognition:DeleteCollection",
        "rekognition:IndexFaces", "rekognition:SearchFacesByImage", "rekognition:DeleteFaces",
        "rekognition:DetectFaces",
        "rekognition:CreateFaceLivenessSession", "rekognition:GetFaceLivenessSessionResults"
      ],
      "Resource": "*"
    }
  ]
}
```

### c) server/.env
```
AWS_MOCK=0
AWS_REGION=ap-south-1
S3_BUCKET=dear-memory-photos
AWS_ACCESS_KEY_ID=...        # leave empty if the server has an IAM role
AWS_SECRET_ACCESS_KEY=...
LIVENESS_MODE=basic          # start with basic, switch to aws after step d
```

### d) Face Liveness (strongly recommended before real events)
`LIVENESS_MODE=basic` only checks selfie quality — a printed photo of someone could pass. `LIVENESS_MODE=aws` uses **Rekognition Face Liveness** (the guest follows a short on-screen light/face-movement check), which blocks printed photos, screens and videos.

1. **Cognito → Identity pools → Create identity pool**, enable **Guest access**.
2. Give the pool's *guest (unauthenticated) role* this policy:
   ```json
   { "Version": "2012-10-17", "Statement": [
     { "Effect": "Allow", "Action": "rekognition:StartFaceLivenessSession", "Resource": "*" } ] }
   ```
3. `client/.env` (copy from `client/.env.example`):
   ```
   VITE_AWS_REGION=ap-south-1
   VITE_COGNITO_IDENTITY_POOL_ID=ap-south-1:xxxxxxxx-xxxx-...
   ```
4. `server/.env`: `LIVENESS_MODE=aws`, then rebuild the client.

The server creates each liveness session, checks the result itself (confidence ≥ `LIVENESS_MIN_CONFIDENCE`), allows each session only once, and searches with the verified reference image — the browser can't fake a pass.

---

## 3. Camera → website

* **From the dashboard:** open an event, drag photos onto a team. Uploads go in batches with progress and automatic retries; failed files get a "Retry" button.
* **Straight from the camera (live during the event):** set your tethering software (Lightroom, Capture One, EOS Utility, Nikon Webcam Utility) or a Wi-Fi SD card (FlashAir, ez Share) to save into a folder on a laptop, then run:

  ```bash
  cd server
  # macOS/Linux
  DM_PASSWORD='your-password' node tools/watch-upload.js --api https://your-site.com --email you@example.com --team <teamId> --folder ~/Camera
  # Windows PowerShell
  $env:DM_PASSWORD='your-password'; node tools/watch-upload.js --api https://your-site.com --email you@example.com --team <teamId> --folder C:\Camera
  ```
  The team ID is shown on each team card in the event page. Every new JPEG/PNG is uploaded within seconds; already-uploaded files are remembered.

---

## 4. Deploy

```bash
cd client && npm install && npm run build      # creates client/dist
cd ../server && npm install --omit=dev
NODE_ENV=production npm start                  # serves the API and the website on PORT
```

* Put it behind **HTTPS** (Nginx/Caddy, or a platform like Render/Railway/Lightsail). The camera will not open on plain http.
* Set `PUBLIC_APP_URL` and `CORS_ORIGIN` to your real https domain **before** printing QR codes.
* Keep `server/data/` (the SQLite database) on a persistent disk and back it up.
* For very large events, run several servers and move the photo queue to Redis/BullMQ — `processPhoto()` in `services/faceWorker.js` can be reused as-is.

---

## 5. How the security works

| Requirement | How it's done |
|---|---|
| Unique QR per team | 192-bit random token per team (`/t/<token>`); can expire, be turned off, or be replaced (old one stops working) |
| Only your own photos | Your face is searched in the event's Rekognition collection; results are filtered to **your team's** photos only, above `FACE_MATCH_THRESHOLD` (default 95%) |
| Real person, not a photo | AWS Face Liveness (`LIVENESS_MODE=aws`), one-time sessions checked server-side |
| Brute force | 5 verification attempts per 10 minutes per IP; 10 login attempts per 15 minutes |
| View-only | Guests only ever receive a 1280px, watermarked, EXIF-stripped preview. Originals are staff-only. No download/share buttons |
| No image links to copy | Images are fetched with the guest session token and drawn on `<canvas>` (no `<img>` URL, no "Save image"); responses are `no-store` |
| Extra deterrents | Right-click, long-press, drag, select, Ctrl+S/P blocked; photos blur when the app is in the background; printing hides the page |
| Short sessions | Guest session lasts `GUEST_SESSION_MINUTES` (30) and ends when the page is closed or "Done" is pressed |
| Selfie privacy | Selfie is processed in memory and discarded — never written to disk or S3 |
| Data retention | Face data auto-deleted `RETENTION_DAYS` after the event ends; "Delete event" wipes everything; guests can tap "Delete my face data" |
| Staff accounts | bcrypt passwords, JWT, admin vs photographer roles, photographers only see their own events |
| Audit trail | Logins, uploads, QR changes, verifications, deletions and every guest photo view are logged (Activity log page) |

**Be honest with your users:** no website can stop someone photographing the screen with another phone or taking a screenshot. The visible "Dear Memory · event name" watermark on every image is your protection there.

**Legal note:** face data is biometric data and is regulated in many places. Keep the consent screen, show your own privacy policy, and only index photos from events where you have permission. Check the rules that apply in your country.

---

## 6. API overview

Staff (Bearer token from `/api/auth/login`):

| Method | Path | |
|---|---|---|
| POST | `/api/auth/login` | email + password → token |
| GET | `/api/auth/me` · POST `/api/auth/password` | current user · change password |
| GET/POST/DELETE | `/api/users` (admin) | photographer accounts |
| GET/POST | `/api/events` | list / create |
| GET/PATCH/DELETE | `/api/events/:id` | details with teams / edit / delete everything |
| GET | `/api/events/:id/stats` | counts + processing queue |
| POST | `/api/events/:id/teams` | add team (creates its QR) |
| DELETE | `/api/teams/:id` | delete team, photos, faces |
| GET | `/api/teams/:id/qr?format=png\|svg&download=1` | QR image |
| POST | `/api/teams/:id/qr/regenerate` | new QR (old one stops working) |
| PATCH | `/api/teams/:id/qr` | `{ disabled, expiresAt }` |
| GET/POST | `/api/teams/:id/photos` | list / upload (`photos` field, up to 20 per request) |
| GET | `/api/photos/:id/preview` · `/original` | staff preview / original |
| POST | `/api/photos/:id/retry` · DELETE `/api/photos/:id` | |
| GET | `/api/admin/overview`, `/api/audit` (admin) | dashboard numbers, activity log |

Guest:

| Method | Path | |
|---|---|---|
| GET | `/api/guest/teams/:token` | check QR, get event/team name |
| POST | `/api/guest/liveness-session` | `{ token }` → liveness session (aws mode) |
| POST | `/api/guest/verify` | multipart: `token`, `consent=true`, `selfie` *or* `livenessSessionId` → guest token |
| GET | `/api/guest/photos` | the guest's matched photos |
| GET | `/api/guest/photos/:id/image` | watermarked preview (view only) |
| POST | `/api/guest/logout` · `/api/guest/forget-me` | end session · delete my face data |
