# Video Publisher (Railway)

A tiny service that **streams** a video from any URL straight into YouTube's
upload API. Because it streams (never buffers the whole file), there is no
size limit — this is what gets us past Make's ~download cap for 146 MB videos.

Later, the same service can host a `/publish/linkedin` route for LinkedIn video.

---

## 1. Get YouTube credentials (the one gating prerequisite)

You need three values: a **client ID**, a **client secret**, and a **refresh
token** authorized on **Hesel's YouTube channel**.

**a. Google Cloud project**
1. https://console.cloud.google.com → create a project (or reuse one).
2. APIs & Services → Library → enable **YouTube Data API v3**.

**b. OAuth client**
3. APIs & Services → Credentials → Create credentials → **OAuth client ID** →
   type **Web application**.
4. Under "Authorized redirect URIs" add: `https://developers.google.com/oauthplayground`
5. Copy the **Client ID** and **Client secret**.
6. OAuth consent screen: set it up (External is fine), and under **Test users**
   add the Google account that owns Hesel's YouTube channel. Add the scope
   `https://www.googleapis.com/auth/youtube.upload`.

**c. Refresh token (via OAuth Playground — no code needed)**
7. Open https://developers.google.com/oauthplayground
8. Click the ⚙️ (top right) → check **"Use your own OAuth credentials"** →
   paste the Client ID + Client secret.
9. In the left scope list, enter `https://www.googleapis.com/auth/youtube.upload`
   → **Authorize APIs** → sign in **as the channel owner** → allow.
10. Click **"Exchange authorization code for tokens"** → copy the **Refresh token**.

Put all three into Railway env vars (below). The refresh token is long-lived.

---

## 2. Deploy to Railway

1. Push this folder to a GitHub repo (never commit real `.env`).
2. Railway → New Project → Deploy from repo.
3. Add environment variables (Railway → Variables):
   - `YOUTUBE_CLIENT_ID`
   - `YOUTUBE_CLIENT_SECRET`
   - `YOUTUBE_REFRESH_TOKEN`
   - `PUBLISH_SECRET`  → any long random string you invent (Make will send it)
4. Railway auto-runs `npm install` then `npm start`. It injects `PORT`.
5. Grab the public URL Railway gives you, e.g. `https://video-publisher-xxxx.up.railway.app`.
6. Test: `GET https://.../health` should return `{"ok":true}`.

---

## 3. Wire it into Make (I'll do this part once you send me the URL)

The YouTube branch changes from **[download → youtube:uploadVideo]** to a single
**HTTP "Make a request"** call:

- **URL:** `https://<railway-url>/publish/youtube`
- **Method:** POST
- **Header:** `x-publish-secret: <PUBLISH_SECRET>`
- **Body (JSON):**
  ```json
  {
    "videoUrl": "{{ Final Creative }}",
    "title": "{{ task name }}",
    "description": "{{ Caption Youtube }}"
  }
  ```
- **Timeout:** raise it (Advanced settings) to the max — uploads take a bit.

The response `{{ url }}` then feeds the existing ClickUp writeback (URL Youtube +
status → 📤 posted). The anti-duplicate guard is unchanged.

---

## Endpoint reference

`POST /publish/youtube`
```json
{
  "videoUrl": "https://.../final-creative.mp4",   // required
  "title": "My video title",                       // required
  "description": "caption text",                   // optional
  "privacyStatus": "public",                       // optional: public | unlisted | private
  "categoryId": "22"                               // optional
}
```
→ `{ "videoId": "abc123", "url": "https://www.youtube.com/watch?v=abc123" }`
