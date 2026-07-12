INSERT INTO ledger_accounts (account_type, currency, balance, frozen)
VALUES 
  ('escrow', 'BDAG', 0, false),
  ('platform', 'BDAG', 0, false),
  ('treasury', 'BDAG', 0, false)
ON CONFLICT DO NOTHING;;
