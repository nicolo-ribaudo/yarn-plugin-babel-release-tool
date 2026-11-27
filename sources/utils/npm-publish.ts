import fs from "fs";
import os from "os";
import path from "path";
import { Workspace, execUtils, miscUtils } from "@yarnpkg/core";
import { packUtils } from "@yarnpkg/plugin-pack";
import { npmPublishUtils } from "@yarnpkg/plugin-npm";

export async function generateTarball(workspace: Workspace): Promise<Buffer> {
  const files = await packUtils.genPackList(workspace);
  const pack = await packUtils.genPackStream(workspace, files);
  return miscUtils.bufferStream(pack);
}

// Copied from https://github.com/yarnpkg/berry/blob/c34934033d4c2ce1d2b30afdae8638a38d2ba9d9/packages/plugin-npm-cli/sources/commands/npm/publish.ts#L92-L104
export async function generateTarballBody(
  workspace: Workspace,
  registry: string,
  tag: string,
  provenance: boolean
) {
  const buffer = await generateTarball(workspace);

  return npmPublishUtils.makePublishBody(workspace, buffer, {
    access: undefined,
    tag,
    registry,
    provenance,
  });
}

/**
 * Stages a tarball packed by Yarn with `npm stage publish`, so that the
 * `workspace:` protocol and `publishConfig` have already been resolved.
 * The registry and the authentication are read from the npm config, not
 * from the Yarn one.
 *
 * @returns The stage id, if npm printed it.
 */
export async function stageTarball(
  workspace: Workspace,
  tarball: Buffer,
  tag: string,
  provenance: boolean
): Promise<string | undefined> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-tool-stage-"));

  try {
    const file = path.join(dir, "package.tgz");
    fs.writeFileSync(file, tarball);

    const args = ["stage", "publish", file, "--tag", tag];
    if (provenance) args.push("--provenance");

    const { code, stdout, stderr } = await execUtils.execvp("npm", args, {
      cwd: workspace.project.cwd,
    });
    if (code !== 0) {
      throw new Error(
        `\`npm stage publish\` exited with code ${code}:\n${stderr || stdout}`
      );
    }

    return /\(staged with id (.+)\)/.exec(stdout)?.[1];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
