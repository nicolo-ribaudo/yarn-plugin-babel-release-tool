import { Project, StreamReport, Workspace, structUtils } from "@yarnpkg/core";
import { BaseCommand } from "@yarnpkg/cli";
import { Command, Option } from "clipanion";

import inquirer from "inquirer";
import semver from "semver";
import minimatch from "minimatch";

import * as ws from "../utils/workspace";
import * as git from "../utils/git";
import { compareBy } from "../utils/fp";
import { getRoot } from "../utils/yarn";

type ReleaseToolConfig = {
  get(key: "ignoreChanges"): string[];
  get(key: "implicitDependencies"): Map<string, string[]>;
};

export default class Version extends BaseCommand {
  static paths = [
    ["release-tool", "version"],
  ];

  static usage = Command.Usage({
    description: "Bump the version of the updated packages",
    details: `
      This command will check which packages have been changed since the last git tag. Then, it update the package.json files and then create a new git tag.

      If no version is specified, it will prompt for it.

      - The \`-f,--force\` option allows you to specify a package that must be updated even if git doesn't detect any change. It can be specified multiple times, for multiple packages.
      - If the \`--all\` option is specified, every package will be updated.
      - The \`--yes\` option disables the confirmation prompts.
      - If \`--tag-version-prefix\` is specified, it will be used to build the tag name (default: \`v\`).

      This command also reads two options from the .yarnrc.yml file:
      - \`releaseTool.ignoreChanges\` allows you to specify an array of file patterns to ignore when computing the updated packages.
      - \`releaseTool.implicitDependencies\` allows you to specify implicit build-time dependencies between packages. When an implicit dependency package is updated, also the implicit dependents will be released.
    `,
  });

  version: string | undefined = Option.String({ required: false });

  forceUpdates: string[] = Option.Array("-f,--force-update") || [];

  yes: boolean = Option.Boolean("--yes", false);

  tagVersionPrefix: string | undefined = Option.String("--tag-version-prefix");

  all: boolean = Option.Boolean("--all", false);

  dry: boolean = Option.Boolean("--dry", false);

  async execute() {
    const { configuration, project, cache } = await getRoot(
      "release-tool version",
      this.context
    );
    const { lastTagName, lastVersion } = await git.getLastTag(
      this.version === "prerelease"
    );

    const config = project.configuration.get(
      "releaseTool"
    ) as ReleaseToolConfig;

    const ignoreChanges = config?.get("ignoreChanges") ?? [];
    const implicitDependencies =
      config?.get("implicitDependencies") ?? new Map();

    const changedWorkspaces = await this.getChangedWorkspaces(
      project,
      lastTagName,
      ignoreChanges,
      implicitDependencies,
      new Set(this.forceUpdates)
    );

    let nextVersion;
    if (
      this.version === "patch" ||
      this.version === "prerelease" ||
      this.version === "minor" ||
      this.version === "major"
    ) {
      nextVersion = semver.inc(lastVersion, this.version);
    } else {
      nextVersion =
        this.version ??
        (await this.promptVersion(lastVersion, {
          Patch: semver.inc(lastVersion, "patch")!,
          Minor: semver.inc(lastVersion, "minor")!,
          Major: semver.inc(lastVersion, "major")!,
        }));
    }

    if (this.dry) {
      this.logChanges(nextVersion, changedWorkspaces);
      return;
    }

    if (!this.yes) {
      const confirm = await this.promptConfirm(nextVersion, changedWorkspaces);
      if (!confirm) return 0;
    }

    project.topLevelWorkspace.manifest.version = nextVersion;
    this.updateManifests(
      changedWorkspaces,
      ws.getWorkspaceChildren(project.topLevelWorkspace, project),
      nextVersion
    );

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
    implicitDependents: Map<string, string[]>,
    forced: Set<string>
  ) {
    const ignoreFilters = ignorePatterns.map((p) =>
      minimatch.filter(`!${p}`, { matchBase: true, dot: true })
    );

    const changedWorkspaces = new Set<Workspace>();
    const nameToWorkspace = new Map<string, Workspace>();

    await ws.forEachWorkspace(project, async (workspace) => {
      const name = ws.pkgName(workspace.manifest);
      nameToWorkspace.set(name, workspace);

      if (this.all || forced.has(name)) {
        changedWorkspaces.add(workspace);
        return;
      }

      const changedFiles = ignoreFilters.reduce(
        (changedFiles, filter) => changedFiles.filter(filter),
        await git.getChangedFiles(since, workspace.cwd)
      );
      if (changedFiles.length > 0) {
        changedWorkspaces.add(workspace);
      }
    });

    // The proper way of doing this would be to topologically sort the packages
    // considering the implicit dependencies, but this is easier and it works
    // with cycles: we continue looping and stop when there are no more changes.
    let changed;
    do {
      changed = false;
      for (const [dependent, dependencies] of implicitDependents) {
        const dependentWs = nameToWorkspace.get(dependent)!;
        if (changedWorkspaces.has(dependentWs)) continue;

        for (const dep of dependencies) {
          const depWs = nameToWorkspace.get(dep)!;
          if (changedWorkspaces.has(depWs)) {
            changed = true;
            changedWorkspaces.add(dependentWs);
            break;
          }
        }
      }
    } while (changed);

    return Array.from(changedWorkspaces).sort(compareBy("cwd"));
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
    this.logChanges(version, packages);

    const { confirm } = await inquirer.prompt({
      type: "confirm",
      name: "confirm",
      message: "Are you sure you want to create these versions?",
      default: false,
    });

    return confirm;
  }

  logChanges(version: string, packages: Workspace[]) {
    console.log("");
    console.log("Changes:");
    for (const { manifest: m } of packages) {
      console.log(` - ${ws.pkgName(m)}: ${m.version} => ${version}`);
    }
    console.log("");
  }

  updateManifests(
    updatedWorkspaces: Workspace[],
    allWorkspaces: Workspace[],
    nextVersion: string
  ) {
    // First, update the version of the packages to be released
    for (const { manifest } of updatedWorkspaces) {
      manifest.version = nextVersion;
    }

    // Then bump their local dependencies to the latest version
    for (const { manifest } of updatedWorkspaces) {
      for (const { manifest: dep } of allWorkspaces) {
        const { identHash } = dep.name!;

        const desc = manifest.dependencies.get(identHash);
        const workspaceRE = /workspace:(?=\^?\d)[\w\^\.\-]+/g;
        if (desc && workspaceRE.test(desc.range)) {
          const newRange = desc.range.replace(
            workspaceRE,
            `workspace:^${dep.version}`
          );
          const newDesc = structUtils.makeDescriptor(desc, newRange);
          manifest.dependencies.set(identHash, newDesc);
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
