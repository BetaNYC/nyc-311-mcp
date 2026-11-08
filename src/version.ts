import { createRequire } from "node:module";

// package.json is always in the published tarball (npm includes it regardless
// of `files`), one level above dist/. Reading it keeps the server's reported
// version and the User-Agent from drifting from the published version.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string; homepage: string };

export const PACKAGE_NAME: string = pkg.name;
export const PACKAGE_VERSION: string = pkg.version;
export const PACKAGE_HOMEPAGE: string = pkg.homepage;

/** Identifies this package to the servers it reads. No email, no machine detail. */
export const USER_AGENT = `${PACKAGE_NAME}/${PACKAGE_VERSION} (+${PACKAGE_HOMEPAGE})`;
