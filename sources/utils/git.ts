import { run } from "./node";

// https://github.com/lerna/lerna/blob/master/utils/describe-ref/lib/describe-ref.js
export async function getLastTag() {
  const { stdout } = await run(`git describe --long --dirty --first-parent`);

  const [, lastTagName, lastVersion, refCount, sha, isDirty] =
    /^((?:.*@)?(.*))-(\d+)-g([0-9a-f]+)(-dirty)?$/.exec(stdout) || [];

  return {
    lastTagName,
    lastVersion,
    refCount,
    sha,
    isDirty: Boolean(isDirty),
  };
}

export async function getChangedFiles(since: string, folder: string) {
  const { stdout } = await run(`git diff --name-only ${since} -- ${folder}`);

  return stdout === "" ? [] : stdout.split("\n");
}

export async function commit(message: string) {
  await run(`git add .`);
  await run(`git commit -m ${JSON.stringify(message)}`);
}

export async function tag(message: string) {
  await run(`git tag ${JSON.stringify(message)} -m ${JSON.stringify(message)}`);
}
