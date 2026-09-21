import { useEffect, useState } from "react";
import { Icon, Image } from "@raycast/api";
import {
  drainPendingCookie,
  getStoredCookie,
  hasSignedInBefore,
  refreshCookieSilently,
  storeCookie,
} from "./auth";
import { getCachedPhotoPath } from "./images";

/**
 * The one photo hook every list-of-names view shares.
 *
 * Search Cedarville Directory has always shown photos; nothing else did,
 * because each of those views only ever had an id and a name from the
 * engine, never a Self-Service session of its own. The fix is one line: the
 * directory's photo path is deterministic from the id alone
 * (`/Cedarinfo/Photo/Img?id=<id>&route=directory`), so any view holding a
 * list of ids can ask for the same session cookie search-directory already
 * knows how to get, and cache photos the same way it always has.
 *
 * Genuinely shared, on-disk cache: a face fetched once from Who's in a Class
 * is the same file Who Lives Where reads back, never refetched.
 */

const photoUrlFor = (id: string): string => `/Cedarinfo/Photo/Img?id=${id}&route=directory`;

export function usePersonPhotos(ids: string[]): Record<string, string> {
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [cookie, setCookie] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      let found = await getStoredCookie();
      if (!found) {
        const pending = await drainPendingCookie();
        if (pending) {
          await storeCookie(pending);
          found = pending;
        }
      }
      if (!found && (await hasSignedInBefore())) {
        found = await refreshCookieSilently();
      }
      if (live && found) setCookie(found);
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!cookie) return;
    for (const id of ids) {
      if (!id || paths[id]) continue;
      getCachedPhotoPath(id, photoUrlFor(id), cookie).then((path) => {
        if (path) setPaths((prev) => (prev[id] ? prev : { ...prev, [id]: path }));
      });
    }
    // ids is a plain array rebuilt every render in most callers; comparing by
    // join() avoids re-running this effect (and re-diffing every id) on a
    // render where the underlying list has not actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cookie, ids.join(",")]);

  return paths;
}

/** The icon prop every person row wants: their real photo, or a plain silhouette. */
export function personIcon(id: string | undefined, photos: Record<string, string>): Image.ImageLike {
  const path = id ? photos[id] : undefined;
  return path ? { source: path, mask: Image.Mask.Circle, fallback: Icon.Person } : Icon.Person;
}
