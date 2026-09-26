"""
Rebuild the 2023, 2024 and 2025 spending workbooks as ledger rows.

READ-ONLY. Every workbook is opened with read_only=True and data_only=True
and never saved. Nothing under "MY THINGS/" is touched. See ../CLAUDE.md.

The output is the owner's financial history, so it is written only to the
path given with --out, which must be outside the repository (the script
refuses a path inside it). Nothing this script produces is ever committed.

Each year was kept in a different workbook with a different layout:

  2023  a calendar grid per wallet: one cell per day holding that day's
        total, no descriptions. Money moved between wallets was logged as
        "spending" in one sheet and "added" in another.
  2024  a sheet per month holding each wallet's daily total spent and
        received, with transfers, income and bills itemised elsewhere.
  2025  itemised lists: spendings, revenue, transfers, bills.

Every row produced says in its notes which workbook, sheet and cell it came
from. Every year is checked against the figures the workbook itself shows
(its balances and its totals), and every difference is reported rather than
smoothed over.

Usage:
  python tools/migrate_history.py --y2023 A.xlsx --y2024 B.xlsx --y2025 C.xlsx [--y2026 D.xlsm] --out DIR

Writes DIR/history.json (rows and checks) and DIR/report.md (the analysis).
"""

from __future__ import annotations

import argparse
import calendar
import json
import re
import sys
import warnings
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required:  pip install openpyxl")

warnings.filterwarnings("ignore")  # the workbooks use data validation extensions openpyxl skips

ROOT = Path(__file__).resolve().parent.parent

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
MONTH_INDEX = {m.lower(): i + 1 for i, m in enumerate(MONTHS)}

# ── Names ──────────────────────────────────────────────────────────────────

# Every name an account went by, mapped to the name the app uses today, so a
# merge adds no second copy of an account that already exists.
WALLET_NAMES = {
    "cash": "Cash",
    "wallet": "Cash",
    "gcash": "Gcash",
    "maya": "Maya",
    "paymaya": "Maya",
    "maya banks": "Maya Bank (Personal savings)",
    "maya bank": "Maya Bank (Personal savings)",
    "maya bank (personal savings)": "Maya Bank (Personal savings)",
    "paymaya savings": "Maya Bank (Personal savings)",
    "extra cash": "Extra Cash",
    "pnb": "PNB",
}


def wallet(name) -> str:
    key = str(name or "").strip().lower()
    if key in WALLET_NAMES:
        return WALLET_NAMES[key]
    # A savings goal keeps the name it was given, whatever the goal was.
    if key.startswith("maya goal (") and key.endswith(")"):
        return re.sub(r"\s+", " ", str(name).strip())
    raise ValueError(f"unknown account name {name!r}")


# Bills and subscriptions that changed name over the years, mapped to the name
# the app uses today, so one service is one item across every year.
BILL_NAMES = {
    "globe at home": "Globe at Home Wifi",
    "dito": "Dito Prepaid",
    "office": "Microsoft Office 365",
    "ms office": "Microsoft Office 365",
}


def bill(name) -> str:
    text = re.sub(r"\s+", " ", str(name or "").strip())
    return BILL_NAMES.get(text.lower(), text)


# Items the app already uses, chosen only when the description says so
# plainly. Order matters: the first match wins, so "lunch at old market"
# is Food before anything else.
ITEM_RULES: list[tuple[str, str]] = [
    (r"\btransaction fee\b", "Transaction Fee"),
    (r"\bunknown spending\b", "Unknown"),
    (r"\b(tuition|school|xerox|photocopy|print(ing)?|project|module|book|bluebook|quiz|uniform|correction tape|webinar)\b",
     "School"),
    (r"\b(gasoline|gas|petrol|diesel|fuel)\b", "Gas"),
    (r"\b(parking)\b", "Parking"),
    (r"\b(repair|vulcani[sz]e|change oil|maintenance|carwash)\b", "Repairs"),
    (r"\b(haircut|barber|shampoo|soap|toothpaste|lotion|deodorant|alcohol|gym)\b", "Self Care"),
    (r"\b(shop+e+|lazada|shein|tiktok shop|online)\b", "Online Buy"),
    (r"\b(remittance|palawan|padala|send to|sent to|send money|money send)\b", "Money Send"),
    (
        r"\b(foods?|lunch|dinner|breakfast|snacks?|pandesal|bread|rice|chicken|liempo|wings?|jollibee|mcdo|macdo|"
        r"kfc|chowking|goto|lugaw|pizza|burger|coffee?|donut|milk ?tea|drinks?|shake|juice|water|mt\.? ?dew|"
        r"meal|eat|ulam|merienda|7-?11|samg\w*|empanada|mangg?o|barbecue|bbq|banana ?cue|palamig|fish ?ball|"
        r"kikiam|lechon|chooks|st[au]rbucks|bibin?g?ka|hotpot|calamari|grocer(y|ies))\b",
        "Food",
    ),
    (r"\b(trip|travel|fare|fair to|jeep|tr[iy]c[iy]cle|bus|grab|angkas|toll)\b", "Travel"),
    (r"\b(beach|outing|ktv|minecraft)\b", "Fun"),
    (r"\b(treat|gift)\b", "Treat"),
    (r"\b(load)\b", "Load"),
]

