import {
  Cache,
  Configuration,
  HardDependencies,
  Project,
  StreamReport,
  Workspace,
} from "@yarnpkg/core";
import { BaseCommand } from "@yarnpkg/cli";
import { Command } from "clipanion";

import inquirer from "inquirer";
import semver from "semver";

import { forEachWorkspace } from "../utils/workspace";
import { getLastGitTag, getChangedFiles } from "../utils/git";
import { compareBy } from "../utils/fp";
import { IGNORE } from "../config";

export default class VersionBump extends BaseCommand {
  @Command.Path("version", "bump")
  async execute() {
    const { configuration, project, cache } = await this.getRoot();
    const { lastTagName, lastVersion } = await getLastGitTag();
    const changedWorkspaces = await this.getChangedWorkspaces(
      project,
      lastTagName
    );

    const nextVersion = await this.promptVersion(lastVersion, {
      Patch: semver.inc(lastVersion, "patch"),
      Minor: semver.inc(lastVersion, "minor"),
      Major: semver.inc(lastVersion, "major"),
    });

    const confirm = await this.promptConfirm(nextVersion, changedWorkspaces);
    if (!confirm) return 0;

    this.updateManifests(changedWorkspaces, nextVersion);

    const report = await StreamReport.start(
      { configuration, stdout: this.context.stdout, includeLogs: true },
      (report: StreamReport) => project.resolveEverything({ cache, report })
    );

    await project.persist();

    return report.exitCode();
  }

  async getRoot(): Promise<{
    configuration: Configuration;
    project: Project;
    cache: Cache;
  }> {
    const configuration = await Configuration.find(
      this.context.cwd,
      this.context.plugins
    );

    const [{ project, workspace }, cache] = await Promise.all([
      Project.find(configuration, this.context.cwd),
      Cache.find(configuration, { immutable: true }),
    ]);

    if (project.topLevelWorkspace !== workspace) {
      throw new Error(
        `The "yarn version bump" command must be run in the root workspace.`
      );
    }

    return { configuration, project, cache };
  }

  async getChangedWorkspaces(project: Project, since: string) {
    const changedWorkspaces: Workspace[] = [];

    await forEachWorkspace(project, async (workspace) => {
      let changedFiles = await getChangedFiles(since, workspace.cwd);
      changedFiles = changedFiles.filter((file) => !IGNORE(file));
      if (changedFiles.length === 0) return;

      changedWorkspaces.push(workspace);
    });

    changedWorkspaces.some(compareBy("cwd"));

    return changedWorkspaces;
  }

  async promptVersion(
    lastVersion: string,
    nextVersions: Record<string, string>
  ): Promise<string> {
    const choices = Object.entries(nextVersions).map(([label, version]) => ({
      name: `${label} (${version})`,
      value: version,
    }));

    const { version } = await inquirer.prompt({
      type: "list",
      name: "version",
      message: `Select a new version (currently ${lastVersion}):`,
      choices,
    });

    return version;
  }

  async promptConfirm(version: string, packages: Workspace[]) {
    console.log("");
    console.log("Changes:");
    for (const { manifest: m } of packages) {
      const fullname = m.name!.scope
        ? `@${m.name!.scope}/${m.name!.name}`
        : m.name!.name;

      console.log(` - ${fullname}: ${m.version} => ${version}`);
    }
    console.log("");

    const { confirm } = await inquirer.prompt({
      type: "confirm",
      name: "confirm",
      message: "Are you sure you want to create these versions?",
      default: false,
    });

    return confirm;
  }

  updateManifests(updatedWorkspaces, nextVersion) {
    const dependencyTypes: HardDependencies[] = [
      "dependencies",
      "devDependencies",
    ];
    for (const workspace of updatedWorkspaces) {
      const { manifest } = workspace;
      manifest.version = nextVersion;

      for (const dependencyType of dependencyTypes) {
        for (const workspace of updatedWorkspaces) {
          const { identHash } = workspace.manifest.name!;
          const depVersion = manifest[dependencyType].get(identHash);
          if (depVersion?.range.startsWith("workspace:")) {
            depVersion.range = `workspace:^${nextVersion}`;
          }
        }
      }
    }
  }
}
