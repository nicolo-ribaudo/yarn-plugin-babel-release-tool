import { Workspace, structUtils, miscUtils } from "@yarnpkg/core";
import { createHash } from "crypto";
import { packUtils } from "@yarnpkg/plugin-pack";
import { npmPublishUtils } from "@yarnpkg/plugin-npm";
import ssri from "ssri";

// Copied from https://github.com/yarnpkg/berry/blob/c34934033d4c2ce1d2b30afdae8638a38d2ba9d9/packages/plugin-npm-cli/sources/commands/npm/publish.ts#L92-L104
export async function generateTarballBody(
  workspace: Workspace,
  registry: string,
  tag: string
) {
  const files = await packUtils.genPackList(workspace);
  const pack = await packUtils.genPackStream(workspace, files);
  const buffer = await miscUtils.bufferStream(pack);

  return npmPublishUtils.makePublishBody(workspace, buffer, {
    access: undefined,
    tag,
    registry,
  });
}