# Spending whose description reads like money kept, not spent: moved to an
# account or invested. The workbooks counted it as spending, so it stays
# spending and its notes say so.
MOVED_OUT = re.compile(r"^\s*(transfer\w*|invest\w*)\b(?!.*\bfee\b)", re.I)

REVENUE_ITEMS = {
    "maya interest": "Bank interest",
    "random": "Random",
    "cash on hand": "Cash on hand",
    "allowance": "Allowance",
    "framelink": "Framelink",
}


def item_for(description: str) -> str:
    text = description.lower()
    for pattern, item in ITEM_RULES:
        if re.search(pattern, text):
            return item
    return ""


# ── Rows ───────────────────────────────────────────────────────────────────


def centavos(value) -> int:
    """Money as whole centavos. A figure with a third decimal is rounded and counted."""
    if value is None or value == "":
        return 0
    return int(round(float(value) * 100))


def rounding_of(value) -> float:
    return float(value) * 100 - centavos(value) if value not in (None, "") else 0.0


@dataclass
class Row:
    id: str
    date: str
    type: str
    fromWallet: str
    toWallet: str
    category: str
    item: str
    description: str
    amount: int
    fee: int
    notes: str
    status: str
    debtId: str | None = None
    debtEffect: str | None = None

    def out(self) -> dict:
        d = {
            "id": self.id,
            "recordNumber": 0,
            "date": self.date,
            "type": self.type,
            "fromWallet": self.fromWallet,
            "toWallet": self.toWallet,
            "category": self.category,
            "item": self.item[:80],
            "description": self.description[:500],
            "amount": self.amount,
            "fee": self.fee,
            "total": self.amount + self.fee,
            "notes": self.notes[:1000],
            "status": self.status,
        }
        if self.debtId:
            d["debtId"] = self.debtId
            d["debtEffect"] = self.debtEffect
        return d


@dataclass
class Year:
    year: int
    rows: list[Row] = field(default_factory=list)
    checks: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    rounding: float = 0.0
    debts: dict[str, dict] = field(default_factory=dict)
    flagged: list[tuple[str, str, int]] = field(default_factory=list)

    def debt(self, did: str, name: str, kind: str, counterparty: str, when: str, acct: str, who: str) -> str:
        """One debt per counterparty, opened on the first row that names it."""
        if did not in self.debts:
            self.debts[did] = {"id": did, "name": name, "kind": kind, "counterparty": counterparty,
                               "counterpartyType": who, "openedDate": when, "wallet": acct}
        return did

    def check(self, what: str, workbook: float, migrated: int) -> None:
        wb = centavos(workbook)
        self.checks.append(
            {"what": what, "workbook": wb, "migrated": migrated, "ok": wb == migrated, "difference": migrated - wb}
        )


def iso(y: int, m: int, d: int) -> str:
    return date(y, m, d).isoformat()


def month_of(name) -> int:
    return MONTH_INDEX[str(name).strip().lower()]


def num(v) -> float:
    if v in (None, "", "N/A"):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return 0.0


def balances(rows: list[Row]) -> dict[str, int]:
    """The app's balance rule (domain/balances.ts), so the checks agree with the app."""
    b: dict[str, int] = defaultdict(int)
    for r in rows:
        total = r.amount + r.fee
        if r.type == "Revenue" and r.fromWallet:
            b[r.fromWallet] += total
        if r.toWallet:
            b[r.toWallet] += r.amount
        if r.fromWallet and r.type != "Revenue":
            b[r.fromWallet] -= total
    return dict(b)


def open_book(path: str):
    # read_only + data_only: never opened for writing, formulas read as the values Excel last showed.
    return openpyxl.load_workbook(path, read_only=True, data_only=True, keep_vba=False)


def grid(ws, max_col: int = 60) -> dict[tuple[int, int], object]:
    cells = {}
    for r, row in enumerate(ws.iter_rows(min_row=1, max_col=max_col, values_only=True), start=1):
        for c, v in enumerate(row, start=1):
            if v is not None and v != "":
                cells[(r, c)] = v
    return cells


# ── Rows the workbooks cannot classify ─────────────────────────────────────
#
# In 2023 and 2024, money out of GCash, Maya and PNB was one figure a day, and
# the same columns held real purchases and money moved to another account
# (cash withdrawals, sending to GCash, a payout moving from PNB to Maya). The
# workbooks do not say which. Counting all of it as spending made a year's
# spending several times its income; counting none of it drops real
# purchases. So these rows keep every peso and every date, and are marked Not
# classified: they move the account's balance exactly as the workbook did,
# and count as neither spending nor income until one is reclassified.


def transfer(rid: str, when: str, frm: str, to: str, text: str, amount: int, fee: int, note: str) -> Row:
    """Between two accounts. One carrying a fee is filed as 2026 files it, Spending / Transaction Fee, so the fee counts once."""
    if fee:
        return Row(rid, when, "Transfer", frm, to, "Spending", "Transaction Fee", text, amount, fee, note, "Transferred")
    return Row(rid, when, "Transfer", frm, to, "", "", text, amount, 0, note, "Transferred")


def not_classified_out(rid: str, when: str, acct: str, amt: int, where: str, year: str) -> Row:
    # Short, because it is printed on every statement; the notes say the rest.
    return Row(rid, when, "Spending", acct, "", "", "Not classified",
               f"Out of {acct}, not recorded what for",
               amt, 0, f"{where}. Spent, or moved to another account: the {year} workbook does not say which. "
               "Not counted as spending. Change it to Spending or Transfer if you know which it was.", "Paid")


