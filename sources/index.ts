import type { Plugin } from "@yarnpkg/core";

import VersionBump from "./commands/version-bump";

export default {
  commands: [VersionBump],
} as Plugin;
