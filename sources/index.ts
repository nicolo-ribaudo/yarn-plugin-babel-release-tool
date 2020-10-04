import type { Plugin } from "@yarnpkg/core";
import { SettingsType } from "@yarnpkg/core";

import Version from "./commands/version";
import Publish from "./commands/publish";

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

  commands: [Version, Publish],
} as Plugin;