def not_classified_in(rid: str, when: str, acct: str, amt: int, where: str, year: str) -> Row:
    return Row(rid, when, "Transfer", "", acct, "", "Not classified",
               f"Into {acct}, not recorded where from",
               amt, 0, f"{where}. Not in the income records: earned, or moved from another account; the {year} workbook "
               "does not say which. Not counted as income. Change it to Revenue or Transfer if you know which it was.", "Received")


def assign_income(arrivals: dict, entries: list, window: tuple[int, int] = (-2, 7)) -> tuple[list, list]:
    """
    Match each income-sheet entry to money that arrived for it.

    `arrivals` is {(account, date): centavos not yet explained}, and is drawn
    down in place. An entry takes from the same day first, then the nearest
    day in the window (a payout lands a few days after it is earned), and may
    take from more than one arrival. Only money that arrived is ever labelled,
    so no balance can move by this.
    """
    named, unplaced = [], []
    for when, label, amount, ref in sorted(entries):
        need = amount
        day = date.fromisoformat(when)
        candidates = sorted(
            (abs((date.fromisoformat(d) - day).days), (date.fromisoformat(d) - day).days < 0, acct, d)
            for (acct, d), left in arrivals.items()
            if left > 0 and window[0] <= (date.fromisoformat(d) - day).days <= window[1]
        )
        # An arrival of exactly the amount wins over a nearer partial one.
        exact = [c for c in candidates if arrivals[(c[2], c[3])] == need]
        for _, _, acct, d in exact[:1] + [c for c in candidates if c not in exact[:1]]:
            if need == 0:
                break
            take = min(need, arrivals[(acct, d)])
            if take <= 0:
                continue
            arrivals[(acct, d)] -= take
            need -= take
            named.append((acct, d, label, take, ref, when))
        if need:
            unplaced.append((when, label, need, ref))
    return named, unplaced


def tidy_notes(notes: list[str]) -> list[str]:
    """One line per month for calendars that end early, instead of one per grid."""
    out, ends = [], defaultdict(set)
    for n in notes:
        m = re.match(r".*: the (\w+) calendar stops at day (\d+);", n)
        if m:
            ends[m.group(1)].add(int(m.group(2)))
        else:
            out.append(n)
    for month, days in sorted(ends.items(), key=lambda kv: MONTH_INDEX[kv[0].lower()]):
        last = calendar.monthrange(2023, MONTH_INDEX[month.lower()])[1]
        stop = max(days)
        out.insert(0, f"{month} 2023: the calendars end on day {stop}, so {stop + 1} to {last} {month} has no cells and nothing could be recorded for {'it' if stop + 1 == last else 'those days'}."
                   if stop < last else f"{month} 2023: some calendars stop early.")
    return out


# ── 2025: itemised ─────────────────────────────────────────────────────────

# Money borrowed or lent, found by what the description says, never by a name.
# "Paying what I borrowed", "pay my remaining borrowed ...": a repayment.
BORROWED = re.compile(r"\b(pay|paying|paid|repay\w*)\b.*\bborrow\w*", re.I)
# "Loan cash to X", "lent to X", "lend X": money lent, owed back by X.
LENT = re.compile(r"^\s*(?:loan|lend|lent)\b(?:\s+cash)?(?:\s+to)?\s+(.+?)\s*$", re.I)


