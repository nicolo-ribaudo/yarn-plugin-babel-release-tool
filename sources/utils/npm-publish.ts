import { Workspace, structUtils, miscUtils } from "@yarnpkg/core";
import { createHash } from "crypto";
import { packUtils } from "@yarnpkg/plugin-pack";
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

  return makePublishBody(workspace, buffer, {
    access: undefined,
    tag,
    registry,
  });
}

// Copied from https://github.com/yarnpkg/berry/blob/c34934033d4c2ce1d2b30afdae8638a38d2ba9d9/packages/plugin-npm-cli/sources/commands/npm/publish.ts#L135
async function makePublishBody(
  workspace: Workspace,
  buffer: Buffer,
  {
    access,
    tag,
    registry,
  }: { access: string | undefined; tag: string; registry: string }
) {
  const configuration = workspace.project.configuration;

  const ident = workspace.manifest.name!;
  const version = workspace.manifest.version!;

  const name = structUtils.stringifyIdent(ident);

  const shasum = createHash(`sha1`).update(buffer).digest(`hex`);
  const integrity = ssri.fromData(buffer).toString();

  if (typeof access === `undefined`) {
    if (
      workspace.manifest.publishConfig &&
      typeof workspace.manifest.publishConfig.access === `string`
    ) {
      access = workspace.manifest.publishConfig.access;
    } else if (configuration.get<string>(`npmPublishAccess`) !== null) {
      access = configuration.get<string>(`npmPublishAccess`)!;
    } else if (ident.scope) {
      access = `restricted`;
    } else {
      access = `public`;
    }
  }

  const raw = await packUtils.genPackageManifest(workspace);

  // This matches Lerna's logic:
  // https://github.com/evocateur/libnpmpublish/blob/latest/publish.js#L142
  // While the npm registry ignores the provided tarball URL, it's used by
  // other registries such as verdaccio.
  const tarballName = `${name}-${version}.tgz`;
  const tarballURL = new URL(`${name}/-/${tarballName}`, registry);

  return {
    _id: name,
    _attachments: {
      [tarballName]: {
        [`content_type`]: `application/octet-stream`,
        data: buffer.toString(`base64`),
        length: buffer.length,
      },
    },

    name,
    access,

    [`dist-tags`]: {
      [tag]: version,
    },

    versions: {
      [version]: {
        ...raw,

        _id: `${name}@${version}`,

        name,
        version,

        dist: {
          shasum,
          integrity,

          // the npm registry requires a tarball path, but it seems useless 🤷
          tarball: tarballURL.toString(),
        },
      },
    },
  };
}
