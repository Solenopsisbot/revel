/**
 * Why starting a conversation failed, in words.
 *
 * One copy, because there are two places that start one — the sidebar and the
 * home page — and two mappings of the same codes would agree until somebody
 * added a case to one of them.
 *
 * The codes are the server's `reason` field, which is machine-readable
 * precisely so the client can say something better than the status line.
 */
export function whyNot(code: string): string {
  if (code.startsWith('no_such_account:')) return `Nobody here goes by ${code.split(':')[1]}.`;
  switch (code) {
    case 'no_such_account':
      return 'Nobody here goes by that.';
    case 'cannot_dm_yourself':
      // Not an error so much as a misunderstanding, so it does not read like
      // one. A note to self is a real feature and a different one (`rooms.ts`).
      return "That's you. Pick somebody else.";
    case 'no_handle':
      return 'Type a name first.';
    case 'foreign_idp':
      return 'That name is on another provider, which is not supported yet.';
    case 'room_id_conflict':
      return 'Something is wrong with that conversation. Tell us about it.';
    case 'unreachable':
      return 'Could not reach your provider.';
    default:
      return `That didn't work (${code}).`;
  }
}
