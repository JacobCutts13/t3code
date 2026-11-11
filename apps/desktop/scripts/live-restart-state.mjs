export function makeLiveRestartTracker({ files, hashFile }) {
  let baseline = new Map();
  const current = new Map();
  // Serialized so a slow hash of an older write never overwrites a newer result.
  let queue = Promise.resolve();

  const changed = () => files.filter((file) => current.get(file) !== baseline.get(file));
  const enqueue = (work) => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next.then(changed);
  };

  return {
    // Call before launching the app: whatever is on disk now is what it will load.
    resetBaseline: () =>
      enqueue(async () => {
        const hashes = await Promise.all(files.map(async (file) => [file, await hashFile(file)]));
        baseline = new Map(hashes);
        for (const [file, hash] of hashes) current.set(file, hash);
      }),
    refresh: (file) =>
      enqueue(async () => {
        current.set(file, await hashFile(file));
      }),
  };
}
