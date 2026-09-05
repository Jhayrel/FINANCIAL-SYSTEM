/**
 * A dev-only place for Coderview to drop a dump.
 *
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  TEMPORARY, like the screen it serves.                                ║
 * ║  Remove it with Coderview: docs/11-CODERVIEW-IS-TEMPORARY.md          ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Reading the assistant's own record is what made it possible to fix it, and
 * every round of that took the same four steps: open Coderview, press Save,
 * choose a folder in a browser dialog, then tell whoever is debugging where
 * the file went. Four steps, several times a day, to move a text file six
 * inches.
 *
 * The alternative that was asked for was to open the Firestore rules so the
 * database could be read directly. That would make the whole ledger readable
 * by anyone who knows the project id, and it would not even work: the agent
 * doing the debugging has no outside network, so it cannot reach Firestore
 * whatever the rules say. It can read a file on this disk. So: a file.
 *
 * ── What keeps it safe ────────────────────────────────────────────────────
 *
 *   1. `apply: "serve"`. Vite only loads this in `vite dev`. It is not in the
 *      production bundle and there is no server in production to put it on.
 *   2. One route, one method, and it only writes.
 *   3. One directory, fixed here, never taken from the request. The filename
 *      is rebuilt from the date rather than accepted, so nothing in a request
 *      can choose a path.
 *   4. That directory is in `.gitignore`, so a dump cannot be committed.
 *
 * A dump is the whole ledger in one file. It stays on this machine.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Plugin } from "vite";

/** Ignored by git, and named so it is obvious why. */
const FOLDER = resolve(process.cwd(), "..", "CODERVIEW");

/** One megabyte of text is a very large ledger. Beyond that, refuse. */
const MOST_BYTES = 4_000_000;

export function coderviewSink(): Plugin {
  return {
    name: "coderview-sink",
    apply: "serve",

    configureServer(server) {
      server.middlewares.use("/__coderview", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;

        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MOST_BYTES) {
            res.statusCode = 413;
            res.end("Too large");
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });

        req.on("end", () => {
          if (res.writableEnded) return;
          try {
            /**
             * The name is built here, never taken from the request.
             *
             * A filename that arrives over HTTP is a path, and a path is a
             * way out of this folder. There is nothing to sanitise if there
             * is nothing to accept.
             */
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
            const file = join(FOLDER, `coderview-${stamp}.txt`);

            mkdirSync(FOLDER, { recursive: true });
            writeFileSync(file, Buffer.concat(chunks), "utf8");

            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, file }));
            server.config.logger.info(`coderview: wrote ${file}`);
          } catch (e) {
            res.statusCode = 500;
            res.end(e instanceof Error ? e.message : "Could not write");
          }
        });
      });
    },
  };
}
