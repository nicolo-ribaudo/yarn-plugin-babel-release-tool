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
import { Command, Usage } from "clipanion";

import inquirer from "inquirer";
import semver from "semver";
import minimatch from "minimatch";

import { forEachWorkspace, pkgName } from "../utils/workspace";
import * as git from "../utils/git";
import { compareBy } from "../utils/fp";
import { getRoot } from "../utils/yarn";

export default class Version extends BaseCommand {
  static usage: Usage = Command.Usage({
    description: "Bump the version of the updated packages",
    details: `
      This command will check which packages have been changed since the last git tag. Then, it update the package.json files and then create a new git tag.

      If no version is specified, it will prompt for it.

      - The \`-f,--force\` option allows you to specify a package that must be updated even if git doesn't detect any change. It can be specified multiple times, for multiple packages.
      - If the \`--all\` option is specified, every package will be updated.
      - The \`--yes\` option disables the confirmation prompts.
      - If \`--tag-version-prefix\` is specified, it will be used to build the tag name (default: \`v\`).
    `,
  });

  @Command.String({ required: false })
  version!: string | undefined;

  @Command.Array("-f,--force-update")
  forceUpdates!: string[];

  @Command.Boolean("--yes")
  yes!: boolean;

  @Command.String("--tag-version-prefix")
  tagVersionPrefix!: string | undefined;

  @Command.Boolean("--all")
  all!: boolean;

  @Command.Path("release-tool", "version")
  async execute() {
    const { configuration, project, cache } = await getRoot(
      "release-tool version",
      this.context
    );
    const { lastTagName, lastVersion } = await git.getLastTag();

    const ignoreChanges =
      project.configuration.get("releaseTool")?.get("ignoreChanges") ?? [];

    const changedWorkspaces = await this.getChangedWorkspaces(
      project,
      lastTagName,
      ignoreChanges,
      new Set(this.forceUpdates)
    );

    const nextVersion =
      this.version ??
      (await this.promptVersion(lastVersion, {
        Patch: semver.inc(lastVersion, "patch"),
        Minor: semver.inc(lastVersion, "minor"),
        Major: semver.inc(lastVersion, "major"),
      }));

    if (!this.yes) {
      const confirm = await this.promptConfirm(nextVersion, changedWorkspaces);
      if (!confirm) return 0;
    }

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
      if (this.all || forced.has(pkgName(workspace.manifest))) {
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
    const tag = (this.tagVersionPrefix ?? "v") + version;

    if (!this.yes) {
      const { confirm } = await inquirer.prompt({
        type: "confirm",
        name: "confirm",
        message: `Are you sure you want to commit and tag these changes as "${tag}"?`,
        default: false,
      });
      if (!confirm) return 0;
    }

    await git.commit(tag);
    await git.tag(tag);
  }
}
