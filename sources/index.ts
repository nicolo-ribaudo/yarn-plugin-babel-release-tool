import type { Plugin } from "@yarnpkg/core";
import { SettingsType } from "@yarnpkg/core";

import Version from "./commands/version";

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

  commands: [Version],
} as Plugin;
