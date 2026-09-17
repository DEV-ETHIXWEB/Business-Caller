# Business Caller

A simple website where your employees each sign in with their own username
and password, type a phone number, click **Call**, and talk to the client
through their laptop's microphone — using their own Twilio number as the
caller ID. No SIM card needed.

This is one shared dialer app serving multiple people. Amar signs in and
gets `+1 (206) 452-3433` as his caller ID; Prateek signs in (same URL) and
gets `+1 (872) 278-4999`; Yash signs in and gets `+1 (720) 783-2385`. Each
person's calls, texts, Phone Book, and Face ID/Touch ID devices are kept
separate from everyone else's.

This guide assumes you have never used Next.js, Twilio, or Vercel before.
Follow it top to bottom.

## What's already done

- [x] Twilio API Key created ("Business Caller", Standard)
- [x] Twilio TwiML App created ("Business Caller")
- [x] All the application code (this repository)
- [ ] Auth Token added to your local `.env.local`
- [ ] Deployed to Vercel
- [ ] TwiML App's Voice Request URL pointed at the live Vercel URL

## How it works, in plain terms

1. Someone opens the website and enters their username and password (set in
   `APP_USERS`, see below) to unlock the dialer.
2. They type a client's phone number and click **Call**.
3. Their browser talks to Twilio directly using the Twilio Voice SDK.
4. Twilio asks *this app's* server ("`/api/voice`") how to handle the call.
   The server checks the request is genuinely from Twilio, works out which
   signed-in person is calling, checks the number is valid, and tells
   Twilio: "dial this number, show *that person's own number* as the caller
   ID."
5. Twilio dials the client. The caller talks through their laptop
   mic/speakers.

Everyone shares the same TwiML App and Voice Request URL — nothing in
Twilio Console needs to be configured per person, only the phone number
itself needs Voice enabled. Your existing setup — the Twilio number
forwarding incoming calls to India — is a completely separate configuration
and is never touched by this app.

## 1. Install and configure for local testing

```bash
npm install
```

Open `.env.local` in this project (already partly filled in for you) and
add the one remaining value:

