# Business Caller

A simple website where your employee opens a page, types a phone number,
clicks **Call**, and talks to the client through his laptop's microphone —
using your Twilio number `+1 (206) 452-3433` as the caller ID. No SIM card
needed on his end.

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

1. Amar opens the website and types an access code (a password only you and
   he know) to unlock the dialer.
2. He types a client's phone number and clicks **Call**.
3. His browser talks to Twilio directly using the Twilio Voice SDK.
4. Twilio asks *this app's* server ("`/api/voice`") how to handle the call.
   The server checks the request is genuinely from Twilio, checks the
   number is valid, and tells Twilio: "dial this number, show
   +12064523433 as the caller ID."
5. Twilio dials the client. Amar talks through his laptop mic/speakers.

Your existing setup — the Twilio number forwarding incoming calls to
India — is a completely separate configuration and is never touched by
this app.

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

Open `http://localhost:3000`. You'll see the lock screen — enter the
access code from `APP_ACCESS_CODE` in `.env.local`. You can fully test the
lock screen, the dialer UI, and the microphone prompt this way.

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

1. Open the deployed URL, enter the access code, allow the microphone
   prompt.
2. Type a real number you can answer, in international format (e.g.
   `+919876543210` or `+12065551234`), click **Call**.
3. It should ring, and the caller ID should show `+1 (206) 452-3433`.
4. If it doesn't work, check **Twilio Console → Monitor → Logs → Calls**
   and **Errors** for the specific reason — the most common first-time
   issues are the Request URL not matching `PUBLIC_BASE_URL` exactly, or
   the destination country being blocked under **Voice → Settings → Geo
   Permissions**.

## 6. Give Amar the URL

Send Amar two things: the Vercel URL and the access code. That's all he
needs — no installs, no SIM card, just a laptop with a mic and a browser.

## Environment variables reference

| Variable | Where it comes from | Secret? |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Console home page / Account Info | No, but keep private |
| `TWILIO_API_KEY_SID` | The "Business Caller" API Key you created | No, but keep private |
| `TWILIO_API_KEY_SECRET` | Shown once when the API Key was created | **Yes** |
| `TWILIO_AUTH_TOKEN` | Console → Settings → Account settings → Account details & security | **Yes** |
| `TWILIO_TWIML_APP_SID` | The "Business Caller" TwiML App you created | No, but keep private |
| `TWILIO_PHONE_NUMBER` | Fixed: `+12064523433` | No |
| `APP_ACCESS_CODE` | A password you choose, shared only with Amar | **Yes** |
| `PUBLIC_BASE_URL` | Your deployed Vercel URL, no trailing slash | No |

**Never** commit `.env.local` (it already can't be — see `.gitignore`), put
any of the "Yes" rows in frontend code, or paste them anywhere public.

## Project layout

```
app/
  page.tsx                 Renders the dialer
  layout.tsx
  components/Dialer.tsx    All dialer UI + Twilio Device logic (client-side)
  api/token/route.ts       Mints Twilio Access Tokens (server-side, gated by APP_ACCESS_CODE)
  api/voice/route.ts       TwiML webhook Twilio calls to place the outbound leg
lib/
  constants.ts             Shared agent identity string
  phone.ts                 E.164 validation/normalization, shared client+server
  rateLimit.ts             In-memory best-effort rate limiter
.env.example               Template — copy to .env.local, never commit the real one
```

## Architecture

```
Browser (Amar, in the US)
  -> Twilio Voice JS SDK (@twilio/voice-sdk)
  -> POST /api/token          (mints a short-lived Twilio Access Token)
  -> Twilio Voice edge, using that Access Token
  -> TwiML App "Voice Request URL"
  -> POST /api/voice           (verifies the request, returns <Dial>)
  -> Twilio Voice
  -> destination phone number
```

`/api/voice` never trusts the browser: it verifies the `X-Twilio-Signature`
header on every request (so only Twilio itself can trigger a dial), checks
the caller's identity matches what this app issues, and re-validates the
destination number is in E.164 format before generating TwiML.
