import { BaseCommand } from "@yarnpkg/cli";
import { Command } from "clipanion";
import * as path from "path";
import { getHeadTags, getChangedFilesIn } from "../utils/git";
import { getRoot } from "../utils/yarn";
import {
  Workspace,
  Project,
  Locator,
  IdentHash,
  StreamReport,
} from "@yarnpkg/core";
import { forEachWorkspace } from "../utils/workspace";
import PackageGraph from "../utils/pkg-graph";

export default class Publish extends BaseCommand {
  @Command.Path("release-tool", "publish")
  async execute() {
    const { project, configuration } = await getRoot(
      "release-tool publish",
      this.context
    );

    const workspaces = await this.getTaggedPackages(project);
    const graph = new PackageGraph(workspaces);

    const report = await StreamReport.start(
      { configuration, stdout: this.context.stdout, includeLogs: true },
      async (report: StreamReport) => {
        graph.detectCycles(report);
      }
    );
    if (report.hasErrors()) {
      return report.exitCode();
    }
  }

  async getTaggedPackages(project: Project) {
    const tags = await getHeadTags("v*.*.*");
    if (!tags.length) {
      throw new Error("No version tag found");
    }

    const changes = await getChangedFilesIn("HEAD");
    const pkgs = new Set(
      changes
        .filter((filename) => path.basename(filename) === "package.json")
        .map((filename) => path.dirname(filename))
    );

    const taggedPackages: Set<Workspace> = new Set();

    await forEachWorkspace(project, async (workspace) => {
      if (pkgs.has(workspace.relativeCwd) && !workspace.manifest.private) {
        taggedPackages.add(workspace);
      }
    });

    return taggedPackages;
  }
}
