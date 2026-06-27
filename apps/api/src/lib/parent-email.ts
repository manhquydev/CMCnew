// Resolve a student's guardian email addresses for outbound mail. A student has no email of their
// own (homework-platform positioning) — notification mail goes to the linked parent(s) who opted in.

import type { Prisma } from '@cmc/db';

type Tx = Prisma.TransactionClient;

export interface ParentRecipient {
  parentAccountId: string;
  email: string;
  displayName: string;
}

/** Parents who have an email AND opted into notification email (digests/reminders). */
export async function notifiableParentEmails(tx: Tx, studentId: string): Promise<ParentRecipient[]> {
  const guardians = await tx.guardian.findMany({
    where: { studentId },
    select: {
      parent: { select: { id: true, email: true, displayName: true, isActive: true, emailNotifications: true } },
    },
  });
  const out: ParentRecipient[] = [];
  for (const g of guardians) {
    const p = g.parent;
    if (p?.email && p.isActive && p.emailNotifications) {
      out.push({ parentAccountId: p.id, email: p.email, displayName: p.displayName });
    }
  }
  return out;
}
