import { useCallback, useEffect, useRef, useState } from "react";

/** The invoice a completed sheet paid, as s11's hold and its lines need it. */
export interface CapturedPayment {
  id: string;
  title: string;
}

/**
 * What Dues (s11, `app/(app)/dues.tsx`) keeps between visits, by chapter,
 * for the product session: the captured payments, and which were held when
 * the last visit ended. Dues is pushed on the stack and unmounts when the
 * member goes back (`spec/ui/mobile/navigation.md` § Going back), so a hold
 * kept in the screen's own state would end on the way out, and a member back
 * a minute later would find Pay live on an invoice they had just paid. Kept
 * here, the hold ends only as the screen's "How long the hold lasts" says.
 *
 * Dropped with the query cache on sign-out or an account swap
 * (`clearProductQueryCache`), so the next member on the phone never sees a
 * line about someone else's payment.
 */
interface DuesVisitMemory {
  payments: readonly CapturedPayment[];
  heldAtLeave: readonly string[];
}

const memoryByChapter = new Map<string, DuesVisitMemory>();

/** Forgets every chapter's captured payments. */
export function forgetDuesMemory(): void {
  memoryByChapter.clear();
}

/**
 * The captured payments as state, and the ids held at the last leave as a
 * ref, both seeded from and written back to the memory. `remember` writes the
 * ref back, which a ref change can't trigger by itself.
 */
export function useDuesMemory(chapterId: string | null) {
  const key = chapterId ?? "no-chapter";
  const [saved] = useState(() => memoryByChapter.get(key));
  const [payments, setPayments] = useState<readonly CapturedPayment[]>(
    saved?.payments ?? [],
  );
  const heldAtLeaveRef = useRef<readonly string[]>(saved?.heldAtLeave ?? []);
  const paymentsRef = useRef(payments);
  const remember = useCallback(() => {
    const memory = {
      payments: paymentsRef.current,
      heldAtLeave: heldAtLeaveRef.current,
    };
    if (memory.payments.length === 0) memoryByChapter.delete(key);
    else memoryByChapter.set(key, memory);
  }, [key]);
  useEffect(() => {
    paymentsRef.current = payments;
    remember();
  }, [payments, remember]);
  return { payments, setPayments, heldAtLeaveRef, remember };
}
