import { assertPaise, type Paise } from "../money";

/**
 * Unique payable amounts (CLAUDE.md §7.5). Algorithm, also in docs/DECISIONS.md:
 *
 * 1. base = total rounded down to the rupee.
 * 2. Try base + 1 paisa … base + 99 paise; take the first amount no other open
 *    bill of the property is using.
 * 3. If all 99 are taken, step the rupee down (base − ₹1, base − ₹2, …) and repeat.
 *
 * So the tenant never pays more than 99 paise above the total; when the rupee is
 * stepped down they pay slightly less and the shortfall carries to the next bill.
 * Bills with nothing to pay (total ≤ 0) get payable 0 and aren't matched by amount.
 */
export function assignPayableAmounts<K>(bills: { key: K; totalPaise: Paise }[], taken: Iterable<Paise>): Map<K, Paise> {
  const used = new Set<Paise>(taken);
  const result = new Map<K, Paise>();
  for (const bill of bills) {
    assertPaise(bill.totalPaise, "total");
    if (bill.totalPaise <= 0) {
      result.set(bill.key, 0);
      continue;
    }
    const payable = pickPayable(bill.totalPaise, used);
    used.add(payable);
    result.set(bill.key, payable);
  }
  return result;
}

function pickPayable(totalPaise: Paise, used: Set<Paise>): Paise {
  const base = Math.floor(totalPaise / 100) * 100;
  for (let rupee = base; rupee >= 0; rupee -= 100) {
    for (let suffix = 1; suffix <= 99; suffix++) {
      const candidate = rupee + suffix;
      if (!used.has(candidate)) return candidate;
    }
  }
  throw new Error(`No unique payable amount left below ${totalPaise} paise`);
}
