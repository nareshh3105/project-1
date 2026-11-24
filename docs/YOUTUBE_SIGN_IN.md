# Sign in with Google for YouTube

With this set up, Stream Settings shows **Sign in with Google** when YouTube is chosen. After signing in once, the person types a title, picks who can watch, and presses Go Live: the app creates the broadcast on their channel and it goes live as soon as the video arrives. No stream key to copy. Stopping the stream ends the broadcast.

Without it, nothing changes: YouTube still works with a pasted stream key.

## One-time setup (the app's owner does this, not each user)

1. Go to https://console.cloud.google.com and create a project (for example "CodeBuilders").
2. **APIs & Services → Library**: enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External**, app name "CodeBuilders", your support email.
   - Scopes: add `https://www.googleapis.com/auth/youtube`.
   - While the app is in **Testing**, add each tester's Google account under **Test users** (up to 100). Only they can sign in.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**, application type **Desktop app**. Download the JSON.
5. Save the downloaded file as `resources/youtube-oauth.json` in the project. It is in `.gitignore`, so it never goes to GitHub, and the installer build includes it automatically.
   - For development you can instead set `CB_YOUTUBE_CLIENT_ID` and `CB_YOUTUBE_CLIENT_SECRET`.
6. Build the installer as usual.

## Before letting the public sign in

Google allows only listed test users until the app is **verified**. The `youtube` scope is a "sensitive" scope, so verification needs a privacy policy page, a home page on a domain you own, a short video showing how the app uses YouTube access, and a few weeks of Google review.

## Limits

- YouTube gives each Google project 10,000 API units a day. Creating a broadcast costs about 150 (broadcast, stream and bind), so about 60 go-lives a day across all users. Beyond that, people can still paste a stream key.
- The channel must have live streaming turned on in YouTube Studio; the first time, YouTube can take up to 24 hours. The app says so if it is not.

## How it works

`electron/main/youtube/`: `oauth.ts` (sign-in in the person's browser, sent back to 127.0.0.1 with PKCE; token refresh), `api.ts` (channel, broadcast, stream, bind), `account.ts` (where the client comes from; tokens kept encrypted with Windows' DPAPI through Electron's safeStorage in `youtube.bin` in the app's data folder). Going live then uses the ordinary stream, so reconnection works the same.
