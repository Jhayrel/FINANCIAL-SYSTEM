/**
 * Reference, account and phone numbers, which are never money.
 *
 * Live, 7 October 2026: the owner pasted a wallet's payment confirmation, a
 * PHP 199.00 prepaid load with a masked account number and a twelve-digit
 * reference number after it, and got three cards: the payment, a spending of
 * hundreds of thousands read from the masked account number, and one of
 * hundreds of billions read from the reference number. The receipt was cut at
 * its full stops and every piece with digits in it was read as a purchase.
 * (The numbers in this file and its tests are invented.)
 *
 * Removed before any figure is read. A reference number is named as one, a
 * masked number has its stars, and ten digits in a row is a phone or an
 * account: nobody types a hundred million pesos without a comma.
 */

/** "Ref. No. 700012345678", "Reference #A1B2C3", "Txn ID: 0012", "Trace no 4471". */
const NAMED_ID =
  /\b(?:ref(?:erence)?|trace|txn|transaction|invoice|receipt|order|confirmation|tracking|batch|terminal|merchant)\.?\s*(?:no\.?|number|num\.?|#|id|code)\s*[:#.]?\s*[a-z0-9]*\d[a-z0-9-]*(?:\s+\d[\d-]*)*|\bref(?:erence)?\.?\s*[:#]\s*[a-z0-9]*\d[a-z0-9-]*(?:\s+\d[\d-]*)*/gi;

/** "Maya account: 512345******0001", "card ending 1234", "mobile no. 0917 123 4567". */
const ACCOUNT_ID =
  /\b(?:account|acct|card|mobile|phone|cell|contact|wallet|gcash|maya)\.?\s*(?:no\.?|number|num\.?|#|ending(?:\s+in)?)?\s*[:#]\s*[\dx*•][\dx*•\s-]{3,}|\b(?:account|acct|card|mobile|phone)\.?\s*(?:no\.?|number|num\.?|#|ending(?:\s+in)?)\s*[:#]?\s*[\dx*•][\dx*•\s-]{3,}/gi;

/** A number with its middle masked: "512345******0001", "****1234", "0917XXX4567". */
const MASKED = /[\dx]*[*•]{2,}[\dx*•]*|\b\d+x{2,}[\dx]*\b/gi;

/** Ten or more digits together: a phone, an account or a reference, never an amount. */
const LONG_RUN = /(?<![\d.,])\d{10,}(?![\d.,]*\d)/g;

/**
 * "Balance: PHP 640.25", "Available balance is 1,200.00", "New balance PHP
 * 85.00": what the account held after, never a movement. A pasted "You
 * withdrew ... Balance: ..." made a second card out of the balance (owner's
 * chat, 12 November 2026). Only in a pasted confirmation, which is where
 * this is used; the figures here are invented.
 */
const BALANCE_AFTER = /\b(?:(?:new|available|remaining|current|running|ending|your)\s+)*bal(?:ance)?\.?\s*(?:after|now|left)?\s*(?:is|was|of|:|=)?\s*(?:php|₱|p)?\s*\d[\d,]*(?:\.\d{1,2})?/gi;

/** The text with every identifier blanked out, so no figure is read from one. */
export function withoutIdentifiers(text: string): string {
  return text.replace(NAMED_ID, " ").replace(ACCOUNT_ID, " ").replace(MASKED, " ").replace(LONG_RUN, " ").replace(BALANCE_AFTER, " ");
}

/** Whether the text carries one: a pasted confirmation, rather than something typed. */
export function carriesIdentifier(text: string): boolean {
  return text.replace(NAMED_ID, " ").replace(ACCOUNT_ID, " ").replace(MASKED, " ").replace(LONG_RUN, " ") !== text;
}