def lender_in(text: str) -> str:
    """The account a repayment names ("... to PNB", "... card PNB"), else the lender is not recorded."""
    for key, name in WALLET_NAMES.items():
        if re.search(rf"\b{re.escape(key)}\b", text, re.I) and name not in ("Cash", "Extra Cash"):
            return name
    return ""


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def migrate_2025(path: str) -> Year:
    wb = open_book(path)
    y = Year(2025)
    src = "2025 SPENDINGS REPORT"

    def listing(sheet: str, cols: str):
        ws = wb[sheet]
        for r, row in enumerate(ws.iter_rows(min_row=7, values_only=True), start=7):
            vals = dict(zip(cols, row[1 : 1 + len(cols)]))
            if not vals.get("m") or str(vals["m"]).strip().lower() not in MONTH_INDEX:
                continue
            yield r, vals

    # Spendings: month, day, wallet, detail, amount.
    for r, v in listing("SPENDINGS", "mdwta"):
        when = iso(2025, month_of(v["m"]), int(v["d"]))
        detail = str(v["t"] or "").strip()
        note = f"{src}, SPENDINGS row {r}"
        amt = centavos(v["a"])
        y.rounding += rounding_of(v["a"])
        if BORROWED.search(detail):
            # Paying back money borrowed before these records began.
            lender = lender_in(detail)
            name = f"{lender} loan" if lender else "Borrowed money"
            did = y.debt(f"hist-loan-{slug(lender or 'unnamed')}", name, "payable", lender or "Not recorded", when,
                         wallet(v["w"]), "institution" if lender else "person")
            y.rows.append(Row(f"h2025-sp-{r}", when, "Debt", wallet(v["w"]), "", "", name, detail, amt, 0,
                              note + ". A repayment of money borrowed, not spending.", "Paid", did, "repay"))
            continue
        lent = LENT.match(detail)
        if lent:
            who = lent.group(1).strip() or "someone"
            name = f"Loan to {who}"
            did = y.debt(f"hist-lent-{slug(who)}", name, "receivable", who, when, wallet(v["w"]), "person")
            y.rows.append(Row(f"h2025-sp-{r}", when, "Debt", wallet(v["w"]), "", "", name, detail, amt, 0,
                              note + ". Money lent, not spent.", "Paid", did, "lend"))
            continue
        if MOVED_OUT.search(detail):
            note += (". The description reads like money moved or invested, not spent; the workbook counted it as "
                     "spending, so it is kept as spending. Change it to a Transfer if the money is still yours.")
            y.flagged.append((when, detail, amt))
        item = item_for(detail)
        if item == "Transaction Fee":
            # A fee on its own row goes in the fee column, as the app files one (integrity, fee-row-with-amount).
            y.rows.append(Row(f"h2025-sp-{r}", when, "Spending", wallet(v["w"]), "", "Spending", item, detail,
                              0, amt, note, "Paid"))
            continue
        y.rows.append(Row(f"h2025-sp-{r}", when, "Spending", wallet(v["w"]), "", "Spending", item, detail,
                          amt, 0, note, "Paid"))

    # Revenue: month, day, type, fund source, received in, amount.
    for r, v in listing("REVENUE", "mdtswa"):
        m, d = month_of(v["m"]), int(v["d"])
        when = iso(2025, m, d)
        source = str(v["s"] or "").strip()
        amt = centavos(v["a"])
        y.rounding += rounding_of(v["a"])
        note = f"{src}, REVENUE row {r}"
        if (m, d) == (1, 1):
            # The workbook's own carry-forward: 2024's closing balance booked as revenue on 1 January.
            y.rows.append(Row(f"h2025-rv-{r}", when, "Revenue", "", wallet(v["w"]), "Opening", "Transfer of balance",
                              "Transfer of balance 2024, as the 2025 workbook opened", amt, 0,
                              note + ". Where 2025 started, not income (docs/08, rule Y1).", "Done"))
            continue
        item = REVENUE_ITEMS.get(source.lower(), source or "Random")
        y.rows.append(Row(f"h2025-rv-{r}", when, "Revenue", "", wallet(v["w"]), "Revenue", item,
                          f"{v['t'] or ''}: {source}".strip(": "), amt, 0, note, "Received"))

    # Transfers: month, day, from type, from, to type, to, amount, fee.
    ws = wb["TRANSFERS"]
    for r, row in enumerate(ws.iter_rows(min_row=7, values_only=True), start=7):
        _, m, d, _kind, frm, _where, to, amt, fee = (list(row) + [None] * 9)[:9]
        if not m or str(m).strip().lower() not in MONTH_INDEX:
            continue
        when = iso(2025, month_of(m), int(d))
        a, f = centavos(amt), centavos(fee)
        y.rounding += rounding_of(amt) + rounding_of(fee)
        y.rows.append(transfer(f"h2025-tr-{r}", when, wallet(frm), wallet(to), f"{frm} to {to}", a, f,
                               f"{src}, TRANSFERS row {r}"))

    # Subscriptions and bills: month, day, type, name, paid from, amount.
    for r, v in listing("SUBSCRIPTION AND BILLS", "mdkcwa"):
        when = iso(2025, month_of(v["m"]), int(v["d"]))
        cat = "Subscriptions" if str(v["k"]).strip().lower().startswith("sub") else "Bills"
        amt = centavos(v["a"])
        y.rounding += rounding_of(v["a"])
        y.rows.append(Row(f"h2025-bl-{r}", when, "Spending", wallet(v["w"]), "", cat, bill(v["c"]),
                          str(v["c"]).strip(), amt, 0, f"{src}, SUBSCRIPTION AND BILLS row {r}", "Paid"))

    if y.flagged:
        y.notes.append(f"{len(y.flagged)} spending rows, {sum(a for _, _, a in y.flagged) / 100:,.2f} in all, read like money moved "
                       "or invested rather than spent (" + "; ".join(sorted({d for _, d, _ in y.flagged})) + "). The workbook "
                       "counted them as spending, so they are kept as spending; change any that is still yours to a Transfer.")

    # Checks against the workbook's own figures.
    summary = wb["ALL SUMMARY"]
    s = grid(summary, 8)
    spend_rows = [r for r in y.rows if r.type == "Spending" and r.category == "Spending"]
    debt_out = [r for r in y.rows if r.type == "Debt"]
    fees = sum(r.fee for r in y.rows if r.type == "Transfer")
    bills = [r for r in y.rows if r.category in ("Bills", "Subscriptions")]
    y.check("Annual spending, ALL SUMMARY D4 (spendings + transfer fees + bills)",
            num(s.get((4, 4))), sum(r.amount + r.fee for r in spend_rows + debt_out) + fees + sum(r.amount for r in bills))
    y.check("Money received, ALL SUMMARY D5", num(s.get((5, 4))),
            sum(r.amount for r in y.rows if r.type == "Revenue"))
    y.check("Subscriptions, ALL SUMMARY D6", num(s.get((6, 4))),
            sum(r.amount for r in bills if r.category == "Subscriptions"))
    y.check("Bills, ALL SUMMARY D7", num(s.get((7, 4))), sum(r.amount for r in bills if r.category == "Bills"))

    n = grid(wb["NUMERICALS SYSTEM"], 26)
    b = balances(y.rows)
    for row in (4, 5, 6):
        name = n.get((row, 22 - 1))  # U: wallet name
        if name:
            y.check(f"{name} current balance, NUMERICALS SYSTEM V{row}", num(n.get((row, 22))), b.get(wallet(name), 0))
    return y


