import { execFileSync, spawn } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Sign-in for platforms without the Swift helper (Windows): the same job done
 * with Microsoft Edge, or Chrome, driven over the Chrome DevTools Protocol.
 *
 * A dedicated profile opens as a small app window at the sign-in page; once
 * the site's own session cookie appears it is handed back, and the SSO
 * cookies are saved to a jar so the next sign-in can happen headless. The jar
 * matters for the same reason it does on macOS: Entra's session cookie has no
 * expiry, so it would otherwise die with the browser.
 */

export interface EdgeAuthOptions {
  profileDir: string;
  jarFile: string;
  cookieFile?: string;
  signInUrl: string;
  targetHost: string;
  authCookies: string[];
  silent?: boolean;
  logout?: boolean;
  browserPath?: string;
}

// A restored session cookie gets this long before it is treated as expired.
const RESTORED_SESSION_DAYS = 14;
// Edge's own new-tab page and search set cookies too; they are not part of anyone's sign-in.
const BROWSER_NOISE = /(^|\.)(msn|bing|microsoftstart)\.com$/;
const SILENT_TIMEOUT_MS = 25_000;
// Sitting on the identity provider's page this long in a silent run means it wants the user.
const SILENT_IDP_GRACE_MS = 6_000;
const VISIBLE_TIMEOUT_MS = 10 * 60_000;

/** Where Windows records an app's install location -- works even when env vars don't. */
function registryAppPath(exe: string): string[] {
  const reg = `${process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows"}\\System32\\reg.exe`;
  const found: string[] = [];
  for (const hive of ["HKLM", "HKCU"]) {
    try {
      const out = execFileSync(reg, ["query", `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, "/ve"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      const match = out.match(/REG_SZ\s+(.+\.exe)/i);
      if (match) found.push(match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // not registered in this hive
    }
  }
  return found;
}

/** Every place Edge or Chrome might be, most likely first. Raycast can run extensions with a trimmed environment, so none of this relies on env vars alone. */
export function chromiumCandidates(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];
  }
  if (process.platform !== "win32") return ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];

  const env = process.env;
  const drive = env.SystemDrive ?? "C:";
  const local = env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const programDirs = [env["ProgramFiles(x86)"], env.ProgramFiles, env.ProgramW6432, `${drive}\\Program Files (x86)`, `${drive}\\Program Files`];
  const edge = "Microsoft\\Edge\\Application\\msedge.exe";
  const chrome = "Google\\Chrome\\Application\\chrome.exe";
  const list = [
    ...programDirs.map((d) => d && `${d}\\${edge}`),
    `${local}\\${edge}`,
    ...registryAppPath("msedge.exe"),
    ...programDirs.map((d) => d && `${d}\\${chrome}`),
    `${local}\\${chrome}`,
    ...registryAppPath("chrome.exe"),
  ];
  return [...new Set(list.filter((p): p is string => Boolean(p)))];
}

export function findChromium(): string | undefined {
  return chromiumCandidates().find((p) => existsSync(p));
}

type Json = Record<string, unknown>;

class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: Json; error?: { message: string } };
      if (msg.id === undefined) return;
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result ?? {});
    };
    ws.onclose = () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("browser closed"));
      this.pending.clear();
    };
  }

  static async connect(url: string): Promise<Cdp> {
    if (typeof WebSocket === "undefined") throw new Error("This Raycast is too old to sign in on this platform.");
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Couldn't talk to the sign-in browser."));
    });
    return new Cdp(ws);
  }

  send(method: string, params: Json = {}, sessionId?: string): Promise<Json> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  session?: boolean;
  sameSite?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(profileDir: string, exited: () => boolean): Promise<string> {
  const file = path.join(profileDir, "DevToolsActivePort");
  for (let i = 0; i < 150; i++) {
    if (exited()) throw new Error("The sign-in browser closed before it started.");
    const text = await readFile(file, "utf-8").catch(() => "");
    const [port, wsPath] = text.split(/\r?\n/);
    if (port && wsPath) return `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
    await sleep(100);
  }
  throw new Error("The sign-in browser didn't start.");
}

async function saveJar(cdp: Cdp, opts: EdgeAuthOptions): Promise<void> {
  const { cookies } = (await cdp.send("Storage.getCookies")) as { cookies: Cookie[] };
  // Only the SSO session belongs in the jar -- keeping the site's own cookie
  // could hand back the very cookie that just expired.
  const now = Date.now() / 1000;
  const keep = cookies
    .filter((c) => !c.domain.includes(opts.targetHost) && !BROWSER_NOISE.test(c.domain))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      ...(c.sameSite ? { sameSite: c.sameSite } : {}),
      expires: c.session || c.expires <= 0 ? now + RESTORED_SESSION_DAYS * 86_400 : c.expires,
    }));
  await writeFile(opts.jarFile, JSON.stringify(keep), { mode: 0o600 });
}

