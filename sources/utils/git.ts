import { run } from "./node";


// https://github.com/lerna/lerna/blob/master/utils/describe-ref/lib/describe-ref.js
export async function getLastTag(unstable: boolean = false) {
  const { stdout } = await run(
    `git describe --abbrev=0 --first-parent ${unstable ? "--match" : "--exclude"} "*-*"`
  );

  const [, name, version] =
    /^((?:.*@)?(.*))$/.exec(stdout) || [];

  return { name, version };
}

export async function getHeadTags(pattern: string) {
  const filter = JSON.stringify(pattern);
  const { stdout } = await run(
    `git tag --sort version:refname --points-at HEAD --list "${filter}"`
  );

  return stdout.split("\n").filter(Boolean);
}

export async function getChangedFiles(since: string, folder: string) {
  const { stdout } = await run(`git diff --name-only ${since} -- ${folder}`);

  return stdout === "" ? [] : stdout.split("\n");
}

export async function getChangedFilesIn(revision: string) {
  const { stdout } = await run(
    `git diff-tree --name-only --no-commit-id --root -r -c ${revision}`
  );
  return stdout.split("\n");
}

export async function commit(message: string) {
  await run(`git add .`);
  await run(`git commit -m ${JSON.stringify(message)}`);
}

export async function tag(message: string) {
  await run(`git tag ${JSON.stringify(message)} -m ${JSON.stringify(message)}`);
}
