/** MySQL: stage_flags path is truthy (boolean true, 1, "true", "1"). */
export function sqlStageFlagTruthy(jsonColumn, jsonPath) {
  const extract = `JSON_EXTRACT(${jsonColumn}, '${jsonPath}')`;
  const unquoted = `JSON_UNQUOTE(${extract})`;
  return `(
    ${extract} = CAST('true' AS JSON)
    OR ${extract} = CAST('1' AS JSON)
    OR ${unquoted} IN ('true', '1')
  )`;
}

/** MySQL: missing, boolean false, or string "false"/"0" (legacy rows store string booleans). */
export function sqlStageFlagFalsy(jsonColumn, jsonPath) {
  const extract = `JSON_EXTRACT(${jsonColumn}, '${jsonPath}')`;
  const unquoted = `JSON_UNQUOTE(${extract})`;
  return `(
    ${extract} IS NULL
    OR ${extract} = CAST('false' AS JSON)
    OR ${unquoted} IN ('false', '0', '')
  )`;
}
