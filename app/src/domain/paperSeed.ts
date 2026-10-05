/**
 * The starter examples the paper reader is trained on (`paperKind.ts`).
 *
 * Invented, in the layouts these papers come in, and none of them the
 * owner's: their own examples are taught from the chat and kept in their
 * own database, never here (`paperMemory.ts`). Shaped like what the phone's
 * reader makes of a photo, a stray letter here and there, because that is
 * what the reader is shown.
 *
 * Adding an example here teaches every reading after it; nothing else needs
 * to change. Several per kind, from different shops, banks and schools, so
 * it learns what the kind says about itself rather than one shop's layout.
 */

import type { PaperExample } from "./paperKind";

const receipt = (text: string): PaperExample => ({ text, kind: "receipt" });
const slip = (text: string): PaperExample => ({ text, kind: "slip" });
const wallet = (text: string): PaperExample => ({ text, kind: "wallet" });
const atm = (text: string): PaperExample => ({ text, kind: "atm" });
const history = (text: string): PaperExample => ({ text, kind: "history" });
const bill = (text: string): PaperExample => ({ text, kind: "bill" });
const assessment = (text: string): PaperExample => ({ text, kind: "assessment" });
const checkout = (text: string): PaperExample => ({ text, kind: "checkout" });
const quote = (text: string): PaperExample => ({ text, kind: "quote" });