# ── 2024: daily totals, with transfers, income and bills itemised ──────────

# The month sheets: day in the first column of each block, then spent, received.
BLOCKS_2024 = {"Cash": (2, 3, 4), "Gcash": (6, 7, 8), "Maya": (10, 11, 12), "PNB": (14, 15, 16)}
SHEETS_2024 = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER",
               "OCTOBER", "NOVEMBER", "DECEMBER"]


def migrate_2024(path: str) -> Year:
    wb = open_book(path)
    y = Year(2024)
    src = "2024 SPENDINGS REPORT"

    # Income, itemised but without the account it landed in.
    income = defaultdict(list)  # date -> [(platform, centavos, row)]
    for r, row in enumerate(wb["INCOME"].iter_rows(min_row=7, max_col=5, values_only=True), start=7):
        _, m, d, platform, amt = (list(row) + [None] * 5)[:5]
        if m and str(m).strip().lower() in MONTH_INDEX and amt not in (None, ""):
            income[iso(2024, month_of(m), int(d))].append((str(platform).strip(), centavos(amt), r))

    arrivals: dict = {}
    arrival_where: dict = {}
    for sheet in SHEETS_2024:
        m = month_of(sheet)
        cells = grid(wb[sheet], 17)
        for acct, (day_c, out_c, in_c) in BLOCKS_2024.items():
            for r in range(7, 38):
                day = cells.get((r, day_c))
                if not isinstance(day, (int, float)) or day > calendar.monthrange(2024, m)[1]:
                    continue
                when = iso(2024, m, int(day))
                spent, got = cells.get((r, out_c)), cells.get((r, in_c))
                where = f"{src}, {sheet} row {r}"
                if num(spent):
                    y.rounding += rounding_of(num(spent))
                    rid = f"h2024-{sheet[:3].lower()}-{acct.lower()}-{r}-out"
                    if acct == "Cash":
                        y.rows.append(Row(rid, when, "Spending", acct, "", "Spending", "Day total",
                                          f"Spent from {acct} on the day, no detail recorded", centavos(num(spent)), 0,
                                          where + ": the 2024 workbook kept a day's total, not each purchase.", "Paid"))
                    else:
                        y.rows.append(not_classified_out(rid, when, acct, centavos(num(spent)), where, "2024"))
                if num(got):
                    y.rounding += rounding_of(num(got))
                    arrivals[(acct, when)] = arrivals.get((acct, when), 0) + centavos(num(got))
                    arrival_where[(acct, when)] = where

    # Income, labelled on the money that arrived for it. Cash is left out of the search: money
    # arriving in cash counts as income anyway (allowance and the like), since withdrawals are
    # itemised in TRANSFERS.
    entries = [(when, "Fiverr" if p.upper() == "FIVERR" else p.title(), amt, f"INCOME row {ir}")
               for when, lst in income.items() for (p, amt, ir) in lst if amt]
    bank = {k: v for k, v in arrivals.items() if k[0] != "Cash"}
    named, unplaced = assign_income(bank, entries)
    arrivals.update(bank)
    for i, (acct, when, label, amt, ref, earned) in enumerate(named):
        y.rows.append(Row(f"h2024-inc-{i}", when, "Revenue", "", acct, "Revenue", label, f"{label} income, received in {acct}",
                          amt, 0, f"{src}, {ref} for {earned}, received in {acct} on {when} ({arrival_where[(acct, when)]})",
                          "Received"))
    for (acct, when), left in sorted(arrivals.items()):
        if not left:
            continue
        rid = f"h2024-rcv-{acct.lower()}-{when}"
        if acct == "Cash":
            y.rows.append(Row(rid, when, "Revenue", "", acct, "Revenue", "Random", f"Received in {acct}, source not recorded",
                              left, 0, arrival_where[(acct, when)] + ": the 2024 workbook kept a day's total received.", "Received"))
        else:
            y.rows.append(not_classified_in(rid, when, acct, left, arrival_where[(acct, when)], "2024"))
    if unplaced:
        y.notes.append(f"{sum(a for _, _, a, _ in unplaced) / 100:,.2f} of the income sheet ({len(unplaced)} entries) found no money arriving "
                       "in GCash, Maya or PNB within two days before or a week after; the money is counted where it arrived, not labelled as income.")

    # Transfers: month, day, to, from, amount, fee.
    for r, row in enumerate(wb["TRANSFERS"].iter_rows(min_row=7, max_col=7, values_only=True), start=7):
        _, m, d, to, frm, amt, fee = (list(row) + [None] * 7)[:7]
        if not m or str(m).strip().lower() not in MONTH_INDEX or amt in (None, ""):
            continue
        when = iso(2024, month_of(m), int(d))
        y.rounding += rounding_of(amt) + rounding_of(fee)
        y.rows.append(transfer(f"h2024-tr-{r}", when, wallet(frm), wallet(to), f"{frm} to {to}", centavos(amt),
                               centavos(fee), f"{src}, TRANSFERS row {r}"))

    # Subscriptions and bills: month, day, type, name, paid from, amount.
    for r, row in enumerate(wb["SUBSCRIPTION AND BILLS"].iter_rows(min_row=7, max_col=7, values_only=True), start=7):
        _, m, d, kind, name, frm, amt = (list(row) + [None] * 7)[:7]
        if not m or str(m).strip().lower() not in MONTH_INDEX or amt in (None, ""):
            continue
        when = iso(2024, month_of(m), int(d))
        cat = "Subscriptions" if str(kind).strip().lower().startswith("sub") else "Bills"
        y.rounding += rounding_of(amt)
        y.rows.append(Row(f"h2024-bl-{r}", when, "Spending", wallet(frm), "", cat, bill(name), str(name).strip(),
                          centavos(amt), 0, f"{src}, SUBSCRIPTION AND BILLS row {r}", "Paid"))

    # Checks: each account's balance change month by month, against BALANCE LIVE CALCULATOR.
    live = grid(wb["SETTINGS AND ADJUSTMENTS"], 9)
    columns = {"Cash": 3, "Extra Cash": 4, "Gcash": 5, "Maya": 6, "Maya Bank (Personal savings)": 7, "PNB": 8}
    for i, _ in enumerate(MONTHS):
        upto = [r for r in y.rows if r.date[:7] == f"2024-{i + 1:02d}"]
        b = balances(upto)
        for acct, col in columns.items():
            y.check(f"{acct}, {MONTHS[i]} change, SETTINGS AND ADJUSTMENTS row {20 + i}", num(live.get((20 + i, col))),
                    b.get(acct, 0))
    closing = balances(y.rows)
    for acct, col in columns.items():
        y.check(f"{acct} closing balance, SETTINGS AND ADJUSTMENTS row 32", num(live.get((32, col))), closing.get(acct, 0))
    return y


