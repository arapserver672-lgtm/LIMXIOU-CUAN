# LIMXIOCUAN Telegram Bot — v1.0.0

Node.js 20 + Vercel Functions + Neon PostgreSQL. This package contains the bot source and SQL schema. It does **not** include private credentials; never hard-code bot/database tokens into source code.

## Included
- Mandatory membership gate: one channel and two groups (`getChatMember`). Add the bot as admin/member with permission to inspect members in all three chats.
- User menu: tasks, create task, wallet, deposit, withdrawal, angpao, referral, history, my tasks, leaderboard, about.
- Task budget escrow from task creator's wallet; minimum gross reward Rp5,000 per slot; worker receives 95% after 5% platform service fee. Admin reviews proof.
- Deposit proof queue; balance is credited only after admin approval. Deposit admin fees are added on top of the requested balance.
- Withdrawal balance is reserved at request; admin approves, manually transfers, then separately confirms completion. Rejection refunds the reserved balance.
- Angpao claim is one-per-user per campaign; campaign funding is debited from the admin Telegram account's in-bot wallet.
- Referral bonus Rp1,000 is credited to inviter after the referred user makes their first admin-approved deposit.
- Private user notifications plus channel announcements for tasks, angpao, approved deposits, and withdrawal status.
- Admin panel: pending deposits, pending withdrawals, task proofs, task closure/refund, angpao creation, stats, broadcast.

## 1. Create Neon schema
1. Open the Neon project and SQL Editor.
2. Run the entire `sql/schema.sql` file once.
3. Copy the PostgreSQL connection string. Use it only as Vercel's `DATABASE_URL` environment variable.

## 2. Deploy to Vercel
1. Upload this folder to a GitHub repository.
2. Import that repository in Vercel. Framework preset: Other. Build command can be empty; output directory can be empty.
3. Add the environment variables below for Production (and Preview if you intend to test there).
4. Deploy/redeploy.

Required environment variables:
- `BOT_TOKEN`: **new** token from BotFather. The token previously pasted into chat must be revoked in BotFather and must not be reused.
- `BOT_USERNAME`: bot username without `@`.
- `ADMIN_ID`: `5280266010` (verify this is the intended owner ID).
- `DATABASE_URL`: Neon connection string.
- `WEBHOOK_SECRET`: random 32+ character secret using letters/numbers/underscore/hyphen only.
- `SETUP_SECRET`: another random secret, different from `WEBHOOK_SECRET`.
- `PUBLIC_BASE_URL`: exact Vercel production domain, e.g. `https://your-project.vercel.app`.
- `CHANNEL_ID`: `@informasilmxoucuan`
- `CHANNEL_URL`: `https://t.me/informasilmxoucuan`
- `GROUP1_ID`: `@groupdiskusixiolim`
- `GROUP1_URL`: `https://t.me/groupdiskusixiolim`
- `GROUP2_ID`: `@backupgroupxio`
- `GROUP2_URL`: `https://t.me/backupgroupxio`
- `PAYMENT_BANK`: admin bank payment instructions
- `PAYMENT_GOPAY`: admin GoPay payment instructions
- `PAYMENT_QRIS_TEXT`: QRIS instructions; can be text/link. Uploading an actual QRIS image is not included in this version.

## 3. Set Telegram webhook
After deployment, send a POST request to `https://YOUR-PROJECT.vercel.app/api/setup` with header `x-setup-secret: YOUR_SETUP_SECRET` and an empty JSON body. Example using curl:

```bash
curl -X POST 'https://YOUR-PROJECT.vercel.app/api/setup' \
  -H 'content-type: application/json' \
  -H 'x-setup-secret: YOUR_SETUP_SECRET' \
  -d '{}'
```

The response should contain `"ok":true`. Open the bot and send `/start`.

## 4. Telegram permissions
- Add the bot to the channel and both groups.
- Make it an administrator (or grant the member-inspection rights Telegram requires) so `getChatMember` can verify users.
- Make the bot an administrator in the announcement channel so it can post.
- Confirm all chat usernames/IDs are correct and the bot can access them.

## 5. Financial rules currently configured
- Deposit Rp5,000–Rp50,000: admin fee Rp3,000.
- Deposit Rp51,000–Rp100,000: admin fee Rp5,000.
- Deposit Rp101,000–Rp300,000: admin fee Rp10,000.
- Above Rp300,000: not accepted because no fee tier was specified.
- Task reward: 5% platform service fee; user receives 95% of gross reward.
- Withdrawal: Rp3,000 admin fee deducted from requested withdrawal amount; net transfer = amount − Rp3,000.
- Referral: Rp1,000 once, after the referred account's first approved deposit.

These are platform/admin fees, **not government taxes**. Deposit admin fee is charged on top of the amount credited. Withdrawal fee is deducted from the requested withdrawal amount.

## 6. Important operational notes
- The admin account must have enough in-bot wallet balance to fund an angpao. Admin wallet top-ups should be performed only through a controlled/manual ledger process; do not edit user balances casually.
- The task creator must have enough wallet balance to lock `reward × slots` before a task can be created.
- The bot does not automatically transfer real money. Admin must manually make the withdrawal transfer and only then press “Transfer sudah dilakukan”.
- No payment gateway, automatic QRIS reconciliation, or automatic bank transfer is implemented.
- Telegram file IDs are used for uploaded proofs; object storage is not required.
- Channel and private broadcast delivery can be limited by Telegram rate limits for large user counts. This implementation sends sequentially and is intended for a small/medium launch, not high-volume mass broadcasting.
- Engagement tasks must be authentic and comply with the relevant platform's rules. Do not use the bot to sell fake likes/follows/comments or manipulate metrics.
- Before real-money use, test with a separate test bot and small amounts, review database access, rotate secrets, and have an operator reconcile deposits/withdrawals manually. This source package has passed Node syntax checks, but has not been deployed against your Neon/Vercel/Telegram accounts or end-to-end tested in production.

## Admin commands
- `/admin`: open Admin Panel.
- `/cancel`: cancel the current input flow.
