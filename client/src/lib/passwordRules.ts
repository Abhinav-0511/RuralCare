/** Checks shared by "set a new password" and "forgot password". Returns an error key or null. */
export function newPasswordProblem(next: string, repeat: string) {
  if (next.length < 8) return 'pw.tooShort' as const;
  if (next !== repeat) return 'pw.mismatch' as const;
  return null;
}