# ── 2023: calendar grids ───────────────────────────────────────────────────

# (sheet, month-name column, first weekday column, total column) for each grid.
GRIDS_2023 = {
    "cash_out": ("WALLET SPENDING", 1, 3, 10),
    "outsource_in": ("WALLET SPENDING", 16, 18, 25),
    "extra_out": ("WALLET SPENDING", 30, 32, 39),
    "gcash_out": ("GCASH SPENDING", 2, 4, 11),
    "gcash_in": ("GCASH SPENDING", 17, 19, 26),
    "maya_out": ("PAYMAYA SAVINGS", 2, 4, 11),
    "maya_in": ("PAYMAYA SAVINGS", 17, 19, 26),
    "save_in": ("PAYMAYA SAVINGS", 32, 34, 41),
    "save_out": ("PAYMAYA SAVINGS", 46, 48, 55),
    "fiverr": ("INCOME SHEET", 2, 4, 11),
    "other_income": ("INCOME SHEET", 15, 17, 24),
    "pnb_in": ("PNB BANK", 2, 4, 11),
    "pnb_out": ("PNB BANK", 15, 17, 24),
}


def read_grid(cells: dict, year: int, name_col: int, first: int, total_col: int, label: str, y: Year):
    """Every day's figure in one calendar grid, as {date: centavos}, with its month totals checked."""
    rows = sorted({r for (r, c) in cells if c == name_col and str(cells[(r, c)]).strip().lower() in MONTH_INDEX})
    days: dict[str, int] = {}
    for start in rows:
        m = month_of(cells[(start, name_col)])
        offset = (date(year, m, 1).weekday() + 1) % 7  # Sunday first
        last = calendar.monthrange(year, m)[1]
        # The calendar rows: this one and those under it, until one with nothing in the grid.
        block = []
        r = start
        while True:
            if r != start and (r, name_col) in cells and str(cells[(r, name_col)]).strip().lower() in MONTH_INDEX:
                break
            if not any((r, first + k) in cells for k in range(7)):
                break
            block.append(r)
            r += 1
        month_sum = 0
        covered = 0
        for w, rr in enumerate(block):
            for k in range(7):
                v = cells.get((rr, first + k))
                day = w * 7 + k - offset + 1
                if v is None:
                    continue
                if 1 <= day <= last:
                    covered = max(covered, day)
                if num(v):
                    c = centavos(num(v))
                    y.rounding += rounding_of(num(v))
                    # A figure typed in the cell before the 1st or after the last day is dated to the day
                    # that cell really is, and still counts toward the month total the workbook gave it.
                    when = (date(year, m, 1) + timedelta(days=day - 1)).isoformat()
                    if not 1 <= day <= last:
                        y.notes.append(f"{label}: {v} is in {MONTHS[m - 1]}'s calendar on the cell for {when}, "
                                       f"so it is dated {when}; the workbook counted it in {MONTHS[m - 1]}.")
                    days[when] = days.get(when, 0) + c
                    month_sum += c
        if covered < last:
            y.notes.append(f"{label}: the {MONTHS[m - 1]} calendar stops at day {covered}; days {covered + 1} to {last} have no cells.")
        # The month's total, the number in the total column within the block (or the row after it).
        total = next((cells[(rr, total_col)] for rr in block + [block[-1] + 1] if isinstance(cells.get((rr, total_col)), (int, float))), None) if block else None
        if total is not None:
            y.check(f"{label}, {MONTHS[m - 1]} total", num(total), month_sum)
    return days


