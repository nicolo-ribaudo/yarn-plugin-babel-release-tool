import { BaseCommand } from "@yarnpkg/cli";
import { Command } from "clipanion";
import { getRoot } from "../utils/yarn";
import { Workspace, Project, StreamReport } from "@yarnpkg/core";
import { forEachWorkspace } from "../utils/workspace";
import PackageGraph from "../utils/pkg-graph";

export default class Publish extends BaseCommand {
  static paths = [
    ["release-tool", "check-cycles"],
  ];

  static usage = Command.Usage({
    description:
      "Assert that there aren't dependency cycles that can cause problems while publishing.",
  });

  async execute() {
    const { project, configuration } = await getRoot(
      "release-tool check-cycles",
      this.context
    );

    await project.restoreInstallState();

    const workspaces = await this.getWorkspaces(project);
    const graph = new PackageGraph(workspaces);

    let report = await StreamReport.start(
      { configuration, stdout: this.context.stdout },
      async (report: StreamReport) => graph.detectCycles(report)
    );

    return report.exitCode();
  }

  async getWorkspaces(project: Project) {
    const workspaces: Set<Workspace> = new Set();

    await forEachWorkspace(project, async (workspace) => {
      if (!workspace.manifest.private) workspaces.add(workspace);
    });

    return workspaces;
  }
}