export const PAPER_SEED: readonly PaperExample[] = [
  // ── Receipts: paid, at a counter, online or at an office ────────────────
  receipt(`SUNRISE MART INC
VAT REG TIN 000-111-222-000
SALES INVOICE
RICE 5KG 1 X 310.00 310.00
EGGS DOZEN 98.00
SUBTOTAL 408.00
TOTAL 408.00
CASH 500.00
CHANGE 92.00
VATABLE SALES 364.29
VAT AMOUNT 43.71
THANK YOU COME AGAIN
CASHIER: ANA`),
  receipt(`CORNER CAFE
Official Receipt No. 004512
Dine In Table 4
1 Iced Coffee 120.00
1 Ensaymada 65.00
Total Due 185.00
GCash 185.00
Change 0.00
This serves as your sales invoice`),
  receipt(`BOTICA NG BAYAN
Sales Invoice
Paracetamol 500mg 10s 45.00
Senior Citizen Discount -9.00
Amount Due 36.00
Cash Tendered 50.00
Change Due 14.00
VAT Exempt Sales 36.00
Thank you for your purchase`),
  receipt(`QUICKFUEL STATION
OFFICIAL RECEIPT
PUMP 3 UNLEADED
LITERS 4.200 @ 59.50
AMOUNT 249.90
TOTAL 249.90
CASH 300.00 CHANGE 50.10
VATable 223.13 VAT 26.77`),
  receipt(`HILLTOP COLLEGE, INC.
OFFICIAL RECEIPT OR No. 220145
Received from STUDENT NAME
In payment of TUITION FEE PRELIM 1,500.00
TOTAL 1,500.00
The sum of One Thousand Five Hundred Pesos Only
Form of Payment Cash
Cashier
OFFICIAL WHEN VALIDATED`),
  receipt(`CITY TREASURER'S OFFICE
OFFICIAL RECEIPT
Received from JUAN DELA CRUZ
Nature of collection Community Tax 55.00 Interest 0.00
TOTAL AMOUNT PAID 55.00
Amount in words Fifty Five Pesos Only
Mode of payment Cash
Collecting officer`),
  receipt(`Order Confirmed
Thank you for your order!
Order ID 2209FFQ12
Paid with GCash
Merchandise Subtotal 450.00
Shipping Fee 38.00
Shipping Discount -38.00
Order Total 450.00
Payment successful`),
  receipt(`FOODHUB DELIVERY RECEIPT
Your order has been delivered
2x Chicken Meal 318.00
Delivery fee 49.00
Voucher -50.00
Total paid 317.00
Paid by Maya`),
  receipt(`NOODLE HOUSE
Sales Invoice SI# 01-0004421
Trans# 0031 Cashier: 12-MARK
09/14/2026 12:41
DINE-IN
2 BEEF NOODLES @180 360.00V
1 ICED TEA 45.00V
3 Item(s) PHP 405.00
TOTAL DUE PHP 405.00
VISA CARD 405.00 ApprCode 123456
VATable Sales 361.61 VAT Amount 43.39`),
  receipt(`ACKNOWLEDGEMENT RECEIPT
Received from Maria Santos the amount of Two Hundred Pesos
PHP 200.00 as payment for printing services
Received by`),
  receipt(`CINEPLEX 3
Invoice# C10004455 07/20/2026 04:10 PM
MOVIE TICKET SEAT F12 REGULAR 300.00
VS 0.00 VE 300.00 12% VAT 0.00 Total 300.00
This serves as your invoice`),
  receipt(`CONVENIENCE STORE 24/7
INVOICE No 300112 STORE No 0201 STAFF:LEA
Mineral Water 1L 25.00V
Bread 40.00V
Total Amount Due (2) 65.00
CASH 100.00 CHANGE 35.00
Vatable 58.04 VAT_Amt 6.96`),

  receipt(`Order placed
Your order is confirmed
Order No 260930ABCD
Paid via Maya
Items total 899.00 Shipping fee 0.00
Amount paid 899.00
Track your order`),
  receipt(`Payment received
Thank you! We have received your payment
Receipt No 00451
Paid on Sep 30, 2026
Amount paid PHP 1,500.00
Payment method Credit card`),
  receipt(`To Receive
Order Details
Order Total 349.00
Payment Method GCash
Order Time 09-28-2026 14:02 Payment Time 09-28-2026 14:03
Ship Time 09-29-2026`),
  receipt(`LAUNDRY SHOP
Claim stub and receipt
Wash dry fold 8 kg 240.00
Detergent 20.00
Total 260.00
Paid cash
Thank you`),
  receipt(`HARDWARE DEPOT
CHARGE INVOICE PAID
Nails 1 kg 95.00
Plywood 1/4 2 pcs 760.00
Total Sales 855.00
Cash 1,000.00 Change 145.00
VATable Sales 763.39 VAT 91.61`),
  receipt(`Order Received
Order Details
Order ID 2609ABC123
Merchandise Subtotal 520.00 Shipping 0.00
Order Total 520.00
Paid by ShopeePay
Payment Time 09-21-2026 08:10
Completed`),
  receipt(`Your receipt
Ride completed
Trip fare 186.00
Booking fee 10.00
Total charged 196.00
Paid with GCash
Thanks for riding`),

  // ── Card terminal slips ─────────────────────────────────────────────────
  slip(`BDO
MERCHANT COPY
MERCHANT ID 000123456789
TERMINAL ID 77665544
VISA SALE
CARD NO ************4421 (C)
BATCH NO 000044 TRACE NO 000981
APPR CODE 553311
DATE/TIME 2026/08/30 18:22:10
AMOUNT PHP 1,250.00
APPROVED
I AGREE TO PAY THE ABOVE TOTAL AMOUNT ACCORDING TO THE CARD ISSUER AGREEMENT
CUSTOMER COPY`),
  slip(`maya BUSINESS
SAMPLE GRILL M1201
MERCHANT ID EFS000111222
CARD TYPE MASTERCARD
PAYMENT CHANNEL Credit Card
TRANS. TYPE SALE
REF. NO. 111222333444 APPR. CODE 908070
----- APPROVED -----
AMOUNT 780.00
APP. LABEL Mastercard
I PROMISE TO PAY THE TOTAL AMOUNT ABOVE
RETAIN THIS COPY FOR YOUR RECORDS
CUSTOMER COPY`),
  slip(`BPI
DEBIT SALE
CARD **** **** **** 1029 CHIP
TID 22113344 MID 000998877
INVOICE 000231
AUTH CODE A1B2C3
TOTAL PHP 560.00
NO SIGNATURE REQUIRED
CARDHOLDER COPY`),
  slip(`METROBANK CARD SALE SLIP
CONTACTLESS VISA
REFUND
RRN 456789123456 AUTH 778899
AMOUNT 320.00
APPROVED THANK YOU
MERCHANT COPY`),

  // ── E-wallet and bank confirmations ─────────────────────────────────────
  wallet(`Sent via GCash
Express Send
JU***N DE*A C.
+63 917 *** 1234
Amount 500.00
Total Amount Sent ₱500.00
Ref No. 1234 567 890123
Sep 12, 2026 9:15 AM`),
  wallet(`Bank Transfer Complete
Sent via GCash
Bank Demo Savings Bank
Account No. 000000001111
Account Name Pedro Reyes
Transfer Method Instapay
Transfer Amount 2,000.00
+Fee 10.00
Total ₱2,010.00
Ref No. 7000000000001`),
  wallet(`maya
Payment successful
You paid
FAMILY PHARMACY
Amount ₱245.00
Fee Free
Reference ID 9F3A-22B1
Paid with Maya Wallet`),
  wallet(`Received money from
Ana Lim
₱1,000.00
Transaction successful
Reference No. 55667788
via InstaPay`),
  wallet(`Bills Payment
Payment Successful
Biller ELECTRIC COOPERATIVE
Account Number 1234567
Amount 1,850.00
Convenience Fee 0.00
Total ₱1,850.00
Ref No. 99887766 GCash`),
  wallet(`Buy Load
Load Successful
Regular Load 100
Mobile Number 0917 *** 5678
Amount ₱100.00
Ref No 00112233
Paid via GCash`),
  wallet(`QR Ph Payment
Successfully paid
Merchant SARI SARI STORE
Amount PHP 76.00
Transaction ID 7788990011
Maya`),

  wallet(`Cash In Successful
Cash in via partner outlet
Amount 1,000.00
Fee 0.00
New balance hidden
Ref No 33445566
GCash`),
  wallet(`Transfer successful
InstaPay transfer to Demo Bank
Recipient account ending 1234
Amount PHP 3,000.00 Fee PHP 15.00
Reference number 20260930123456
Maya`),

  // ── ATM slips ────────────────────────────────────────────────────────────
  atm(`ATM TRANSACTION RECORD
LANDBANK
TERMINAL 00045 LOCATION CITY HALL
WITHDRAWAL FROM SAVINGS
AMOUNT 2,000.00
TRANSACTION FEE 18.00
AVAILABLE BALANCE 5,432.10
SEQ NO 1123`),
  atm(`CASH WITHDRAWAL
ATM ID S1A00212
CARD NO ****5521
DISPENSED 1,000.00
FEE 18.00
AVAIL BAL 3,210.55
PLEASE TAKE YOUR CARD`),
  atm(`BANCNET ATM
BALANCE INQUIRY
ACCOUNT SAVINGS
LEDGER BALANCE 8,500.00
AVAILABLE BALANCE 8,500.00
FEE 2.00
THANK YOU FOR BANKING WITH US`),

  atm(`ATM WITHDRAWAL
BANK OF THE ISLANDS
ATM NO 0012 BRANCH MAIN
DATE 09/29/26 TIME 10:21
WITHDRAWAL AMOUNT 3,000.00
SERVICE CHARGE 0.00
REMAINING BALANCE 12,040.55
PLEASE RETAIN THIS RECORD`),
  atm(`EXPRESSNET ATM RECEIPT
TRANS WITHDRAW SAVINGS
CARD XXXXXXXXXXXX1188
AMT 500.00 FEE 18.00
BAL 2,145.00
THANK YOU`),

  // ── An account's history ────────────────────────────────────────────────
  history(`Transactions
Today
Sent to JU***N -150.00
Cash In from Bank +2,000.00
Yesterday
Paid to SARI SARI STORE -45.00
Buy Load -100.00
Sep 10
Received from AN* L*M +500.00`),
  history(`Account history
Wallet
All Received Sent
Withdrawal from ATM -1,018.00 Sep 28, 2026
Interest Earned +0.85 Sep 28, 2026
Withholding Tax -0.17 Sep 28, 2026
Purchase at ONLINE STORE -299.00 Sep 27, 2026`),
  history(`Statement of transactions
DATE DESCRIPTION DEBIT CREDIT BALANCE
09/01 BEGINNING BALANCE 4,200.00
09/03 POS PURCHASE 350.00 3,850.00
09/05 FUND TRANSFER 1,000.00 4,850.00
09/09 ATM WITHDRAWAL 500.00 4,350.00`),
  history(`Activity
Sep 30 QR payment MILK TEA SHOP -110.00
Sep 29 Cash in via 7-Eleven +1,000.00
Sep 29 Send money to MA**A -200.00
Sep 28 Bills payment WATER DISTRICT -410.00`),

  history(`Recent transactions
See all
Express Send -300.00 Oct 01
Cash In +1,500.00 Oct 01
Pay Bills -999.00 Sep 30
Buy Load -50.00 Sep 29
Received Money +200.00 Sep 28`),
  history(`Savings account
Transaction history
Interest credit +1.22 Today
Tax withheld -0.24 Today
Transfer in +2,000.00 Yesterday
Transfer out -500.00 Sep 27`),

  // ── Bills: what is owed, not paid ──────────────────────────────────────
  bill(`METRO POWER COMPANY
BILLING STATEMENT
Account No 0123456789
Service Period 08/10/2026 - 09/09/2026
Previous Reading 1200 Present Reading 1410 kWh Used 210
Generation Charge 1,470.00
Distribution Charge 420.50
Total Current Amount 2,415.70
TOTAL AMOUNT DUE 2,415.70
Please pay on or before Sep 25, 2026
THIS IS NOT AN OFFICIAL RECEIPT`),
  bill(`MOUNTAIN WATER DISTRICT
WATER BILL
Account Name RESIDENT
Billing Period AUG 2026
Present reading 345 Previous 331 Consumption 14 cu.m.
Current bill 410.00
Arrears 0.00
Total amount due 410.00
Due date 09/15/2026
Disconnection date 09/22/2026
Pay at any accredited payment center`),
  bill(`FIBERNET HOME
STATEMENT OF ACCOUNT
Plan 1699 Unli Fiber
Previous balance 0.00
Monthly service fee 1,699.00
Total amount due 1,699.00
Due date October 5, 2026
Please disregard if payment has been made
This is not a receipt`),
  bill(`TELCO POSTPAID BILL
Statement Date Sep 18, 2026
Plan 999
Total Current Charges 999.00
Amount Due 999.00
Pay before Oct 08, 2026 to avoid late payment charges
Ways to pay: app, bank, payment centers`),
  bill(`CREDIT CARD STATEMENT
Statement Balance 6,320.40
Minimum Amount Due 850.00
Payment Due Date 10/12/2026
Previous Balance Purchases Payments Finance Charges
Credit Limit 30,000.00 Available Credit 23,679.60`),
  bill(`RIVERSIDE ELECTRIC COOPERATIVE
BILLING INVOICE 0000123
PERIOD COVERED 03/10/2025-04/10/2025
PASS-THROUGH CHARGES DISTRIBUTION CHARGES
TOTAL CURRENT BILL AMOUNT 2,871.10
GRAND TOTAL / NETBILL 2,871.10
PLEASE PAY ON OR BEFORE Apr 22, 2025
THIS IS NOT A RECEIPT UNLESS MACHINE VALIDATED
REMINDER AND/OR DISCONNECTION NOTICE`),

  // ── Assessments of fees ─────────────────────────────────────────────────
  assessment(`VALLEY STATE UNIVERSITY
ASSESSMENT OF FEES
First Semester 2026-2027
Student No 2026-0001 Course BSED 1
Tuition 15 units x 300.00 4,500.00
Laboratory Fee 800.00
Miscellaneous Fees 1,250.00
Total Assessment 6,550.00
Payment Schedule Downpayment 2,000.00 Prelim 1,516.67 Midterm 1,516.67 Finals 1,516.67
Amount Due 2,000.00`),
  assessment(`Hillcrest College
Assessment (First Term 2025)
ID Number 0000001 Program & Year BSIT-1
Subject Description Units Schedule Section
ASSESSMENT OF FEES TOTAL TUITION AND FEES 5,210.40
Tuition Fees 3,400.00 Miscellaneous Fees 1,810.40
DOWNPAYMENT 2,605.20 MIDTERM 1,302.60 FINALS 1,302.60
AMOUNT DUE 2,605.20 GRAND TOTAL 5,210.40
Enrollment is not yet validated
To validate your enrolment please pay at least the down payment on or before July 3, 2025`),
  assessment(`ST. ANDREW ACADEMY
STATEMENT OF ACCOUNT - STUDENT
School Year 2026-2027 Grade 10
Tuition Fee 18,000.00 Books 3,500.00 Other Fees 2,100.00
Total Fees 23,600.00
Less Payments 5,000.00
Balance 18,600.00
Due this month 1,860.00`),
  assessment(`ENROLLMENT ASSESSMENT FORM
Registration Fee 300.00
Tuition Fee 6,000.00
Energy Fee 450.00
Total 6,750.00
Minimum downpayment required 1,500.00
Please proceed to the cashier`),

  assessment(`OFFICE OF THE REGISTRAR
REGISTRATION AND ASSESSMENT FORM
Units enrolled 21 Tuition per unit 250.00
Tuition 5,250.00 Lab fees 600.00 Misc 1,100.00
Total amount 6,950.00
Initial payment 2,000.00 Balance 4,950.00
Not officially enrolled until the initial payment is made`),
  assessment(`SCHOOL FEES SCHEDULE OF PAYMENT
Upon enrollment 3,000.00
1st quarter 2,500.00
2nd quarter 2,500.00
3rd quarter 2,500.00
Total school fees 10,500.00
Please settle on or before the due dates`),

  // ── Checkouts: an order not yet placed ──────────────────────────────────
  checkout(`Checkout
Delivery Address
Package 1 of 1 Shipped by DEMO SHOP
Choose your delivery option Standard Delivery Est. Arrival 21-23 Jan
USB Headset Color Family Black 640.00 Qty 1
1 Items, Total 640.00
Subtotal (1 Items) 640.00
Shipping Fee 75.00
Enter Voucher Code APPLY
Total 715.00
VAT included, where applicable Place Order`),
  checkout(`Checkout
Shipping Option Standard Local
Merchandise Subtotal 1,250.00
Shipping Subtotal 45.00
Voucher Discount -50.00
Total Payment 1,245.00
Payment Method Cash on Delivery
Place Order`),
  checkout(`Shopping Cart (3)
Select All
Running Shoes Size 9 1,899.00
Phone Case 149.00
Total 2,048.00
Check Out (2)`),
  checkout(`Review your order
Deliver to Home
Items 3 Subtotal 540.00
Delivery fee 49.00
Small order fee 0.00
Total 589.00
Payment method GCash
Place order`),
  checkout(`Booking summary
Pickup point Mall entrance Drop-off Bus terminal
Fare estimate 230.00 - 260.00
Payment Cash
Book now`),

  checkout(`Cart
Subtotal 1,120.00
Shipping fee calculated at checkout
Proceed to checkout`),
  checkout(`Order Summary
Select payment method
Items subtotal 2,499.00
Shipping 60.00
Voucher Apply
Total 2,559.00
Pay now`),
  checkout(`Confirm your order
Delivery address Add address
2 items 798.00
Delivery 50.00
Total to pay 848.00
Place order now`),

  // ── Quotations and estimates ────────────────────────────────────────────
  quote(`QUOTATION
Quotation No Q-2026-014
Valid until Oct 30, 2026
Laptop repair: replace keyboard 1,800.00
Labor 500.00
Total quoted amount 2,300.00
Prices subject to change without prior notice`),
  quote(`ESTIMATE
Prepared for Customer
Paint 4 gallons 2,400.00
Labor 3,000.00
Estimated total 5,400.00
This is not an invoice`),
  quote(`PRO FORMA INVOICE
Items to be supplied
Printer ink set 1,350.00
Total amount 1,350.00
Payment terms 50% down payment upon confirmation`),
  quote(`PRICE QUOTATION
To Customer
Description Qty Unit price Amount
Uniform set 2 650.00 1,300.00
Quoted total 1,300.00
Quotation valid for 15 days
Not an official receipt`),
  quote(`REPAIR ESTIMATE
Motorcycle tune up 650.00
Parts estimate 1,200.00
Estimated cost 1,850.00
Final amount may change after inspection`),
];