def migrate_2023(path: str) -> Year:
    wb = open_book(path)
    y = Year(2023)
    src = "2023 Money spending"
    sheets = {name: grid(wb[name], 60) for name in {g[0] for g in GRIDS_2023.values()}}
    g = {key: read_grid(sheets[sh], 2023, nc, fc, tc, f"{sh} {key.replace('_', ' ')}", y)
         for key, (sh, nc, fc, tc) in GRIDS_2023.items()}

    # Cash withdrawn and extra cash put aside: one figure a month, under the month's name.
    monthly = {"withdraw": {}, "extra_in": {}}
    for (sheet, name_col, key) in (("WALLET SPENDING", 1, "withdraw"), ("WALLET SPENDING", 30, "extra_in")):
        cells = sheets[sheet]
        for (r, c), v in cells.items():
            if c == name_col and str(v).strip().lower() in MONTH_INDEX:
                m = month_of(v)
                for rr in (r + 2, r + 3):
                    x = cells.get((rr, name_col))
                    if isinstance(x, (int, float)):
                        monthly[key][m] = centavos(x)
                        break

    g_in_original = dict(g["gcash_in"])
    outs = {"Cash": g["cash_out"], "Extra Cash": g["extra_out"], "Gcash": g["gcash_out"], "Maya": g["maya_out"], "PNB": g["pnb_out"]}
    ins = {"Gcash": g["gcash_in"], "Maya": g["maya_in"], "PNB": g["pnb_in"], "Cash": g["outsource_in"]}

    # Pair money out of one account with the same money into another on the same day.
    # A pair only relabels two rows as one transfer, so no balance can move by it.
    FEES = (0, 1000, 1500, 1800, 2000, 2500)
    pairs = []
    for when in sorted({d for m in outs.values() for d in m}):
        for a, outm in outs.items():
            if a == "Cash":
                continue  # cash spent by hand is spending; cash moving on is not in these sheets
            x = outm.get(when, 0)
            if not x:
                continue
            for b, inm in ins.items():
                if b == a or b == "Cash":
                    continue
                got = inm.get(when, 0)
                fee = x - got
                if got and fee in FEES:
                    pairs.append((when, a, b, got, fee))
                    outm[when] = 0
                    inm[when] = 0
                    break

    for when, a, b, amt, fee in pairs:
        y.rows.append(transfer(f"h2023-tr-{when}-{a}-{b}".lower(), when, a, b, f"{a} to {b}", amt, fee,
                               f"{src}: {a}'s money out and {b}'s money in on the same day, matched as one transfer."))

    # Savings in and out of the PayMaya sheet are transfers by the sheet's own formula.
    for when, amt in g["save_in"].items():
        y.rows.append(Row(f"h2023-sv-in-{when}", when, "Transfer", "Maya", "Maya Bank (Personal savings)", "Transfer", "",
                          "Maya to savings", amt, 0, f"{src}, PAYMAYA SAVINGS: added to savings", "Transferred"))
    for when, amt in g["save_out"].items():
        y.rows.append(Row(f"h2023-sv-out-{when}", when, "Transfer", "Maya Bank (Personal savings)", "Maya", "Transfer", "",
                          "Savings to Maya", amt, 0, f"{src}, PAYMAYA SAVINGS: decreased from savings", "Transferred"))

    # Income, from the income sheet, labelled on the money that arrived for it.
    entries = [(when, "Fiverr", amt, "INCOME SHEET, Fiverr") for when, amt in g["fiverr"].items()]
    entries += [(when, "Other income", amt, "INCOME SHEET, other sources") for when, amt in g["other_income"].items()]
    arrivals = {(acct, when): amt for acct, inm in ins.items() if acct != "Cash" for when, amt in inm.items() if amt}
    named, unplaced = assign_income(arrivals, entries)
    for i, (acct, when, label, amt, ref, earned) in enumerate(named):
        y.rows.append(Row(f"h2023-inc-{i}", when, "Revenue", "", acct, "Revenue", label, f"{label}, received in {acct}", amt, 0,
                          f"{src}, {ref} for {earned}, received in {acct} on {when}", "Received"))
    for (acct, when), left in sorted(arrivals.items()):
        if left:
            y.rows.append(not_classified_in(f"h2023-in-{acct}-{when}".lower(), when, acct, left, src, "2023"))
    for when, amt in sorted(ins["Cash"].items()):
        if amt:
            # "Out source money": money from outside, the owner's own term for it.
            y.rows.append(Row(f"h2023-os-{when}", when, "Revenue", "", "Cash", "Revenue", "Random",
                              "Out source money", amt, 0, f"{src}, WALLET SPENDING: out source money", "Received"))
    if unplaced:
        y.notes.append(f"{sum(a for _, _, a, _ in unplaced) / 100:,.2f} of the income sheet ({len(unplaced)} entries) found no money arriving "
                       "within two days before or a week after; the money is counted where it arrived, not labelled as income.")

    for acct, outm in outs.items():
        for when, amt in sorted(outm.items()):
            if not amt:
                continue
            if acct in ("Cash", "Extra Cash"):
                y.rows.append(Row(f"h2023-out-{acct}-{when}".lower().replace(" ", "-"), when, "Spending", acct, "", "Spending", "Day total",
                                  f"Spent from {acct} on the day, no detail recorded", amt, 0,
                                  f"{src}: the 2023 workbook kept a day's total, not each purchase.", "Paid"))
            else:
                y.rows.append(not_classified_out(f"h2023-out-{acct}-{when}".lower(), when, acct, amt, src, "2023"))

    for m, amt in monthly["withdraw"].items():
        if amt:
            y.rows.append(Row(f"h2023-wd-{m:02d}", iso(2023, m, 1), "Transfer", "", "Cash", "Transfer", "",
                              f"Cash withdrawn during {MONTHS[m - 1]} 2023, from an account not recorded", amt, 0,
                              f"{src}, WALLET SPENDING: the month's cash withdrawn, a month total dated the 1st.", "Withdrawn"))
    for m, amt in monthly["extra_in"].items():
        if amt:
            y.rows.append(Row(f"h2023-ex-{m:02d}", iso(2023, m, 1), "Transfer", "", "Extra Cash", "Transfer", "",
                              f"Put into Extra Cash during {MONTHS[m - 1]} 2023", amt, 0,
                              f"{src}, WALLET SPENDING: the month's extra cash, a month total dated the 1st.", "Transferred"))

    # Online payments: paid from GCash by the workbook's own formula (GCASH SPENDING E70 adds the table),
    # one figure a month per service. Dated the day that month's money for it arrived in GCash, else the 1st.
    services = {31: "Adobe", 32: "Storyblocks", 33: "Netflix", 34: "Google Drive", 35: "Spotify", 36: "Other online payments"}
    gc = sheets["GCASH SPENDING"]
    arrived = {when: amt for when, amt in g_in_original.items()}
    for r in range(7, 19):
        m = r - 6
        for col, service in services.items():
            amt = centavos(num(gc.get((r, col))))
            if not amt:
                continue
            day = next((d for d, a in sorted(arrived.items()) if d[:7] == f"2023-{m:02d}" and a == amt), iso(2023, m, 1))
            y.rows.append(Row(f"h2023-sub-{m:02d}-{col}", day, "Spending", "Gcash", "", "Subscriptions", service, service, amt, 0,
                              f"{src}, GCASH SPENDING online payments table, {MONTHS[m - 1]}. Its legend names PayMaya for some "
                              "services; the workbook's own formula charges GCash.", "Paid"))
    y.check("Online payments, GCASH SPENDING AE22", num(gc.get((22, 31))),
            sum(r.amount for r in y.rows if r.id.startswith("h2023-sub-")))

    y.notes.append(f"{len(pairs)} same-day pairs of money out and money in were matched as transfers between accounts.")

    # Closing balances, against the workbook's own.
    s = grid(wb["ALL SPENDING"], 30)
    b = balances(y.rows)
    for label, cell, acct in (("Cash wallet, ALL SPENDING B5", (5, 2), "Cash"), ("Gcash, ALL SPENDING I5", (5, 9), "Gcash"),
                              ("Maya, ALL SPENDING P5", (5, 16), "Maya"), ("Maya savings, ALL SPENDING P8", (8, 16), "Maya Bank (Personal savings)"),
                              ("Extra Cash, ALL SPENDING B17", (17, 2), "Extra Cash")):
        y.check(label + " (closing balance)", num(s.get(cell)), b.get(acct, 0))
    y.notes = tidy_notes(y.notes)
    pnb = grid(wb["PNB BANK"], 30)
    y.check("PNB, deposits less cash out (PNB BANK L3 less Y3... totals row 70)", num(pnb.get((70, 5))) - num(pnb.get((70, 18))), b.get("PNB", 0))
    return y


