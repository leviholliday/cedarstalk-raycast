import { environment } from "@raycast/api";
import { access, mkdir, readFile, unlink, writeFile } from "fs/promises";
import * as path from "path";

const BASE_URL = "https://selfservice.cedarville.edu";
const PHOTO_DIR = path.join(environment.supportPath, "photos");

// In-memory set to avoid duplicate in-flight fetches
const inflight = new Set<string>();

/**
 * Why the most recent download failed, so the UI can say something better
 * than showing no photo and no reason. "auth" means Self-Service answered a
 * photo request with a login page, which is what an expired session does.
 */
let lastFailure: "auth" | "http" | "other" | null = null;

export function lastPhotoFailure(): "auth" | "http" | "other" | null {
  return lastFailure;
}

/**
 * Whether a buffer actually starts like an image.
 *
 * Self-Service answers an expired session with the Microsoft sign-in page —
 * and answers it with `200 OK`, so `res.ok` is true and the HTML lands in the
 * cache named `something.jpg`. Once it does, the `access()` check below finds
 * a file and keeps serving the login page as a photo forever, long after the
 * session is healthy again. Checking the first bytes is the only reliable
 * tell: content-type can be absent or wrong, but a JPEG always opens FF D8 FF.
 */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return jpeg || png;
}

/** The mime a buffer actually is, so a PNG is never labelled a JPEG. */
export function imageMime(buf: Buffer): string {
  return buf[0] === 0x89 ? "image/png" : "image/jpeg";
}

/**
 * A cached photo, verified rather than assumed.
 *
 * Anything already on disk that is not an image gets deleted on the way past,
 * which quietly repairs a cache poisoned by an earlier session expiring — no
 * manual clearing, no reinstall.
 */
async function readCached(filePath: string): Promise<string | null> {
  try {
    await access(filePath);
  } catch {
    return null;
  }
  try {
    const buf = await readFile(filePath);
    if (looksLikeImage(buf)) return filePath;
    await unlink(filePath);
  } catch {
    // Unreadable or already gone: treat as a miss and re-fetch.
  }
  return null;
}

export async function getCachedPhotoPath(
  personId: string,
  photoUrl: string,
  cookie: string,
): Promise<string | null> {
  await mkdir(PHOTO_DIR, { recursive: true });
  const filePath = path.join(PHOTO_DIR, `${personId}.jpg`);

  const cached = await readCached(filePath);
  if (cached) return cached;

  if (inflight.has(personId)) return null;
  inflight.add(personId);
  try {
    const fullUrl = photoUrl.startsWith("http")
      ? photoUrl
      : `${BASE_URL}${photoUrl}`;
    const headers: Record<string, string> = {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    };
    // Only send the auth cookie for selfservice requests
    if (!photoUrl.startsWith("http")) {
      headers["cookie"] = cookie;
      headers["referer"] = `${BASE_URL}/cedarinfo/directory`;
    }
    const res = await fetch(fullUrl, { headers });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      console.log(`[photo] ${personId}: HTTP ${res.status} (${type})`);
      lastFailure = "http";
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    // A redirect off Self-Service means the session lapsed and this is a
    // login page, whatever status it came back with.
    if (!looksLikeImage(buf)) {
      const looksLikeLogin =
        type.includes("html") || buf.subarray(0, 64).toString().includes("<");
      console.log(
        `[photo] ${personId}: not an image — status ${res.status}, type "${type}",` +
          ` ${buf.length} bytes, starts "${buf.subarray(0, 24).toString().replace(/\s+/g, " ")}",` +
          ` landed ${res.url}`,
      );
      lastFailure = looksLikeLogin ? "auth" : "other";
      return null;
    }

    lastFailure = null;
    await writeFile(filePath, buf);
    return filePath;
  } catch {
    return null;
  } finally {
    inflight.delete(personId);
  }
}