- **`TWILIO_AUTH_TOKEN`** — in the [Twilio Console](https://console.twilio.com),
  go to **Settings → Account settings → Account details & security**, and
  click **View** next to **Auth Token**. Copy it in.

Leave `PUBLIC_BASE_URL` empty for now — you'll fill that in after
deploying (Section 3).

The full, current list of variables and what each one is for is in
[`.env.example`](.env.example).

## 2. Run it locally

```bash
npm run dev
```

Open `http://localhost:3000`. You'll see the lock screen — enter one of the
username/password pairs from `APP_USERS` in `.env.local`. You can fully test
the lock screen, the dialer UI, and the microphone prompt this way.

**You cannot place a real call from `localhost`** — Twilio needs to reach
`/api/voice` over the public internet, and your laptop isn't on the public
internet. Real call testing happens after deploying to Vercel (next
section). If you want to test locally anyway, run a tunnel:

```bash
npx ngrok http 3000
```

then set `PUBLIC_BASE_URL` to the `https://...ngrok...` address it gives
you, and temporarily point the TwiML App's Voice Request URL at
`https://...ngrok.../api/voice` (Twilio Console → Voice → Manage → TwiML
Apps → Business Caller). Switch it back to your real Vercel URL once
you've deployed.

## 3. Deploy to Vercel

No config file needed — just:

1. Push this repository to GitHub (already set up as `origin` — see the
   chat for the exact commands used, or run `git push origin main` once
   you're authenticated).
2. Go to [vercel.com/new](https://vercel.com/new), click **Import** next
   to the `Business-Caller` GitHub repo. Vercel auto-detects Next.js —
   don't change any build settings.
3. Before clicking **Deploy**, expand **Environment Variables** and add
   every variable from [`.env.example`](.env.example) with its real value
   (same values as your local `.env.local`, except see step 4 below for
   `PUBLIC_BASE_URL`). Apply them to the **Production** environment at
   minimum.
4. Click **Deploy**. When it finishes, Vercel shows you a URL like
   `https://business-caller-xxxx.vercel.app` (or a cleaner one if you
   assign a custom domain later). Go back into **Project Settings →
   Environment Variables**, set `PUBLIC_BASE_URL` to that exact URL (no
   trailing slash), and redeploy so it takes effect.

## 4. Point Twilio at the live URL

**Do this only after Vercel is live and `PUBLIC_BASE_URL` is set to match.**

Twilio Console → **Voice → Manage → TwiML Apps → Business Caller** →
under **Voice Configuration**, set:

- **REQUEST URL**: `https://<your-vercel-domain>/api/voice`
- Method: **HTTP POST**

Click **Save**.

## 5. Test a real call

1. Open the deployed URL, sign in with a username/password from `APP_USERS`,
   allow the microphone prompt.
2. Type a real number you can answer, in international format (e.g.
   `+919876543210` or `+12065551234`), click **Call**.
3. It should ring, and the caller ID should show that user's own number
   (e.g. Amar's calls show `+1 (206) 452-3433`, Prateek's show
   `+1 (872) 278-4999`).
4. If it doesn't work, check **Twilio Console → Monitor → Logs → Calls**
   and **Errors** for the specific reason — the most common first-time
   issues are the Request URL not matching `PUBLIC_BASE_URL` exactly, or
   the destination country being blocked under **Voice → Settings → Geo
   Permissions**.

## 6. Give each person their login

Send each person the same Vercel URL plus their own username/password from
`APP_USERS`. That's all they need — no installs, no SIM card, just a laptop
with a mic and a browser. Nobody needs to know anyone else's credentials;
each login only ever sees its own number's calls, texts, and Phone Book.

**Note on SMS for the two new numbers:** `+18722784999` and `+17207832385`
currently show "Messaging disabled — Complete A2P registration" in Twilio
Console. Voice/calling works immediately once `APP_USERS` is deployed, but
sending SMS from those two numbers will fail with a Twilio error until A2P
10DLC registration is completed for them — that's a Twilio Console/
compliance step, not something this app's code can work around.

## Extra features

- **Stays signed in for 14 days** — unlocking (password or Face ID/Touch
  ID) is remembered in the browser for 14 days, refreshed every time the
  app is opened while still valid. So in practice, opening it at least
  once every 14 days keeps it signed in indefinitely; leave it untouched
  longer than that and it asks to unlock again. Click **Sign out** to end
  the session immediately regardless of this.
- **Microphone / speaker picker** — appears above the phone number field.
  Bluetooth headsets show up automatically once paired with the OS; no
  extra setup.
- **Mute + keypad** — appear once a call connects, for muting and for
  entering digits into an IVR.
- **Phone Book** — contacts are stored server-side in a per-person Twilio
  Sync Document (see `TWILIO_SYNC_SERVICE_SID` below), so each person's list
  shows up on every device they unlock the dialer from — add one on a
  laptop, it's there on the phone too — without being visible to anyone
  else signed in with a different login.
- **Messages/SMS** — an inbox-style list of every past conversation
  (pulled from Twilio's real message history, most recent first), tap one
  to open the full thread with a back button to return to the list, or
  type a new number to start a fresh conversation. Threads poll
  `/api/messages` every 5 seconds, which reads Twilio's actual Message
  history for that number (Twilio records every inbound and outbound SMS
  on the account automatically, regardless of any webhook), so a client's
  reply shows up on its own — nothing to configure for that part. If a
  number matches a saved contact, their name shows instead of the raw
  number.
- **On desktop**, Messages and Phone Book sit as permanent side panels.
  **On mobile**, tap the ☰ menu (top-left) to open them in a slide-in
  drawer with tabs — full functionality, just tucked away since there's
  no spare screen width.
- **Deleting messages/conversations** — the small trash icon on a
  conversation row or on an individual message deletes it. This calls
  Twilio's own delete on the Message resource, so it's a real, permanent
  removal from Twilio's records (not just hidden in this UI) — there's a
  confirmation prompt first since it can't be undone.
- Sending SMS requires **SMS capability enabled** (and, for a new number,
  A2P 10DLC registration completed) on that person's own number in the
  Twilio Console — if it's off or unregistered, sends fail with a clear
  error. No extra env vars needed; `/api/sms` and `/api/messages` reuse the
  same credentials as everything else, just scoped to whichever number the
  signed-in user owns.
- **App icon** — a custom icon (a phone glyph on the same near-black/crimson
  brand gradient) is wired up for the browser tab, iOS/Android "Add to
  Home Screen," and Chrome's install prompt. Installed from the home
  screen, it opens full-screen with no browser address bar, like a real
  app.
- **Face ID / Touch ID / Windows Hello** — on a browser and device that
  supports a platform authenticator, the lock screen offers "Unlock with
  Face ID / Touch ID" as an alternative to typing the password every time.
  This is real WebAuthn (passkey) authentication via
  `@simplewebauthn/server` and `@simplewebauthn/browser` — not a password
  autofill shim:
  - **Setup**: sign in normally with username + password once, then click
    **"+ Add this device"** near the bottom of the dialer card. That
    registers a credential tied to this specific browser/device's secure
    enclave, for that specific username.
  - **After that**: enter your username on the lock screen, and the Face
    ID/Touch ID button appears above the password field as a shortcut.
  - **Under the hood**: registering a new credential still requires the
    real username and password (so a stranger who finds the URL can't
    register their own face as a backdoor onto someone else's number).
    Signing in with a registered credential does not — the verified
    biometric signature itself is the proof, and on success the server
    hands back that user's real username and password, which the app then
    uses exactly as if they had been typed.
  - **Managing devices**: the same "Face ID / Touch ID" section lists every
    device registered to the signed-in user, with a remove button, in case
    a device is lost or no longer used.
  - Credentials are stored in the same Twilio Sync Service as the Phone
    Book, one document per username (`webauthn_<username>`) — no new env
    vars, and one person's devices are never visible to another.

### Heads up: Twilio's default SMS auto-reply

Your number currently has **no messaging webhook configured**, so Twilio
auto-sends its generic fallback reply ("Thanks for the message... Reply
HELP for help...") to every inbound text — this happens outside of and
regardless of this app. If you don't want clients receiving that canned
reply, go to Twilio Console → **Phone Numbers → your number → Messaging**
and either point the "A message comes in" webhook at a URL that returns
empty TwiML, or clear whatever's causing the fallback. This app doesn't
touch that setting — it wasn't asked to — but it's worth knowing about
since it's live right now.

## Environment variables reference

| Variable | Where it comes from | Secret? |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Console home page / Account Info | No, but keep private |
| `TWILIO_API_KEY_SID` | The "Business Caller" API Key you created | No, but keep private |
| `TWILIO_API_KEY_SECRET` | Shown once when the API Key was created | **Yes** |
| `TWILIO_AUTH_TOKEN` | Console → Settings → Account settings → Account details & security | **Yes** |
| `TWILIO_TWIML_APP_SID` | The "Business Caller" TwiML App you created | No, but keep private |
| `TWILIO_SYNC_SERVICE_SID` | A Sync Service (Console → Explore Products → Sync → Services), used to store each person's Phone Book and Face ID/Touch ID credentials | No, but keep private |
| `APP_USERS` | A JSON array, one entry per person: `[{"username":"amar","password":"...","phoneNumber":"+12064523433","label":"Amar"}, ...]`. Each `phoneNumber` must be a Voice-enabled Twilio number on your account | **Yes** |
| `PUBLIC_BASE_URL` | Your deployed Vercel URL, no trailing slash | No |

**Never** commit `.env.local` (it already can't be — see `.gitignore`), put
any of the "Yes" rows in frontend code, or paste them anywhere public.

## Project layout

```
app/
  page.tsx                 Renders the dialer
  layout.tsx
  components/Dialer.tsx    All dialer/phonebook/messaging UI + Twilio Device logic (client-side)
  api/token/route.ts       Mints Twilio Access Tokens for the signed-in user (server-side, gated by APP_USERS)
  api/voice/route.ts       TwiML webhook Twilio calls to place the outbound leg; resolves caller ID from the caller's identity
  api/sms/route.ts         Sends outbound SMS via the Twilio REST API, from the signed-in user's own number
  api/messages/route.ts    Reads/deletes one conversation's message history live from Twilio, scoped to the signed-in user's number
  api/conversations/route.ts  Reads the signed-in user's conversation list, and deletes a whole conversation
  api/contacts/route.ts    Reads/writes that user's own Phone Book (stored in Twilio Sync, one document per username)
  api/webauthn/register-options/route.ts   Starts registering a Face ID/Touch ID credential (username+password gated)
  api/webauthn/register-verify/route.ts    Verifies + stores that credential under the signed-in username
  api/webauthn/login-options/route.ts      Starts a biometric sign-in for a given username (no password needed - this replaces it)
  api/webauthn/login-verify/route.ts       Verifies the biometric signature, returns that user's real username+password on success
  api/webauthn/devices/route.ts            Lists/removes the signed-in user's registered biometric devices
  icon.png, apple-icon.png    App icons (Next.js file conventions - browser tab, home screen, install prompt)
  manifest.ts              Web app manifest so "Add to Home Screen" opens full-screen with no browser chrome
lib/
  auth.ts                  Central auth gate: verifies username+password against APP_USERS, used by every /api route above
  users.ts                 Parses APP_USERS into the user directory (username, password, phoneNumber, identity, label)
  phone.ts                 E.164 validation/normalization, shared client+server
  rateLimit.ts             In-memory best-effort rate limiter
  contacts.ts              Shared Contact type used by api/contacts and the UI
  messageThread.ts         Shared message-thread/conversation types used by the API routes and the UI
  webauthn.ts              Shared WebAuthn types + Relying Party config (derived from PUBLIC_BASE_URL)
  webauthnStore.ts         Reads/writes registered credentials, one Sync document per username
.env.example               Template — copy to .env.local, never commit the real one
```

## Architecture

```
Browser (Amar, Prateek, or Yash - in the US)
  -> Twilio Voice JS SDK (@twilio/voice-sdk), identity "dialer-<username>"
  -> POST /api/token          (mints a short-lived Twilio Access Token for that identity)
  -> Twilio Voice edge, using that Access Token
  -> TwiML App "Voice Request URL"        (shared by every user)
  -> POST /api/voice           (verifies the request, looks up the caller's
                                 own number from their identity, returns <Dial callerId=...>)
  -> Twilio Voice
  -> destination phone number
```

`/api/voice` never trusts the browser: it verifies the `X-Twilio-Signature`
header on every request (so only Twilio itself can trigger a dial), maps
the calling identity (`client:dialer-<username>`) back to that user's own
phone number via `APP_USERS`, rejects anything that doesn't match a known
identity, and re-validates the destination number is in E.164 format before
generating TwiML.
