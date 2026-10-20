# Business Caller

A simple website where your employees each sign in with their own username
and password, type a phone number, click **Call**, and talk to the client
through their laptop's microphone, using their own Twilio number as the
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

Everyone shares the same TwiML App and Voice Request URL for calls going
out, so nothing per-person is needed there.

Calls coming *in* go the other way: Twilio asks this app's server what to do
with a call to one of the numbers, and the server rings that person's browser
and, if one is configured, their own phone at the same time, passing along
*the caller's own number* so both show who is really calling. That does mean
each number's "A call comes in" webhook has to point at this app (Section 4),
and that doing so takes over from any plain call-forwarding set directly on
the number - the `forwardTo` setting replaces it, and fixes the forwarded
call announcing your own Twilio number instead of the caller's.

## 1. Install and configure for local testing

```bash
npm install
```

Open `.env.local` in this project (already partly filled in for you) and
add the one remaining value:

- **`TWILIO_AUTH_TOKEN`**: in the [Twilio Console](https://console.twilio.com),
  go to **Settings → Account settings → Account details & security**, and
  click **View** next to **Auth Token**. Copy it in.

Leave `PUBLIC_BASE_URL` empty for now, you'll fill that in after
deploying (Section 3).

The full, current list of variables and what each one is for is in
[`.env.example`](.env.example).

## 2. Run it locally

```bash
npm run dev
```

Open `http://localhost:3000`. You'll see the lock screen, enter one of the
username/password pairs from `APP_USERS` in `.env.local`. You can fully test
the lock screen, the dialer UI, and the microphone prompt this way.

**You cannot place a real call from `localhost`**, Twilio needs to reach
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

No config file needed, just:

1. Push this repository to GitHub (already set up as `origin`, see the
   chat for the exact commands used, or run `git push origin main` once
   you're authenticated).
2. Go to [vercel.com/new](https://vercel.com/new), click **Import** next
   to the `Business-Caller` GitHub repo. Vercel auto-detects Next.js,
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

Click **Save**. That covers calls going *out*.

### Calls coming in

Still in Twilio Console, go to **Phone Numbers → Manage → Active numbers**
and open **each** number in `APP_USERS`. Under **Voice Configuration**, set
**A call comes in** to:

- **Webhook**: `https://<your-vercel-domain>/api/voice/incoming`
- Method: **HTTP POST**

Click **Save**, and repeat for every number.

This is what makes the dialer ring in the browser when someone calls, and
what makes it show the caller's real number. **It replaces any plain
call-forwarding configured on the number itself** - if a number used to
forward to a personal phone, put that phone in the `forwardTo` field of
that person's `APP_USERS` entry (see below) and the forwarding carries on
as before, except that the phone now rings showing *the caller's* number
instead of the Twilio number.

Both ring at the same time, and whoever picks up first gets the call.

### Texts coming in

On the same screen for each number, set **A message comes in** to:

- **Webhook**: `https://<your-vercel-domain>/api/sms/incoming`
- Method: **HTTP POST**

This is only what makes the notification fire - the app reads message
history straight from Twilio either way. It replies with empty TwiML, which
also switches off Twilio's default canned auto-reply to anyone who texts
the number.

```jsonc
// APP_USERS, with forwarding for one person
[
  { "username": "amar", "password": "...", "phoneNumber": "+12064523433",
    "label": "Amar", "forwardTo": "+919876543210" },
  { "username": "prateek", "password": "...", "phoneNumber": "+18722784999",
    "label": "Prateek" }
]
```

Leave `forwardTo` out and only the browser rings.

## 5. Test a real call

1. Open the deployed URL, sign in with a username/password from `APP_USERS`,
   allow the microphone prompt.
2. Type a real number you can answer, in international format (e.g.
   `+919876543210` or `+12065551234`), click **Call**.
3. It should ring, and the caller ID should show that user's own number
   (e.g. Amar's calls show `+1 (206) 452-3433`, Prateek's show
   `+1 (872) 278-4999`).
4. Call that user's Twilio number from another phone. The browser should
   ring with the calling number on screen (and the `forwardTo` phone, if
   one is set, should ring at the same time showing the same number).
5. If it doesn't work, check **Twilio Console → Monitor → Logs → Calls**
   and **Errors** for the specific reason, the most common first-time
   issues are the Request URL not matching `PUBLIC_BASE_URL` exactly, or
   the destination country being blocked under **Voice → Settings → Geo
   Permissions**.

## 6. Give each person their login

Send each person the same Vercel URL plus their own username/password from
`APP_USERS`. That's all they need, no installs, no SIM card, just a laptop
with a mic and a browser. Nobody needs to know anyone else's credentials;
each login only ever sees its own number's calls, texts, and Phone Book.

**Note on SMS for the two new numbers:** `+18722784999` and `+17207832385`
currently show "Messaging disabled, Complete A2P registration" in Twilio
Console. Voice/calling works immediately once `APP_USERS` is deployed, but
sending SMS from those two numbers will fail with a Twilio error until A2P
10DLC registration is completed for them, that's a Twilio Console/
compliance step, not something this app's code can work around.

## Extra features

- **Calls / Texts / Contacts navigation**: a Google Voice-style layout: a
  nav rail on desktop (left side) and a bottom tab bar on mobile switch
  between the three main views, each full-screen with its own search box.
- **Dial pad**: on desktop, it's docked permanently on the right (there's
  space to spare), always ready with no button to find first. On mobile,
  a floating **+** button on the Calls tab opens it as an overlay, which
  stays open through the call itself until it's hung up. Either way it's a
  real phone-style pad: circular buttons with the standard ABC/DEF/…
  letters under each digit, a live "who is this" contact-match preview as
  you type, and - once connected - a native-style call screen (large
  avatar, circular Mute/Keypad buttons, one big round hang-up button).
- **Receiving calls**: when someone calls one of the numbers, the dialer
  rings in the browser with **the caller's own number** (and their name, if
  the Phone Book knows it) on screen, and Answer / Decline buttons. If that
  person has a `forwardTo` phone in `APP_USERS`, it rings at the same time
  and shows the same caller's number - whoever picks up first gets the
  call. This is what `/api/voice/incoming` does, and it replaces forwarding
  configured directly on the number in Twilio Console (which could only
  ever pass the Twilio number along as the caller ID, so a forwarded call
  announced your own line instead of the person calling). Hold / Add call /
  Merge are not offered on a call you answered - they upgrade a call to a
  Conference by reaching the far party through the browser's own leg, and
  on an answered call that relationship runs the other way round. Mute, the
  keypad and hanging up all work as usual.
- **Hold, Add Call, and Merge**: once connected, the call screen offers
  **Hold** (puts the other party on hold with a spoken "please wait"
  announcement, looping until resumed), **Add call** (dials a second number
  into the same call without dropping the first), and **Merge** (brings
  everyone off hold back into one conversation at once). Every normal call
  still starts exactly as a plain two-party call, identical to how this app
  has always worked - only the moment Hold or Add Call is actually pressed
  does it get quietly upgraded into a Twilio Conference behind the scenes
  (see `lib/conference.ts`), so calls that never use these features are
  completely unaffected. The plain call's `<Dial>` has an `action` URL
  (`/api/voice/after-dial`) that just hangs up for every normal call, but
  lets the browser leg follow the far leg into the conference when Hold/Add
  Call redirects it - without that, the browser call would drop the instant
  the far leg was moved. If an upgrade ever fails midway, the far leg is
  ended rather than left stranded (and billing) alone in a conference.
  Requires `PUBLIC_BASE_URL` (already set); no other new env vars.
- **Contact pages**: tap anyone in the Contacts tab to open their page -
  every number they have (each with its own call and text button), their
  company, your notes, and their recent calls. Edit and delete are there
  too; deleting asks first. A contact can hold extra numbers, notes and a
  company alongside the primary number, which stays the one everything else
  matches on when it turns a number back into a name.
- **Blocking**: a blocked number's calls are turned away before anything
  rings (so Twilio doesn't bill them) and their texts never notify you. The
  list lives server-side, so blocking on a phone blocks on a laptop too.
  Their texts still reach your Twilio number - that happens before this app
  is consulted, and no setting can prevent it.
- **Do not disturb**: turns incoming calls away with an engaged tone
  instead of ringing you, your phone or the dialer. Texts still arrive.
  Stored server-side with the block list, because the call webhook has to
  read it - a per-device setting could never be honoured.
- **Call history**: the Calls tab lists every past call (pulled live from
  Twilio's own Call records via `/api/calls`, most recent first) with who
  it was with, incoming/outgoing/missed status, duration, and when. Tap a
  row to call that number again, or use the message/delete icons on the
  right. Deleting a call permanently removes it from Twilio's records via
  its own delete, same as messages.
- **Profile photos**: tap your avatar (nav rail on desktop, top-right on
  mobile) to open your profile: upload a real photo (resized/compressed in
  the browser before it's ever sent, stored in Vercel Blob, see
  `BLOB_READ_WRITE_TOKEN` below), or pick one of five preset "generic
  person" avatars, each in a different on-brand color (no Blob storage
  needed for these - just a small reference saved to Twilio Sync). Anyone
  who picks neither gets an automatically colored initials avatar instead,
  the same way Gmail/Google Voice do, contacts, call history, and message
  threads all use the same avatars.
- **Stays signed in for 14 days**: unlocking (password or Face ID/Touch
  ID) is remembered in the browser for 14 days, refreshed every time the
  app is opened while still valid. So in practice, opening it at least
  once every 14 days keeps it signed in indefinitely; leave it untouched
  longer than that and it asks to unlock again. **Sign out** is in the
  profile panel and ends the session immediately regardless of this.
- **Microphone / speaker picker**: appears in the call overlay, above the
  phone number field. Bluetooth headsets show up automatically once paired
  with the OS; no extra setup.
- **Mute + keypad**: appear once a call connects, for muting and for
  entering digits into an IVR.
- **Phone Book (Contacts tab)**: contacts are stored server-side in a
  per-person Twilio Sync Document (see `TWILIO_SYNC_SERVICE_SID` below), so
  each person's list shows up on every device they unlock the dialer from,
  add one on a laptop, it's there on the phone too, without being visible
  to anyone else signed in with a different login. A "New contact" button
  in the header opens the add form, so the list keeps the whole screen.
- **Settings** (gear icon, top right on phones, bottom of the nav rail on
  desktop): Theme (System, Light, Dark; System follows the device live), Text
  size (Small, Medium, Large, Extra large; it scales the whole app), Chat
  wallpaper (Dots, Blush, Plain) with a live preview, "Enter is send" for
  computer keyboards, tap sounds and vibration switches, and Sign out. These
  are stored per device in the browser (`dialer_settings`), so a phone and a
  laptop can look different. The saved theme and size are applied before the
  first paint, so there is no light flash in dark mode.
- **Status and About** (Profile): pick a mood status (Available, At work, In a
  meeting, On a call, Driving, Away, Do not disturb, Out sick) or write your
  own with an emoji, and add a short About line (100 characters). The status
  emoji shows as a badge on your picture. These belong to the person, so they
  are saved on the server in the same per-user Sync profile document as the
  photo (`POST /api/profile`), and follow you to every device. Saving one never
  overwrites the other, or the photo.
- **Chat view (phones)**: opening a conversation on a phone shows a
  full-screen, WhatsApp-style chat: name/avatar and a Call button pinned at
  the top, message bubbles with day separators and delivery ticks (one tick
  sent, two delivered, "Not delivered" when the carrier rejected it), and
  the message box pinned right above the keyboard. Sending is instant (your
  message appears immediately and the box clears; if the send fails, your
  text is put back), the box grows as you type, and the phone's Back button
  closes the chat. Nothing zooms when you tap the box: every field is 16px
  on phones (iOS Safari zooms into anything smaller) and the page scale is
  locked. On desktop the same chat sits inside the Texts panel, and Enter
  sends. Bubbles have WhatsApp-style tails, the time sits inside the bubble,
  and a faint dotted wallpaper sits behind them. Tap a message to select it:
  the header turns into a bar with Copy and Delete. Scroll up to read
  history and the chat stays put (background refreshes never yank you down);
  a round button jumps back to the latest message. Links in messages are tappable, and long links or
  unbroken text wrap inside the bubble instead of spilling out. On tablets
  the chat is a centred column; Escape clears a selection on desktop. In the Texts list, "New
  message" opens the number box.
- **WhatsApp-style texting**: the Texts tab is built like a chat app on both
  screen sizes. On a phone it is a full-screen chat with a bottom tab bar; on
  a wide screen (1280px and up) it is two panes like WhatsApp Web, with the
  chat list on the left, the open chat on the right and a welcome screen when
  none is open.
  - *Emoji*: an emoji panel (search, eight categories, recently used). On a
    phone it takes the keyboard's place; on a computer it floats above the box.
    A message made of only 1 to 3 emoji shows large, without a bubble.
  - *Voice notes*: tap the mic (it replaces Send when the box is empty), talk,
    then tap Send, or the bin to throw it away. Up to 40 seconds, with a live
    timer and level bars. Notes play in the chat with a waveform, a seek bar,
    1x / 1.5x / 2x speed, and only one plays at a time.
  - *Attachments*: the paperclip opens a grid for Photo, Camera (on a phone),
    Video, Audio, Document (PDF or a contact .vcf), GIF, Location, Contact,
    Poll and Event. Up to 5 files at once, with a caption. Photos are shrunk
    to fit; GIFs are sent as-is so they stay animated. You can also paste a
    picture from the clipboard, or drag and drop files onto the chat.
  - *Stickers*: built-in packs (drawn from emoji onto a picture, so no sticker
    library or paid service is involved), or make your own from a photo -
    saved on this device, sent as a plain PNG picture.
  - *Formatting*: `*bold*`, `_italic_`, `~strike~`, `` `mono` ``, `> quotes`,
    bulleted and numbered lists, and \`\`\` code blocks \`\`\`, the same
    markers WhatsApp uses. Select some text for a formatting button (or use
    Ctrl/Cmd+B, +I, +Shift+X, +Shift+M on a computer).
  - *Replies*: swipe a message on a phone (or use its menu) to quote it above
    your answer; tapping a quote jumps to and highlights the original.
  - *Message actions*: select one or more messages for Copy, Forward (with any
    attachment - the server copies it from Twilio, nothing is re-uploaded),
    Star, or Delete ("for me", which only hides it here, or "permanently",
    which removes it from Twilio's records). A single message's menu adds
    React (a small emoji chip; optionally also texted, see Settings), Message
    info (status, cost, segments, straight from Twilio), Pin to the top of the
    chat, Edit and resend (sends a new text; the original stays as it was, SMS
    cannot truly edit a sent message), and Save or share any attachment.
  - *Search*: inside a chat (highlighted matches, next/previous, and a
    calendar button to jump to a date), or across the whole list.
  - *Polls, events, locations and contact cards*: plain texts with a
    recognisable shape, so they read fine as an ordinary SMS on any phone but
    show as a card here. A poll's or event's replies (a number, or
    YES/NO/MAYBE) are tallied automatically. A location shows a live, free
    map (OpenStreetMap, no key and no cost). A contact card can be saved to
    your Contacts.
  - *Chat list*: unread dots and a count on the Texts tab and in the browser
    tab title, All / Unread / Favourites / Pinned / Archived / label filters,
    and "Voice message" / "Photo" / poll / event previews. Long press a chat
    on a phone, or right click or use its dots on a computer, for pin,
    favourite, archive, mute (8 hours / 1 week / always), label, lock or
    block. "Select chats" ticks several at once for a bulk action. The list
    refreshes itself every 20 seconds and plays a sound for a new text (see
    Settings for the sound, or to turn it off).
  - *Contact info*: tap a chat's name to see every photo, video, document and
    link shared in it, and every per-chat setting (favourite, archive, lock,
    disappearing messages, wallpaper, labels) plus Export chat (a `.txt`
    download), Copy chat link (opens straight to that chat), Block and Delete.
  - *Settings*: a bubble colour, a chat wallpaper (per chat or app-wide), a
    message sound with a preview, desktop notifications (with or without the
    message text shown), a list of blocked contacts, and Backup/Restore for
    all of the above plus pins, stars, favourites and labels (the texts
    themselves already live in Twilio; this is everything else, exported as
    one JSON file for moving to another device).
  - *App lock and chat lock*: a 4 to 8 digit PIN (never stored - only a salted,
    hashed copy on this device) locks the whole app, with a choice of when it
    locks again (manually, 1 minute, 15 minutes or 1 hour) and a lockout that
    grows after repeated wrong tries. Individual chats can be locked too; they
    disappear from the list and reopen from "Locked chats" in the list's menu
    or by typing a secret code (also set in Settings) into the Texts search
    box.
  - Unread, pins, drafts, favourites, archive, mute, labels, stars, reactions
    and the lock are all remembered per person on each device (Twilio has no
    "read", "starred" or "muted" flag to ask). Chats that were already there
    the first time a device is used do not show as unread.
  - *How attachments travel*: as MMS from your Twilio number, so they need an
    MMS-capable US or Canadian number (all three numbers here are) and the
    recipient's carrier to accept picture messages. Files are parked in
    Vercel Blob (`BLOB_READ_WRITE_TOKEN`, already used for profile photos)
    under an unguessable name so Twilio can fetch them, and files older than
    3 days are swept out. Voice notes are sent as small mono WAV files because
    those play on every phone. Received attachments are served through
    `/api/media`, which only accepts signed, expiring links.
- **Messages/SMS (Texts tab)**: an inbox-style list of every past
  conversation (pulled from Twilio's real message history, most recent
  first), tap one to open the full thread with a back button to return to
  the list, or type a new number to start a fresh conversation. Threads
  poll `/api/messages` every 5 seconds, which reads Twilio's actual Message
  history for that number (Twilio records every inbound and outbound SMS
  on the account automatically, regardless of any webhook), so a client's
  reply shows up on its own, nothing to configure for that part. If a
  number matches a saved contact, their name shows instead of the raw
  number.
- **Deleting messages/conversations/calls**: the small trash icon on a
  row deletes it. This calls Twilio's own delete on the underlying
  resource, so it's a real, permanent removal from Twilio's records (not
  just hidden in this UI), there's a confirmation prompt first since it
  can't be undone.
- Sending SMS requires **SMS capability enabled** (and, for a new number,
  A2P 10DLC registration completed) on that person's own number in the
  Twilio Console, if it's off or unregistered, sends fail with a clear
  error. No extra env vars are needed for text; `/api/sms` and
  `/api/messages` reuse the same credentials as everything else, just scoped
  to whichever number the signed-in user owns. Sending a voice note or photo
  also needs `BLOB_READ_WRITE_TOKEN` (the same one used for profile photos).
- **App icon**: a custom icon (a phone glyph on the same near-black/crimson
  brand gradient) is wired up for the browser tab, iOS/Android "Add to
  Home Screen," and Chrome's install prompt. Installed from the home
  screen, it opens full-screen with no browser address bar, like a real
  app.
- **Face ID / Touch ID / Windows Hello**: on a browser and device that
  supports a platform authenticator, the lock screen offers "Unlock with
  Face ID / Touch ID" as an alternative to typing the password every time.
  This is real WebAuthn (passkey) authentication via
  `@simplewebauthn/server` and `@simplewebauthn/browser`, not a password
  autofill shim:
  - **Setup**: sign in normally with username + password once, open your
    profile panel (tap your avatar), then click **"+ Add this device"**.
    That registers a credential tied to this specific browser/device's
    secure enclave, for that specific username.
  - **After that**: enter your username on the lock screen, and the Face
    ID/Touch ID button appears above the password field as a shortcut.
  - **Under the hood**: registering a new credential still requires the
    real username and password (so a stranger who finds the URL can't
    register their own face as a backdoor onto someone else's number).
    Signing in with a registered credential does not, the verified
    biometric signature itself is the proof, and on success the server
    hands back that user's real username and password, which the app then
    uses exactly as if they had been typed.
  - **Managing devices**: the same "Face ID / Touch ID" section lists every
    device registered to the signed-in user, with a remove button, in case
    a device is lost or no longer used.
  - Credentials are stored in the same Twilio Sync Service as the Phone
    Book, one document per username (`webauthn_<username>`), no new env
    vars, and one person's devices are never visible to another.

### Heads up: Twilio's default SMS auto-reply

Your number currently has **no messaging webhook configured**, so Twilio
auto-sends its generic fallback reply ("Thanks for the message... Reply
HELP for help...") to every inbound text, this happens outside of and
regardless of this app. If you don't want clients receiving that canned
reply, go to Twilio Console → **Phone Numbers → your number → Messaging**
and either point the "A message comes in" webhook at a URL that returns
empty TwiML, or clear whatever's causing the fallback. This app doesn't
touch that setting, it wasn't asked to, but it's worth knowing about
since it's live right now.

## Security

How sign-in works, and what to do when rotating anything.

**Passwords are hashed, not stored.** Each `APP_USERS` entry carries a
`passwordHash` (scrypt), generated with:

```bash
npm run hash-password -- 'the password'
```

The plaintext `password` field is still read so an existing deployment
keeps working, but it logs a warning on every cold start. Replace it.

Note the hash uses `:` as its separator, not the conventional `$`. These
values live in an environment variable, and env loaders expand `$NAME`
inside values - a `$`-separated hash came back as the bare word `scrypt`
and silently refused every password. There is a test pinning this.

**The browser holds a session token, not a password.** Signing in returns a
short-lived signed token; every later request sends that. The password
crosses the wire once and is never written to storage. Changing
`SESSION_SECRET` invalidates every outstanding session at once, which is
how you sign everybody out.

**Brute force is bounded by an account lockout.** Eight wrong passwords in
fifteen minutes locks that account for fifteen minutes, counted in Twilio
Sync so every serverless instance sees the same tally. The per-IP limiter
in `lib/rateLimit.ts` is still there, but it only ever sees one instance -
on Vercel, concurrent requests land on many, which is why it cannot be the
defence on its own.

The counter is read-modify-write, not an atomic increment, so a single
burst of simultaneous guesses can slip a few past the limit before the
record catches up. The burst after it is refused. If you ever need a hard
guarantee, back `lib/loginGuard.ts` with Redis `INCR` instead.

**Content-Security-Policy.** `proxy.ts` sets one per request with a fresh
nonce (`strict-dynamic`), so only scripts this server emitted can run. That
is why `app/page.tsx` calls `connection()` - a nonce has to be per-request,
so the page cannot be prerendered at build time. If you add a third-party
script, image host or API, it needs a line in the policy there or the
browser will refuse it; check the console for "Refused to..." after any
such change.

**If you rotate credentials:** `SESSION_SECRET` signs everyone out.
`TWILIO_API_KEY_SECRET` does too *if* `SESSION_SECRET` is unset, since the
signing keys are derived from it as a fallback - set `SESSION_SECRET` and
the two become independent.

## Notifications: knowing who is calling

The problem this solves: a call to the Twilio number is forwarded on to a
personal phone, and a forwarded call can only carry one caller ID. Whoever
picks up sees the *Twilio* number - so if that number is saved in their
contacts as "Amar Twilio No", every incoming call from every client announces
itself as that. There is no way to answer "who is this?" before picking up.

Two things fix it, and they are independent:

**1. Pass the real caller through.** `/api/voice/incoming` dials out as the
original caller's number rather than the Twilio number, so the forwarded
call shows who is actually ringing. This needs nothing but the webhook
pointed at it (Section 4).

**2. Notify the dialer.** A web push notification goes to every device the
person has turned alerts on for, naming the caller - their Phone Book name
when there is one, and the number either way. Same for an incoming text,
with a preview. Tapping it opens that conversation.

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`, then each
person turns it on once per device under **Settings → Notifications →
Alerts when the app is closed**. Generate the keys with:

```bash
node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey);console.log(k.privateKey)"
```

Subscriptions are stored per person in Twilio Sync, and a device that goes
away (browser uninstalled, site data cleared, permission revoked) is
dropped automatically the first time the push service reports it gone.

**On iPhone and iPad, the app must be added to the Home Screen first.**
Apple does not deliver web push to a page in a Safari tab, at all - Share →
Add to Home Screen, open it from there, then turn the setting on. The
Settings screen says so when it detects this.

**What this is not:** a native full-screen ringtone. Skype and WhatsApp ring
like a phone call because they are native apps using CallKit, which a web
app cannot reach. What arrives here is a notification - it buzzes, makes a
sound, and shows the number - which answers the question, but will not take
over the screen.

## Message delivery

The newest message you sent carries a plain-words status underneath it -
**Delivered**, **Sent**, or **Sending…** - rather than only the ticks,
which are easy to misread. Failures keep their existing amber "Not
delivered" inside the bubble, tappable for the carrier's actual reason.

**There is no "Read" and there cannot be.** SMS carries no read receipts.
Delivery receipts come back from the carrier, which is where *Delivered*
comes from; whether the person opened the message is simply not something
the SMS network reports. (WhatsApp and RCS do have read receipts; plain
texts never will.) *Sent* means the carrier accepted it but has not
confirmed delivery - normal on some networks and for landlines.

## Tests

```bash
npm test
```

Covers password hashing, session-token forgery, the per-purpose signing
keys, attachment-link tampering, and the rule deciding whose copy of a
message is whose. They run on Node's own test runner through `tsx`; there
is no test database and nothing touches Twilio.

## Environment variables reference

| Variable | Where it comes from | Secret? |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Console home page / Account Info | No, but keep private |
| `TWILIO_API_KEY_SID` | The "Business Caller" API Key you created | No, but keep private |
| `TWILIO_API_KEY_SECRET` | Shown once when the API Key was created | **Yes** |
| `TWILIO_AUTH_TOKEN` | Console → Settings → Account settings → Account details & security | **Yes** |
| `TWILIO_TWIML_APP_SID` | The "Business Caller" TwiML App you created | No, but keep private |
| `TWILIO_SYNC_SERVICE_SID` | A Sync Service (Console → Explore Products → Sync → Services), used to store each person's Phone Book and Face ID/Touch ID credentials | No, but keep private |
| `APP_USERS` | A JSON array, one entry per person: `[{"username":"amar","passwordHash":"scrypt:...:...","phoneNumber":"+12064523433","label":"Amar","forwardTo":"+91..."}, ...]`. Generate each hash with `npm run hash-password -- 'the password'`. Each `phoneNumber` must be a Voice-enabled Twilio number on your account; `forwardTo` is optional (see "Calls coming in") | **Yes** |
| `SESSION_SECRET` | 32 random bytes you generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Signs session tokens and attachment links. Optional - falls back to deriving from `TWILIO_API_KEY_SECRET` - but setting it means rotating Twilio keys doesn't sign everyone out | **Yes** |
| `PUBLIC_BASE_URL` | Your deployed Vercel URL, no trailing slash | No |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Generate once: `node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey);console.log(k.privateKey)"`. Without them the notification setting says it isn't configured and nothing else changes | **The private one, yes** |
| `VAPID_SUBJECT` | A `mailto:` address or your site URL - identifies this app to the push services. Defaults to `PUBLIC_BASE_URL` | No |
| `BLOB_READ_WRITE_TOKEN` | Vercel dashboard → Project → Storage → create a Blob store and attach it (Vercel adds this automatically) | **Yes**, but only for profile photo upload/removal |

**Never** commit `.env.local` (it already can't be, see `.gitignore`), put
any of the "Yes" rows in frontend code, or paste them anywhere public.

## Project layout

```
app/
  page.tsx                 Renders the dialer
  layout.tsx
  components/Dialer.tsx    All dialer/calls/texts/contacts/profile UI + Twilio Device logic (client-side)
  components/Avatar.tsx    Circular avatar - shows an uploaded photo, or a colored initials fallback
  components/icons.tsx     Every icon in the app, drawn to one style (1.8 line weight, decorative by default). Add new icons here, not inline
  components/chat/         Chat pieces: Composer, EmojiPicker, VoicePlayer, MediaViews, MessageBubble, RichText, StructuredCards (poll/event/location/contact), ConversationList, ChatInfo, Builders (poll/event/location), PersonPicker, Sheet, ConfirmSheet, StarredView, MessageInfoDialog
  components/lock/LockUI.tsx  The PIN pad, the full-screen app lock, and the PIN/secret-code setup sheets
  lib/settings.ts          Per-device display settings (theme, text size, bubble colour, sounds, notifications...), applied before first paint
  lib/chatPrefs.ts         Per-person, per-device chat state: pins, favourites, archive, mute, labels, drafts, stars, reactions, hidden/locked chats, backup export/import
  lib/lock.ts              PIN and secret-code hashing (PBKDF2, salted, never stores the PIN itself) and the wrong-try lockout
  lib/richText.ts          Parses `*bold*`/lists/quotes, and the plain-text "shape" of polls, events, locations and contact cards
  lib/attachments.ts       Prepares picked/pasted/dropped files (shrinks photos, checks type and a shared size budget) before sending
  lib/outgoingMedia.ts     Server-side: validates and uploads new attachments, or copies a forwarded one from an existing Twilio message
  lib/stickers.ts          Built-in sticker packs (drawn from emoji) and "make your own from a photo", kept on this device
  lib/emoji.ts             The emoji picker's data, search and recents
  lib/voice.ts             Records a voice note and encodes it to a small mono WAV
  lib/imageResize.ts       Shrinks a picked photo to fit the outgoing size budget
  api/token/route.ts       Mints Twilio Access Tokens plus this app's own session token; enforces the account lockout on failed sign-ins
  lib/session.ts           Issues and verifies the short-lived signed token the browser sends instead of a password
  lib/password.ts          scrypt hashing for APP_USERS passwords (colon-separated, so env expansion can't mangle it)
  lib/loginGuard.ts        Failed-sign-in counter and lockout, kept in Twilio Sync so every serverless instance shares it
  lib/secrets.ts           Derives a separate signing key per purpose (session tokens, attachment links) via HKDF
  proxy.ts                 Per-request Content-Security-Policy with a fresh nonce
  api/voice/route.ts       TwiML webhook Twilio calls to place the outbound leg; resolves caller ID from the caller's identity
  api/voice/incoming/route.ts  TwiML webhook for a call *to* one of the numbers: rings that person's browser (and their forwardTo phone) under the caller's own number, and pushes "X is calling"
  api/sms/incoming/route.ts    Webhook for a text arriving on one of the numbers: pushes the sender and a preview, and replies with nothing
  api/push/subscribe/route.ts  Registers/removes this browser for notifications
  lib/callRules.ts         Who is blocked and whether Do Not Disturb is on, per person, in Twilio Sync - read by the incoming webhooks
  api/call-rules/route.ts  Reads and replaces those rules for the signed-in user
  components/screens/ContactDetail.tsx  One contact's page: numbers, notes, company, their recent calls, edit and delete
  lib/push.ts              Sends a notification to every device a person has turned alerts on for
  lib/pushStore.ts         Those devices' push subscriptions, per person, in Twilio Sync
  lib/notifications.ts     Browser side: service worker, permission, subscribe (and the iOS Home Screen rule)
  public/sw.js             Service worker - shows the notification and opens the right chat when tapped
  api/sms/route.ts         Sends outbound SMS or MMS (voice note, photo, forwarded attachment) via the Twilio REST API, from the signed-in user's own number
  api/messages/route.ts    Reads/deletes one conversation's message history live from Twilio, scoped to the signed-in user's number
  api/messages/info/route.ts  Reads one message's delivery status, cost and segment count from Twilio
  api/media/route.ts       Serves one MMS attachment (voice note, photo) from Twilio behind a signed, expiring link
  api/conversations/route.ts  Reads the signed-in user's conversation list, and deletes a whole conversation
  api/calls/route.ts       Reads/deletes the signed-in user's call history live from Twilio's own Call records
  api/calls/hold/route.ts     Puts the other party (or a specific participant) on hold, or takes them off it
  api/calls/add/route.ts      Dials a new number into a live call, upgrading it to a conference if needed
  api/calls/merge/route.ts    Takes every held participant on a call off hold at once
  api/calls/status/route.ts   Polled by the UI: is this call a conference yet, and who's on it / on hold
  api/voice/after-dial/route.ts  TwiML webhook: what the browser leg does when its <Dial> ends (hang up, or join a Hold/Add Call conference)
  api/hold-music/route.ts     TwiML webhook: the looping "please wait" announcement played to a held participant
  api/contacts/route.ts    Reads/writes that user's own Phone Book (stored in Twilio Sync, one document per username)
  api/avatar/route.ts      Uploads/removes a profile photo (Vercel Blob for the image, Twilio Sync for the URL)
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
  callLog.ts               Shared CallLogEntry type used by api/calls and the UI
  conference.ts            The lazy plain-call-to-Twilio-Conference upgrade behind Hold/Add Call/Merge
  profileStore.ts          Reads/writes a profile doc (currently just avatarUrl), one per username
  webauthn.ts              Shared WebAuthn types + Relying Party config (derived from PUBLIC_BASE_URL)
  webauthnStore.ts         Reads/writes registered credentials, one Sync document per username
.env.example               Template, copy to .env.local, never commit the real one
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
