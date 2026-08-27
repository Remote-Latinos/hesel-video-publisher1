import express from "express";
import axios from "axios";
import { google } from "googleapis";

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
 * POST /publish/youtube
 * Headers: x-publish-secret: <PUBLISH_SECRET>
 * Body: { videoUrl, title, description?, privacyStatus?, categoryId? }
 * Returns: { videoId, url }
 *
 * Streams videoUrl -> YouTube. The file is never fully buffered, so there is
 * no practical size limit (this is the whole point of moving it off Make).
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

  try {
    // Open the source as a stream (no full download into memory/disk).
    const source = await axios.get(videoUrl, {
      responseType: "stream",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const youtube = youtubeClient();
    const result = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { title, description, categoryId },
        status: { privacyStatus, selfDeclaredMadeForKids: false },
      },
      media: { body: source.data }, // googleapis does a resumable upload from this stream
    });

    const id = result.data.id;
    return res.json({ videoId: id, url: `https://www.youtube.com/watch?v=${id}` });
  } catch (err: any) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error("youtube publish error:", JSON.stringify(detail));
    return res.status(500).json({ error: "publish_failed", detail });
  }
});

app.listen(Number(PORT), () => {
  console.log(`video-publisher listening on :${PORT}`);
});