# ── Output ─────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--y2023")
    ap.add_argument("--y2024")
    ap.add_argument("--y2025")
    ap.add_argument("--y2026", help="the 2026 system workbook or its backup: read only to check the merge leaves 2026 alone")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    out = Path(args.out).resolve()
    if out == ROOT or ROOT in out.parents:
        sys.exit("--out must be outside the repository: the history is private and is never committed.")
    out.mkdir(parents=True, exist_ok=True)

    years: list[Year] = []
    if args.y2023:
        years.append(migrate_2023(args.y2023))
    if args.y2025:
        years.append(migrate_2025(args.y2025))
    if args.y2024:
        years.append(migrate_2024(args.y2024))

    payload = {
        "years": {
            y.year: {
                "rows": [r.out() for r in y.rows],
                "checks": y.checks,
                "notes": y.notes,
                "roundingCentavos": round(y.rounding, 4),
                "debts": list(y.debts.values()),
            }
            for y in years
        }
    }
    if args.y2026:
        # Only for checking: 2026 is already in the app and is not migrated. Read exactly as the app's
        # own fixture extractor reads the DATABASE sheet, never the CATEGORIES sheet.
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from extract_fixture import read_ledger
        wb26 = openpyxl.load_workbook(args.y2026, read_only=False, data_only=True, keep_vba=False)
        db = wb26["DATABASE"]
        # The system workbook starts at B7; its backup copy at A2. Same columns either way.
        if str(db.cell(1, 1).value or "").strip().upper() == "RECORD NUMBER":
            ledger = read_ledger(db, 2, 1, 2)
        else:
            ledger = read_ledger(db, 7, 2, 3)
        for t in ledger:
            t["id"] = f"x{t['recordNumber']}"
        payload["current2026"] = ledger

    (out / "history.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    for y in years:
        bad = [c for c in y.checks if not c["ok"]]
        print(f"{y.year}: {len(y.rows)} rows, {len(y.checks) - len(bad)}/{len(y.checks)} checks agree")
        for c in bad:
            print(f"   DIFFERS  {c['what']}: workbook {c['workbook'] / 100:,.2f}, migrated {c['migrated'] / 100:,.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
