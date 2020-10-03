import {
  Cache,
  Configuration,
  HardDependencies,
  Project,
  StreamReport,
  Workspace,
  structUtils,
  Manifest,
} from "@yarnpkg/core";
import { BaseCommand } from "@yarnpkg/cli";
import { Command } from "clipanion";

import inquirer from "inquirer";
import semver from "semver";
import minimatch from "minimatch";

import { forEachWorkspace } from "../utils/workspace";
import * as git from "../utils/git";
import { compareBy } from "../utils/fp";

export default class Version extends BaseCommand {
  @Command.Array("-f,--force-update", {
    // @ts-ignore
    description:
      "Bump the version of a pakcage even it there aren't any changed detected." +
      " This option can be specified multiple times, for multiple packages.",
  })
  forceUpdates!: string[];

  @Command.Path("release-tool", "version")
  async execute() {
    const { configuration, project, cache } = await this.getRoot();
    const { lastTagName, lastVersion } = await git.getLastTag();

    const ignoreChanges =
      project.configuration.get("releaseTool")?.get("ignoreChanges") ?? [];

    const changedWorkspaces = await this.getChangedWorkspaces(
      project,
      lastTagName,
      ignoreChanges,
      new Set(this.forceUpdates)
    );

    const nextVersion = await this.promptVersion(lastVersion, {
      Patch: semver.inc(lastVersion, "patch"),
      Minor: semver.inc(lastVersion, "minor"),
      Major: semver.inc(lastVersion, "major"),
    });

    let confirm = await this.promptConfirm(nextVersion, changedWorkspaces);
    if (!confirm) return 0;

    this.updateManifests(changedWorkspaces, nextVersion);

    const report = await StreamReport.start(
      { configuration, stdout: this.context.stdout, includeLogs: true },
      async (report: StreamReport) => {
        await project.resolveEverything({ cache, report });
      }
    );
    if (report.hasErrors()) {
      return report.exitCode();
    }

    await project.persist();

    await this.gitCommitAndTag(nextVersion);
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

  async getChangedWorkspaces(
    project: Project,
    since: string,
    ignorePatterns: string[],
    forced: Set<string>
  ) {
    const ignoreFilters = ignorePatterns.map((p) =>
      minimatch.filter(`!${p}`, { matchBase: true, dot: true })
    );

    const changedWorkspaces: Workspace[] = [];

    await forEachWorkspace(project, async (workspace) => {
      if (forced.has(pkgName(workspace.manifest))) {
        changedWorkspaces.push(workspace);
        return;
      }

      const changedFiles = ignoreFilters.reduce(
        (changedFiles, filter) => changedFiles.filter(filter),
        await git.getChangedFiles(since, workspace.cwd)
      );
      if (changedFiles.length > 0) {
        changedWorkspaces.push(workspace);
      }
    });

    return changedWorkspaces.sort(compareBy("cwd"));
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
      console.log(` - ${pkgName(m)}: ${m.version} => ${version}`);
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

  updateManifests(updatedWorkspaces: Workspace[], nextVersion: string) {
    const newRange = `workspace:^${nextVersion}`;

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
          const desc = manifest[dependencyType].get(identHash);
          if (desc?.range.startsWith("workspace:")) {
            const newDesc = structUtils.makeDescriptor(desc, newRange);
            manifest[dependencyType].set(identHash, newDesc);
          }
        }
      }
    }
  }

  async gitCommitAndTag(version: string) {
    const tag = `v${version}`;

    const { confirm } = await inquirer.prompt({
      type: "confirm",
      name: "confirm",
      message: `Are you sure you want to commit and tag these changes as "${tag}"?`,
      default: false,
    });
    if (!confirm) return 0;

    await git.commit(tag);
    await git.tag(tag);
  }
}

function pkgName(m: Manifest) {
  return m.name!.scope ? `@${m.name!.scope}/${m.name!.name}` : m.name!.name;
}