async function restoreJar(cdp: Cdp, opts: EdgeAuthOptions): Promise<void> {
  const saved = await readFile(opts.jarFile, "utf-8").catch(() => "");
  if (!saved) return;
  const now = Date.now() / 1000;
  const cookies = (JSON.parse(saved) as Cookie[]).filter((c) => !c.expires || c.expires > now);
  if (cookies.length) await cdp.send("Storage.setCookies", { cookies });
}

/** Resolves once finished; the cookie file holds the site cookie on success and is left empty otherwise. */
export async function runEdgeAuth(opts: EdgeAuthOptions): Promise<void> {
  if (opts.logout) {
    await rm(opts.profileDir, { recursive: true, force: true }).catch(() => {});
    await rm(opts.jarFile, { force: true }).catch(() => {});
    return;
  }

  const browser = opts.browserPath ?? findChromium();
  if (!browser) {
    throw new Error(
      `Signing in needs Microsoft Edge or Google Chrome, and neither was found. Looked in: ${chromiumCandidates().join(" ; ")}`,
    );
  }

  await mkdir(opts.profileDir, { recursive: true });
  await rm(path.join(opts.profileDir, "DevToolsActivePort"), { force: true }).catch(() => {});

  const args = [
    `--user-data-dir=${opts.profileDir}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=msEdgeSidebarV2,msUndersideButton",
    ...(opts.silent ? ["--headless=new", "about:blank"] : ["--window-size=520,760", "--app=about:blank"]),
  ];
  const proc = spawn(browser, args, { stdio: "ignore", detached: false });
  let exited = false;
  proc.on("exit", () => {
    exited = true;
  });
  proc.on("error", () => {
    exited = true;
  });

  let cdp: Cdp | undefined;
  try {
    cdp = await Cdp.connect(await waitForPort(opts.profileDir, () => exited));
    await restoreJar(cdp, opts);

    const { targetInfos } = (await cdp.send("Target.getTargets")) as {
      targetInfos: { targetId: string; type: string }[];
    };
    const page = targetInfos.find((t) => t.type === "page");
    if (!page) throw new Error("The sign-in window didn't open.");
    const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true })) as {
      sessionId: string;
    };
    await cdp.send("Page.navigate", { url: opts.signInUrl }, sessionId);

    const started = Date.now();
    let onIdpSince = 0;
    let retries = 2;
    let lastJarSave = 0;
    while (!exited) {
      await sleep(800);
      const { cookies } = (await cdp.send("Storage.getCookies")) as { cookies: Cookie[] };
      const site = cookies.filter((c) => c.domain.includes(opts.targetHost));
      if (site.some((c) => opts.authCookies.includes(c.name))) {
        if (opts.cookieFile) {
          await writeFile(opts.cookieFile, site.map((c) => `${c.name}=${c.value}`).join("; "), { mode: 0o600 });
        }
        await saveJar(cdp, opts);
        break;
      }

      const { targetInfo } = (await cdp.send("Target.getTargetInfo", { targetId: page.targetId })) as {
        targetInfo: { url: string };
      };
      // The site sometimes bounces a valid assertion to its own error page; a
      // fresh start of the flow gets a new request id, which sticks.
      if (targetInfo.url.includes("NotAuthorized") && retries > 0) {
        retries--;
        await cdp.send("Page.navigate", { url: opts.signInUrl }, sessionId);
        continue;
      }

      const onIdp = !targetInfo.url.includes(opts.targetHost) && targetInfo.url.startsWith("http");
      onIdpSince = onIdp ? onIdpSince || Date.now() : 0;
      const elapsed = Date.now() - started;
      if (opts.silent && (elapsed > SILENT_TIMEOUT_MS || (onIdpSince && Date.now() - onIdpSince > SILENT_IDP_GRACE_MS))) {
        break; // needs the user
      }
      if (!opts.silent && elapsed > VISIBLE_TIMEOUT_MS) break;
      // Keep the SSO progress even if the window gets closed half-way.
      if (!opts.silent && Date.now() - lastJarSave > 5000) {
        await saveJar(cdp, opts).catch(() => {});
        lastJarSave = Date.now();
      }
    }
  } catch (error) {
    // The window being closed by the user is a cancel, not an error.
    if (!exited) throw error;
  } finally {
    if (cdp && !exited) await cdp.send("Browser.close").catch(() => {});
    cdp?.close();
    setTimeout(() => {
      if (!exited) proc.kill();
    }, 3000);
  }
}
