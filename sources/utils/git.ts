import { run } from "./node";

// https://github.com/lerna/lerna/blob/master/utils/describe-ref/lib/describe-ref.js
export async function getLastGitTag() {
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
