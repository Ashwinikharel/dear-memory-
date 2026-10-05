# Dear Memory — Go Live Guide

This guide puts Dear Memory on the internet so it works for real people, on **laptops and phones**, for **photographers and guests**, and as an **app** on Android and iPhone.

When you finish you will have:

* One secure web address, e.g. `https://dear-memory.onrender.com`, that works on any laptop or phone
* Real face matching with AWS (photos stored privately in S3)
* An installable phone app (Android and iPhone "Add to Home Screen")
* An Android app (APK) you can install or publish on Google Play
* Optional: an iPhone app for the App Store (needs a Mac)

**Costs (approximate, check the providers' pricing pages):**
Render "Starter" server with a disk is about US$7–8 per month. AWS S3 storage and Rekognition face matching cost little for small events (often a few dollars per event), but Face Liveness checks are charged per check. Set a **billing alert** in AWS (Billing → Budgets) so there are no surprises.

---

## Step 1 — Put the code on GitHub

Render takes your code from GitHub.

1. Create a free account at **github.com**.
2. Install **GitHub Desktop** (desktop.github.com) and sign in.
3. GitHub Desktop → **File → Add local repository** → choose your `dear-memory` folder
   (the one containing `server`, `client`, `mobile`, `Dockerfile`). If it says it's not a repository, click **create a repository** there.
4. Click **Publish repository**. Keep **"Keep this code private"** ticked.

> Your `.env` file and `node_modules` are not uploaded (they're in `.gitignore`). That's correct — passwords and keys never go to GitHub.

---

## Step 2 — Set up AWS (photos + face matching)

1. Create an account at **aws.amazon.com** (needs a card). Sign in to the **AWS Console**.
2. Top-right region selector: choose **Asia Pacific (Mumbai) ap-south-1**.
3. **S3 → Create bucket**
   * Name: something unique, e.g. `dear-memory-photos-ashwini`
   * Region: ap-south-1
   * Keep **Block all public access** ON → **Create bucket**
4. **IAM → Policies → Create policy → JSON**, paste the policy from `README.md` section 2b (replace the bucket name with yours) → name it `DearMemoryServer`.
5. **IAM → Users → Create user** named `dear-memory-server` → **Attach policies directly** → tick `DearMemoryServer` → create.
6. Open the user → **Security credentials → Create access key** → choose **"Application running outside AWS"** → copy the **Access key ID** and **Secret access key**. Keep them private; you'll paste them into Render.

---

## Step 3 — Deploy on Render

1. Create an account at **render.com** (sign in with GitHub).
2. **New + → Blueprint** → choose your `dear-memory` repository. Render reads `render.yaml`.
3. Render asks for these values:

   | Name | What to enter |
   |---|---|
   | `ADMIN_EMAIL` | your email (your first admin login) |
   | `ADMIN_PASSWORD` | a strong password, 10+ characters |
   | `S3_BUCKET` | your bucket name from Step 2 |
   | `AWS_ACCESS_KEY_ID` | from Step 2.6 |
   | `AWS_SECRET_ACCESS_KEY` | from Step 2.6 |
   | `VITE_COGNITO_IDENTITY_POOL_ID` | leave empty for now (Step 6) |
   | `PUBLIC_APP_URL` | leave empty (it uses your onrender.com address automatically) |

4. Click **Apply**. The first build takes about 5–10 minutes. When it says **Live**, your address is shown at the top, like `https://dear-memory-xxxx.onrender.com`.

---

## Step 4 — First login

1. Open your Render address on your laptop. You'll see the Dear Memory start screen.
2. **I'm a photographer** → log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. Go to **Account** → change your password.
4. **Photographers** → add an account for each photographer.

---

## Step 5 — Test on laptop and phone

1. Create an event → add a team → upload a few photos (including ones with your face). Wait until they show **done** and a face count.
2. On your **phone**, scan the team's QR code with the normal camera app → it opens the guest page.
3. Accept → take a selfie → you should see **only the photos you're in**, view-only.

**Install it on the phone like an app:**
* **Android (Chrome):** open your site → tap **Install Dear Memory** on the start screen (or menu ⋮ → **Install app**).
* **iPhone (Safari):** open your site → **Share** → **Add to Home Screen**.

The icon opens the app full-screen. Guests can tap **I'm a guest → Scan** to scan QR codes inside the app.

---

## Step 6 — Turn on Face Liveness (do this before real events)

Without this, someone could hold up a printed photo of another person. Follow `README.md` section 2d (Cognito identity pool + one permission), then in Render → your service → **Environment**:

* `LIVENESS_MODE` = `aws`
* `VITE_COGNITO_IDENTITY_POOL_ID` = your identity pool ID

Save → Render rebuilds automatically. Test again on your phone: guests now follow a short on-screen face check.

---

## Step 7 — Your own domain (optional)

Buy a domain (e.g. from Namecheap or a Nepali registrar), then Render → service → **Settings → Custom Domains → Add**, and follow the DNS instructions. HTTPS is automatic.
Then set `PUBLIC_APP_URL` = `https://your-domain` in Render **before printing QR codes** (QR codes contain the address).

---

## Step 8 — Android app (APK / Google Play)

The app opens your live website inside a real Android app, so every update you deploy appears in the app automatically.

1. Install **Android Studio** (developer.android.com/studio). Open it once so it finishes downloading the Android SDK.
2. In a terminal:
   ```
   cd dear-memory\mobile
   npm install
   npm run set-url -- https://YOUR-ADDRESS.onrender.com
   npm run add:android
   npm run open:android
   ```
3. Android Studio opens. Wait for "Gradle sync" to finish.
   * **Test on your phone:** enable *Developer options → USB debugging* on the phone, plug it in, press the green ▶ Run button.
   * **Make an APK to share:** **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
   * **Google Play:** **Build → Generate Signed App Bundle**, then upload to the Play Console (one-time US$25 developer fee).
4. After changing the address later: `npm run set-url -- https://new-address` then `npm run sync`.

## Step 9 — iPhone app (App Store)

You need a **Mac with Xcode** and an **Apple Developer account (US$99/year)**.
```
cd dear-memory/mobile
npm install
npm run set-url -- https://YOUR-ADDRESS.onrender.com
npm run add:ios
npm run open:ios
```
In Xcode choose your team under *Signing & Capabilities*, then Run on an iPhone, or *Product → Archive* to upload.

> **Honest note:** Apple often rejects apps that are mainly a website inside an app. For iPhones, **Add to Home Screen** (Step 5) gives guests the same full-screen app experience today, with no App Store review. Publish to the App Store later if you add iPhone-specific features.

---

## Updating the website later

Change code on your laptop → GitHub Desktop → **Commit** → **Push**. Render rebuilds and goes live automatically in a few minutes. The installed phone apps update too (they load the live site).

## Before a real event — checklist

- [ ] `LIVENESS_MODE=aws` is on and tested on a phone
- [ ] Your own domain set in `PUBLIC_APP_URL` (if you have one) **before** printing QR codes
- [ ] Each team's QR printed from **Download PNG** and test-scanned
- [ ] Admin password changed; each photographer has their own account
- [ ] AWS billing alert set
- [ ] A privacy notice for guests (face data = biometric data; follow the laws that apply to you)
- [ ] Render disk backup: Render → Disk → **Snapshots** are kept automatically; check they exist
