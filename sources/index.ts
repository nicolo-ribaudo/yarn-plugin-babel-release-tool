import type { Plugin } from "@yarnpkg/core";
import { SettingsType } from "@yarnpkg/core";

import Version from "./commands/version";
import Publish from "./commands/publish";
import CheckCycles from "./commands/check-cycles";

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
        implicitDependencies: {
          description: "",
          type: SettingsType.MAP,
          valueDefinition: {
            description: "",
            type: SettingsType.STRING,
            isArray: true,
            default: [],
          },
        },
      },
    },
  },

  commands: [Version, Publish, CheckCycles],
} as Plugin;
