/**
 * Reading an activity line back into its fields.
 *
 * `describeRow` stores a row as one line, "2026-09-06 | Spending | Maya | - |
 * Dito Prepaid | PHP 199.00 | Paid", because a database rule can check a
 * string and cannot check a nested object. Shown as it is, that line is a wall
 * of pipes under every event. Events are append only, so the lines already
 * stored cannot be rewritten into a friendlier shape: they are read as they
 * are, here, and the screen shows the parts.
 */

export interface RowFacts {
  readonly date: string;
  readonly type: string;
  readonly from: string;
  readonly to: string;
  readonly item: string;
  readonly amount: string;
  readonly fee: string;
  readonly status: string;
}

/**
 * The first six parts are fixed. After them a fee is marked by its word and
 * anything else is the status. A dash is a blank field. Null for a line that
 * is not one of these.
 */
export function readRow(line: string | undefined): RowFacts | null {
  if (!line) return null;
  const parts = line.split(" | ");
  if (parts.length < 6) return null;

  const [date = "", type = "", from = "", to = "", item = "", amount = "", ...rest] = parts;
  const blank = (v: string): string => (v === "-" ? "" : v);

  return {
    date,
    type,
    from: blank(from),
    to: blank(to),
    item: blank(item),
    amount,
    fee: rest.find((p) => p.startsWith("fee "))?.slice(4) ?? "",
    status: rest.find((p) => !p.startsWith("fee ")) ?? "",
  };
}

export const FACT_LABEL: Record<keyof RowFacts, string> = {
  date: "Date",
  type: "Type",
  from: "From",
  to: "To",
  item: "Item",
  amount: "Amount",
  fee: "Fee",
  status: "Status",
};

export interface FactChange {
  readonly key: keyof RowFacts;
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

/** The fields an edit changed, in the order the form asks for them. */
export function factChanges(before: string | undefined, after: string | undefined): FactChange[] {
  const was = readRow(before);
  const now = readRow(after);
  if (!was || !now) return [];
  return (Object.keys(FACT_LABEL) as (keyof RowFacts)[])
    .filter((key) => was[key] !== now[key])
    .map((key) => ({ key, label: FACT_LABEL[key], before: was[key], after: now[key] }));
}
