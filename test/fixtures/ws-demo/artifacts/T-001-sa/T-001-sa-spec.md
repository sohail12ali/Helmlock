# T-001-sa Gift card redemption

## Summary
Let customers redeem a gift card balance at checkout.

## Rules
1. Apply the lesser of balance and order total.
2. Deduct only when the order is placed.

## Acceptance criteria
- **AC-1** Given a 50.00 card and a 30.00 order, when placed, then the card has 20.00 left.
- **AC-2** Given a 20.00 card and a 30.00 order, when applied, then 10.00 remains to pay.
- **AC-3** Given an unknown code, when applied, then it is rejected.
