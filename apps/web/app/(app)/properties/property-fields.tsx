import { paiseToUpiAmount } from "@rentflow/core";
import { Field } from "@/components/ui";

export interface PropertyDefaults {
  name?: string;
  address?: string | null;
  due_day?: number;
  upi_vpa?: string | null;
  payee_name?: string | null;
  electricityRatePaise?: number | null;
  late_fee_rule?: { amount_paise: number; grace_days: number } | null;
  upi_phone?: string | null;
}

const rupees = (p: number | null | undefined) => (p === null || p === undefined ? "" : paiseToUpiAmount(p).replace(/\.00$/, ""));

/** The fields shared by "add property" and "edit property". */
export function PropertyFields({ p = {} }: { p?: PropertyDefaults }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Property name" name="name" defaultValue={p.name} placeholder="Sunrise PG, Koramangala" required />
      <Field label="Address" name="address" defaultValue={p.address ?? ""} />
      <Field label="Rent due day (1–28)" name="dueDay" type="number" min={1} max={28} defaultValue={p.due_day ?? 5} required />
      <Field label="Electricity rate per unit (₹)" name="rate" inputMode="decimal" defaultValue={rupees(p.electricityRatePaise ?? 800)} hint="Leave blank if electricity isn't charged separately." />
      <Field label="UPI ID tenants pay to" name="upiVpa" defaultValue={p.upi_vpa ?? ""} placeholder="sunrisepg@okaxis" hint="Money goes straight to your bank. RentFlow never holds it." />
      <Field label="Payee name (as shown in UPI apps)" name="payeeName" defaultValue={p.payee_name ?? ""} />
      <Field label="UPI number (optional)" name="upiPhone" type="tel" inputMode="tel" defaultValue={p.upi_phone ?? ""} placeholder="98765 43210" hint="The mobile number linked to this UPI ID. Shown on bills so tenants can pay by number." />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Late fee (₹, optional)" name="lateFee" inputMode="decimal" defaultValue={rupees(p.late_fee_rule?.amount_paise)} />
        <Field label="…after how many days" name="graceDays" type="number" min={0} defaultValue={p.late_fee_rule?.grace_days ?? 5} />
      </div>
    </div>
  );
}
