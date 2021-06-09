import { IdentHash, Workspace, Report, MessageName } from "@yarnpkg/core";
import { pkgName } from "./workspace";

abstract class Node {
  protected dependencies: Set<Node> = new Set();
  protected dependents: Set<Node> = new Set();

  addDependent(node: Node) {
    this.dependents.add(node);
    node.dependencies.add(this);
  }

  unlink() {
    this.dependencies.forEach((dep) => dep.dependents.delete(this));
    this.dependents.forEach((dep) => dep.dependencies.delete(this));
  }

  *dependenciesIterator() {
    yield* this.dependencies;
  }

  *dependentsIterator() {
    yield* this.dependents;
  }

  hasDependencies() {
    return this.dependencies.size > 0;
  }

  abstract intersects(node: Node): boolean;
  abstract workspacesIterator(): Iterable<Workspace>;
  abstract toString(): string;
  abstract deleteWorkspace(workspace: Workspace): boolean;
}

class PackageNode extends Node {
  constructor(public workspace: Workspace) {
    super();
  }

  intersects(node: Node) {
    for (const ws of node.workspacesIterator()) {
      if (ws === this.workspace) {
        return true;
      }
    }
    return false;
  }

  *workspacesIterator() {
    yield this.workspace;
  }

  toString() {
    return pkgName(this.workspace.manifest);
  }

  deleteWorkspace(workspace: Workspace) {
    return this.workspace === workspace;
  }
}

export default class PackageGraph extends Set<Node> {
  private packages = new Map<IdentHash, PackageNode>();

  constructor(workspaces: Set<Workspace>) {
    super();

    workspaces.forEach((workspace) => {
      const node = new PackageNode(workspace);
      this.packages.set(workspace.locator.identHash, node);
      this.add(node);
    });

    this.packages.forEach((node) => {
      node.workspace.manifest.dependencies.forEach((desc, depHash) => {
        this.packages.get(depHash)?.addDependent(node);
      });
    });
  }

  getProcessableWorkspaces(): Set<Workspace> {
    let packages = new Set<Workspace>();

    // NOTE: When we'll add support for cycles, the algorithm should be:
    // 1. Get the packages with zero dependencies
    // 2. Otherwise, get a single cycle with zero dependencies

    for (const node of this) {
      if (!node.hasDependencies()) {
        for (const ws of node.workspacesIterator()) {
          packages.add(ws);
        }
      }
    }

    return packages;
  }

  delete(node: Node): boolean {
    if (this.has(node)) {
      node.unlink();
    }

    return super.delete(node);
  }

  deleteWorkspace(ws: Workspace) {
    const node = this.packages.get(ws.locator.identHash);
    if (node) {
      return node.deleteWorkspace(ws) && this.delete(node);
    }
    return false;
  }

  detectCycles(report: Report) {
    const walkStack: PackageNode[] = [];
    const visited = new WeakSet<Node>();

    const visit = (node: Node) => {
      for (let i = 0; i < walkStack.length - 1; i++) {
        if (node === walkStack[i]) {
          const cycle = walkStack.slice(i);
          cycle.push(walkStack[i]);

          report.reportError(
            MessageName.CYCLIC_DEPENDENCIES,
            `Dependency cycle detected: ${cycle.join(" -> ")}`
          );
          return;
        }
      }

      if (visited.has(node)) return;
      visited.add(node);

      walkWithStack(node);
    };

    function walkWithStack(node: Node) {
      if (!(node instanceof PackageNode)) {
        report.reportError(
          MessageName.CYCLIC_DEPENDENCIES,
          `Dependency cycle detected: ${node}`
        );
        return;
      }

      walkStack.push(node);
      for (const dep of node.dependenciesIterator()) {
        visit(dep);
      }
      walkStack.pop();
    }

    this.forEach(visit);
  }

  // NOTE: I started implementing support for flattening cycles (similar to
  // https://github.com/lerna/lerna/pull/2185), but apparently we don't have
  // dependencies cycles anymore!
  // For this reason, I haven't tested the collapsing logic and it just throws
  // an error. If you'll need to add support for cycles, make sure to check that this works.
  /*
  private workspaceToCycle = new Map<IdentHash, CycleNode>();

  collapseCycles(report: Report) {
    const walkStack: Node[] = [];

    const visit = (node: Node): { unwind: number } => {
      for (let i = 0; i < walkStack.length - 1; i++) {
        if (node.intersects(walkStack[i])) {
          const cycle = new CycleNode();

          [node, ...walkStack.slice(i)].forEach((node) => {
            cycle.add(node, this.workspaceToCycle);
            this.delete(node);
          });

          this.add(cycle);

          report.reportError(
            MessageName.CYCLIC_DEPENDENCIES,
            `Dependency cycle detected: ${walkStack.slice(i).join(",")}`
          );

          return { unwind: walkStack.length - 1 };
        }
      }

      return walkWithStack(node);
    };

    function walkWithStack(node: Node): { unwind: number } {
      walkStack.push(node);

      for (const dep of node.dependenciesIterator()) {
        const { unwind } = visit(dep);
        if (unwind > 0) {
          walkStack.pop();
          return { unwind: unwind - 1 };
        }
      }

      walkStack.pop();

      return { unwind: 0 };
    }

    this.forEach(visit);
  }*/
}

/*
class CycleNode extends Node {
  private nodes: Set<Node> = new Set();
  private workspaces: Set<Workspace> = new Set();

  add(node: Node, workspaceToCycle: Map<IdentHash, CycleNode>) {
    this.nodes.add(node);
    for (const ws of node.workspacesIterator()) {
      workspaceToCycle.set(ws.locator.identHash, this);
      this.workspaces.add(ws);
    }

    for (const dep of node.dependenciesIterator()) {
      if (!node.intersects(this)) {
        this.dependencies.add(dep);
      }
    }

    for (const dep of node.dependentsIterator()) {
      if (!node.intersects(this)) {
        this.dependents.add(dep);
      }
    }
  }

  intersects(node: Node) {
    for (const ws of node.workspacesIterator()) {
      if (this.workspaces.has(ws)) return true;
    }
    return false;
  }

  *workspacesIterator() {
    yield* this.workspaces;
  }

  toString() {
    return `(cycle: ${Array.from(this.nodes).join(" -> ")})`;
  }
}
*/
