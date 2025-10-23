import { BaseCommand } from "@yarnpkg/cli";
import { Command, Option, UsageError } from "clipanion";
import path from "path";
import pLimit from "p-limit";
import inquirer from "inquirer";
import { getHeadTags, getChangedFilesIn } from "../utils/git";
import { getRoot } from "../utils/yarn";
import {
  Workspace,
  Project,
  StreamReport,
  Report,
  scriptUtils,
  Configuration,
  MessageName,
} from "@yarnpkg/core";
import { npmConfigUtils, npmHttpUtils } from "@yarnpkg/plugin-npm";
import { forEachWorkspace, pkgName } from "../utils/workspace";
import PackageGraph from "../utils/pkg-graph";
import * as npmPublishUtils from "../utils/npm-publish";
import { compareBy } from "../utils/fp";

export default class Publish extends BaseCommand {
  static paths = [
    ["release-tool", "publish"],
  ];

  static usage = Command.Usage({
    description: "Publish on npm the packages updated in the last version",
    details: `
      This command will first check that the current git HEAD correspond to a version tag (generated with \`yarn release-tool version\`), then it will upload the packages modified in that commit to the npm registry.

      - The \`--tag\` option allows you to specify how to tag this release on npm (default: \`latest\`)
      - The \`--yes\` option disables the confirmation prompt.
      - If \`--tag-version-prefix\` is specified, it will be used to find the correct tag name (default: \`v\`).
    `,
  });

  yes: boolean = Option.Boolean("--yes", false);

  tag: string = Option.String("--tag", "latest");

  tagVersionPrefix: string = Option.String("--tag-version-prefix", "v");

  provenance: boolean = Option.Boolean("--provenance", false);

  async execute() {
    const { project, configuration } = await getRoot(
      "release-tool publish",
      this.context
    );

    await project.restoreInstallState();

    const workspaces = await this.getTaggedPackages(project);
    const graph = new PackageGraph(workspaces);

    let report = await StreamReport.start(
      { configuration, stdout: this.context.stdout, includeLogs: true },
      async (report: StreamReport) => {
        graph.detectCycles(report);
        if (report.hasErrors()) return;

        const metadata = await this.packPackages(
          workspaces,
          configuration,
          report
        );
        if (report.hasErrors()) return;

        if (!this.yes) {
          const confirm = await this.promptConfirm(workspaces);
          if (!confirm) return;
        }

        await report.startTimerPromise(
          `Publishing ${workspaces.size} packages`,
          () => this.publishPackages(graph, metadata, configuration, report)
        );
        if (report.hasErrors()) return;

        await this.runLifecycleScript(workspaces, "postpublish", { report });
      }
    );

    return report.exitCode();
  }

  async getTaggedPackages(project: Project) {
    const tags = await getHeadTags(`${this.tagVersionPrefix}*.*.*`);
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

  async packPackages(
    workspaces: Set<Workspace>,
    configuration: Configuration,
    report: Report
  ) {
    const limit = pLimit(4);
    const metadata = new Map<Workspace, { registry: string; body: Object }>();

    const promises = Array.from(workspaces, (workspace) =>
      limit(async () => {
        const meta = await this.packPackage(workspace, configuration, report);
        metadata.set(workspace, meta);
      })
    );
    await Promise.all(promises);

    return metadata;
  }

  async packPackage(
    workspace: Workspace,
    configuration: Configuration,
    report: Report
  ) {
    if (workspace.manifest.private)
      throw new UsageError("Private workspaces cannot be published");
    if (workspace.manifest.name === null || workspace.manifest.version === null)
      throw new UsageError(
        "Workspaces must have valid names and versions to be published on an external registry"
      );

    const registry = npmConfigUtils.getPublishRegistry(workspace.manifest, {
      configuration,
    });

    await scriptUtils.maybeExecuteWorkspaceLifecycleScript(
      workspace,
      "prepublish",
      { report }
    );
    await scriptUtils.maybeExecuteWorkspaceLifecycleScript(
      workspace,
      "prepublishOnly",
      { report }
    );
    await scriptUtils.maybeExecuteWorkspaceLifecycleScript(
      workspace,
      "prepack",
      { report }
    );

    const body = await npmPublishUtils.generateTarballBody(
      workspace,
      registry,
      this.tag,
      this.provenance,
    );

    return {
      registry,
      body,
    };
  }

  async publishPackages(
    graph: PackageGraph,
    metadata: Map<Workspace, { registry: string; body: Object }>,
    configuration: Configuration,
    report: StreamReport
  ) {
    let limit = pLimit(4);

    do {
      const chunk = graph.getProcessableWorkspaces();

      if (chunk.size === 0 && graph.size > 0) {
        throw new Error(
          "Some packages could not be published:\n" +
            Array.from(graph, (node) => ` - ${node}`).join("\n")
        );
      }

      const promises: Promise<unknown>[] = [];
      for (const workspace of chunk) {
        const { body, registry } = metadata.get(workspace)!;

        promises.push(
          limit(async () => {
            try {
              await this.publishPackage(
                workspace,
                body,
                registry,
                configuration,
                report
              );
            } catch (e) {
              report.reportError(
                MessageName.UNNAMED,
                `Error while publishing ${workspace.manifest.name}:\n${e}`
              );
              throw e;
            } finally {
              graph.deleteWorkspace(workspace);
            }
          })
        );
      }

      await Promise.allSettled(promises);
    } while (graph.size > 0);
  }

  async publishPackage(
    workspace: Workspace,
    body: Object,
    registry: string,
    configuration: Configuration,
    report: Report
  ) {
    const ident = workspace.manifest.name!;

    try {
      await npmHttpUtils.put(npmHttpUtils.getIdentUrl(ident), body, {
        configuration,
        registry,
        ident,
        // @ts-ignore
        jsonResponse: true,
        allowOidc: Boolean(process.env.CI && (process.env.GITHUB_ACTIONS || process.env.GITLAB))
      });

      report.reportInfo(
        null,
        `Published ${pkgName(workspace.manifest)} ${workspace.manifest.version}`
      );
    } catch (error) {
      if (error.name !== `HTTPError`) {
        throw error;
      } else {
        const message =
          error.response.body && error.response.body.error
            ? error.response.body.error
            : `The remote server answered with HTTP ${error.response.statusCode} ${error.response.statusMessage}`;

        report.reportError(
          MessageName.NETWORK_ERROR,
          `[${pkgName(workspace.manifest)}] ${message}`
        );
      }
    }
  }

  async promptConfirm(packages: Set<Workspace>) {
    const pkgs = Array.from(packages).sort(compareBy("cwd"));

    console.log("");
    console.log("Updated packages:");
    for (const { manifest: m } of pkgs) {
      console.log(` - ${pkgName(m)}: ${m.version}`);
    }
    console.log("");

    const { confirm } = await inquirer.prompt({
      type: "confirm",
      name: "confirm",
      message: "Are you sure you want to create these versions?",
      default: false,
    });

    return confirm as boolean;
  }

  async runLifecycleScript(workspaces, script, opts) {
    const limit = pLimit(4);
    const promises: Promise<unknown>[] = [];
    for (const ws of workspaces) {
      promises.push(
        limit(() =>
          scriptUtils.maybeExecuteWorkspaceLifecycleScript(ws, script, opts)
        )
      );
    }
    await Promise.all(promises);
  }
}
