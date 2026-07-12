CREATE TABLE IF NOT EXISTS public.blockchain_settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_type  text NOT NULL,
  reference_id     uuid,
  chain_id         text NOT NULL,
  tx_hash          text NOT NULL,
  from_address     text,
  to_address       text,
  amount_wei       text,
  block_number     bigint,
  status           text,
  rpc_verified     boolean NOT NULL DEFAULT false,
  verified_at      timestamptz,
  raw_receipt      jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  unique (tx_hash)
);

ALTER TABLE blockchain_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON blockchain_settlements;
CREATE POLICY "Service role only"
  ON blockchain_settlements
  FOR ALL
  TO service_role
  USING (true);;
