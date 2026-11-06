import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

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
 * Dropped with the query cache on sign-out, an account swap
 * (`clearProductQueryCache`) and a chapter switch (`lib/frapp-client.tsx`),
 * which is when the screen's hold ends anyway (`spec/ui/mobile/screens.md`
 * s11). A Dues screen still mounted across the drop (it unmounts a commit
 * later, and its leave writes back) can't bring it back: each forget starts a
 * new generation, and a screen writes only into the generation it read from.
 */
interface DuesVisitMemory {
  payments: readonly CapturedPayment[];
  heldAtLeave: readonly string[];
}

const memoryByChapter = new Map<string, DuesVisitMemory>();
let generation = 0;

/** Forgets every chapter's captured payments. */
export function forgetDuesMemory(): void {
  memoryByChapter.clear();
  generation += 1;
}

/**
 * The captured payments as state, and the ids held at the last leave as a
 * ref, both seeded from and written back to the memory, which is the source
 * of truth:
 *
 * - `setPayments` writes through to the memory as it sets the state, so a
 *   capture that lands after the member has already gone back (a payment
 *   sheet that finished over a popped Dues) still holds the invoice on the
 *   next visit.
 * - Each focus reads the memory again, so a Dues uncovered after a second one
 *   was pushed over it (from a notification) shows what that one captured,
 *   rather than writing its own older list back on its next leave. A focus
 *   after a forget adopts the new generation, so the screen goes on saving.
 * - `remember` writes the ref back, which a ref change can't trigger by
 *   itself.
 */
export function useDuesMemory(chapterId: string | null) {
  const key = chapterId ?? "no-chapter";
  const [seed] = useState(() => memoryByChapter.get(key));
  const [payments, setPaymentsState] = useState<readonly CapturedPayment[]>(
    seed?.payments ?? [],
  );
  const heldAtLeaveRef = useRef<readonly string[]>(seed?.heldAtLeave ?? []);
  const paymentsRef = useRef(payments);
  const readInRef = useRef(generation);
  const remember = useCallback(() => {
    // Forgotten since this screen read it: the payments belong to a session
    // or chapter that has ended.
    if (generation !== readInRef.current) return;
    const memory = {
      payments: paymentsRef.current,
      heldAtLeave: heldAtLeaveRef.current,
    };
    if (memory.payments.length === 0) memoryByChapter.delete(key);
    else memoryByChapter.set(key, memory);
  }, [key]);
  const setPayments = useCallback(
    (
      next:
        | readonly CapturedPayment[]
        | ((current: readonly CapturedPayment[]) => readonly CapturedPayment[]),
    ) => {
      paymentsRef.current =
        typeof next === "function" ? next(paymentsRef.current) : next;
      remember();
      setPaymentsState(paymentsRef.current);
    },
    [remember],
  );
  useFocusEffect(
    useCallback(() => {
      readInRef.current = generation;
      const memory = memoryByChapter.get(key);
      const saved = memory?.payments ?? [];
      if (saved !== paymentsRef.current) {
        paymentsRef.current = saved;
        setPaymentsState(saved);
      }
      heldAtLeaveRef.current = memory?.heldAtLeave ?? [];
    }, [key]),
  );
  return { payments, setPayments, heldAtLeaveRef, remember };
}
