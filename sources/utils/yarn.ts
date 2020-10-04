import { Project, Configuration, Cache, CommandContext } from "@yarnpkg/core";

export async function getRoot(
  command: string,
  context: CommandContext
): Promise<{
  configuration: Configuration;
  project: Project;
  cache: Cache;
}> {
  const configuration = await Configuration.find(context.cwd, context.plugins);

  const [{ project, workspace }, cache] = await Promise.all([
    Project.find(configuration, context.cwd),
    Cache.find(configuration, { immutable: true }),
  ]);

  if (project.topLevelWorkspace !== workspace) {
    throw new Error(
      `The "yarn ${command}" command must be run in the root workspace.`
    );
  }

  return { configuration, project, cache };
}
