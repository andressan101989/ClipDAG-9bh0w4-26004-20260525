ALTER TABLE ledger_accounts 
ADD CONSTRAINT ledger_accounts_system_unique 
UNIQUE NULLS NOT DISTINCT (owner_id, account_type);;
