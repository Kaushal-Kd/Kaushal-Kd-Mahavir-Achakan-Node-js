export async function processImageUploadBatch(
  files,
  {
    prepareFile,
    uploadFile,
    isPreparationCancelled = () => false,
    maxFileBytes,
    workerCount = 2,
    onProgress,
  }
) {
  const uploadable = files.filter((file) => file && file.size <= maxFileBytes);
  const results = new Array(uploadable.length);
  const preparedFiles = [];

  for (let index = 0; index < uploadable.length; index += 1) {
    try {
      const prepared = await prepareFile(uploadable[index]);
      if (prepared) preparedFiles.push({ index, file: prepared });
      else results[index] = { ok: false, cancelled: true };
    } catch (error) {
      results[index] = isPreparationCancelled(error)
        ? { ok: false, cancelled: true }
        : { ok: false, error };
    }
  }

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, workerCount), preparedFiles.length) },
    async () => {
      while (cursor < preparedFiles.length) {
        const prepared = preparedFiles[cursor];
        cursor += 1;
        try {
          const publicUrl = await uploadFile(prepared.file);
          results[prepared.index] = { ok: true, publicUrl };
          onProgress?.();
        } catch (error) {
          results[prepared.index] = { ok: false, error };
        }
      }
    }
  );
  await Promise.all(workers);

  return {
    uploaded: results.filter((result) => result?.ok && result.publicUrl).map((result) => result.publicUrl),
    failed: results.filter((result) => result && !result.ok && !result.cancelled).length,
    skipped: files.length - uploadable.length,
    results,
  };
}
