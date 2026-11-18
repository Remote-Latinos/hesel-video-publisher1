import express from "express";
import axios from "axios";
import { google } from "googleapis";
import fs from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";

const app = express();
app.use(express.json({ limit: "1mb" }));

const {
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
  YOUTUBE_REFRESH_TOKEN,
  PUBLISH_SECRET,
  PORT = "3000",
} = process.env;

function youtubeClient() {
  const oauth2 = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
  return google.youtube({ version: "v3", auth: oauth2 });
}

// Health check (Railway + Make can ping this)
app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * Download the source to a temp file FIRST, validating it is really a video.
 * This is the fix for the silent failures: streaming an unknown/HTML/partial
 * body straight into YouTube created a video resource with bad media, which
 * YouTube then "abandoned" during processing — but the old code still returned 200.
 */
async function downloadToTemp(videoUrl: string): Promise<{ filePath: string; size: number }> {
  const filePath = path.join(
    os.tmpdir(),
    `vid-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
  );

  const source = await axios.get(videoUrl, {
    responseType: "stream",
    maxRedirects: 5,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    // Many hosts (Drive, CDNs) return an HTML interstitial to non-browser clients.
    headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
  });

  const contentType = String(source.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("video/") && contentType !== "application/octet-stream") {
    source.data.destroy();
    throw new Error(
      `source is not a video (content-type: ${contentType || "unknown"}) for ${videoUrl}`
    );
  }

  await pipeline(source.data, fs.createWriteStream(filePath));

  const size = fs.statSync(filePath).size;
  if (size < 100 * 1024) {
    // < 100 KB is never a real video — almost certainly an error page.
    fs.unlinkSync(filePath);
    throw new Error(`downloaded file too small (${size} bytes), source likely not a real video: ${videoUrl}`);
  }

  return { filePath, size };
}

/**
 * NOTE: We intentionally do NOT verify processing via youtube.videos.list.
 * The OAuth token only carries the youtube.upload scope, so videos.list returns
 * 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT — which previously turned a SUCCESSFUL
 * upload into a reported 500. That left the ClickUp task in "approved", so the
 * scenario re-published it on the next run (this was the duplicate-video bug).
 * The content-type + size validation in downloadToTemp already blocks non-video
 * sources BEFORE upload, so a successful videos.insert is a reliable success.
 */

/**
 * POST /publish/youtube
 * Headers: x-publish-secret: <PUBLISH_SECRET>
 * Body: { videoUrl, title, description?, privacyStatus?, categoryId? }
 * Returns: { videoId, url, status } on a successful upload, or 500 on failure.
 */
app.post("/publish/youtube", async (req, res) => {
  if (PUBLISH_SECRET && req.get("x-publish-secret") !== PUBLISH_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const {
    videoUrl,
    title,
    description = "",
    privacyStatus = "public",
    categoryId = "22", // 22 = People & Blogs; 27 = Education
  } = req.body || {};

  if (!videoUrl || !title) {
    return res.status(400).json({ error: "videoUrl and title are required" });
  }

  let filePath: string | undefined;
  try {
    const dl = await downloadToTemp(videoUrl);
    filePath = dl.filePath;

    const youtube = youtubeClient();
    const result = await youtube.videos.insert(
      {
        part: ["snippet", "status"],
        requestBody: {
          snippet: { title, description, categoryId },
          status: { privacyStatus, selfDeclaredMadeForKids: false },
        },
        media: { body: fs.createReadStream(filePath) }, // known-length file => reliable resumable upload
      },
      {
        // Tell YouTube the exact byte count so the upload is complete and verifiable.
        headers: { "X-Upload-Content-Length": String(dl.size) },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const id = result.data.id!;
    // Upload succeeded — report success immediately. Do NOT call videos.list (see note above).
    return res.json({ videoId: id, url: `https://www.youtube.com/watch?v=${id}`, status: "uploaded" });
  } catch (err: any) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error("youtube publish error:", JSON.stringify(detail));
    return res.status(500).json({ error: "publish_failed", detail });
  } finally {
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }
  }
});

app.listen(Number(PORT), () => {
  console.log(`video-publisher listening on :${PORT}`);
});
