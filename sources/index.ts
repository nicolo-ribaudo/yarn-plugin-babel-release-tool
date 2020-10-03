import type { Plugin } from "@yarnpkg/core";
import { SettingsType } from "@yarnpkg/core";

import VersionBump from "./commands/version-bump";

export default {
  configuration: {
    releaseTool: {
      description: "",
      type: SettingsType.SHAPE,
      properties: {
        ignoreChanges: {
          description: "",
          type: SettingsType.STRING,
          isArray: true,
          default: [],
        },
      },
    },
  },

  commands: [VersionBump],
} as Plugin;
