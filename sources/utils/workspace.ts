import type { Project, Workspace } from "@yarnpkg/core";

import { asyncMap } from "./fp";

export function forEachWorkspace(
  project: Project,
  callback: (workspace: Workspace) => Promise<unknown>
): Promise<unknown> {
  return asyncMap(
    getWorkspaceChildren(project.topLevelWorkspace, project),
    callback
  );
}

export function getWorkspaceChildren(
  rootWorkspace: Workspace,
  project: Project
) {
  const childrens = [rootWorkspace];

  for (const workspace of childrens) {
    for (const childWorkspaceCwd of workspace.workspacesCwds) {
      const childWorkspace = project.workspacesByCwd.get(childWorkspaceCwd);
      if (childWorkspace) {
        childrens.push(childWorkspace);
      }
    }
  }
  childrens.shift(); // Remove the root workspace

  return childrens;
}
