import { readFile } from "node:fs/promises";
import path from "node:path";
import { buffer } from "node:stream/consumers";

import yauzl from "yauzl";

/** Read a single script without executing game Lua or extracting the archive. */
export async function readGameScript(dataDirectory: string, script: string): Promise<string> {
  if (!/^[a-zA-Z0-9_/-]+\.lua$/.test(script) || script.split("/").includes("..")) {
    throw new Error(`Invalid script path: ${script}`);
  }
  const key = `scripts/${script}`;
  try {
    return await readFile(path.join(dataDirectory, key), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return new Promise((resolve, reject) => {
    yauzl.open(path.join(dataDirectory, "databundles/scripts.zip"), { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Missing scripts archive"));
      let settled = false;
      const fail = (cause: Error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(cause);
      };
      zip.on("error", fail);
      zip.on("end", () => fail(new Error(`Script not found: ${key}`)));
      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName !== key) return zip.readEntry();
        if (entry.uncompressedSize > 8 * 1024 * 1024) return fail(new Error("Script exceeds 8 MiB"));
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail(streamError ?? new Error("Missing script stream"));
          buffer(stream).then((content) => {
            if (settled) return;
            settled = true;
            zip.close();
            resolve(content.toString("utf8"));
          }, fail);
        });
      });
      zip.readEntry();
    });
  });
}
