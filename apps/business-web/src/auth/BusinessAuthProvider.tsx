import type { Session, User } from "@supabase/supabase-js";
/* eslint-disable react-refresh/only-export-components -- provider and its single consumer hook form one owner-context authority */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  businessGateway,
  type BusinessGateway,
  type MarketplaceSeller,
  type MarketplaceStore,
  type SellerApplicationInput,
  type StoreProfileInput,
} from "../lib/businessApi";
import { supabase, type BusinessSupabaseClient } from "../lib/supabase";

export type BusinessPhase =
  | "loading"
  | "error"
  | "signed_out"
  | "no_seller"
  | "seller_pending"
  | "seller_rejected"
  | "seller_suspended"
  | "approved_no_store"
  | "store_draft"
  | "store_active"
  | "store_suspended";

type BusinessAuthState = {
  phase: BusinessPhase;
  loading: boolean;
  session: Session | null;
  user: User | null;
  seller: MarketplaceSeller | null;
  store: MarketplaceStore | null;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
  applySeller: (input: SellerApplicationInput) => Promise<void>;
  updateSeller: (input: SellerApplicationInput) => Promise<void>;
  createStore: (input: StoreProfileInput) => Promise<void>;
  updateStore: (input: StoreProfileInput) => Promise<void>;
};

const BusinessAuthContext = createContext<BusinessAuthState | null>(null);

function derivePhase(
  loading: boolean,
  session: Session | null,
  seller: MarketplaceSeller | null,
  store: MarketplaceStore | null,
  error: string | null,
): BusinessPhase {
  if (loading) return "loading";
  if (error) return "error";
  if (!session) return "signed_out";
  if (!seller) return "no_seller";
  if (seller.status === "pending") return "seller_pending";
  if (seller.status === "rejected") return "seller_rejected";
  if (seller.status === "suspended") return "seller_suspended";
  if (!store) return "approved_no_store";
  if (store.status === "draft") return "store_draft";
  if (store.status === "suspended") return "store_suspended";
  return "store_active";
}

export function BusinessAuthProvider({
  children,
  client = supabase,
  gateway = businessGateway,
}: {
  children: ReactNode;
  client?: BusinessSupabaseClient;
  gateway?: BusinessGateway;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [seller, setSeller] = useState<MarketplaceSeller | null>(null);
  const [store, setStore] = useState<MarketplaceStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const resolve = useCallback(
    async (nextSession: Session | null) => {
      const request = ++requestRef.current;
      setSession(nextSession);
      setError(null);
      if (!nextSession) {
        setUser(null);
        setSeller(null);
        setStore(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const identity = await gateway.loadIdentity(client);
        if (request !== requestRef.current) return;
        setUser(identity.user);
        setSeller(identity.seller);
        setStore(identity.store);
      } catch (cause) {
        if (request !== requestRef.current) return;
        setUser(null);
        setSeller(null);
        setStore(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "No se pudo cargar el contexto empresarial",
        );
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [client, gateway],
  );

  useEffect(() => {
    let mounted = true;
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) {
        setError(sessionError.message);
        setLoading(false);
        return;
      }
      void resolve(data.session);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      queueMicrotask(() => {
        if (mounted) void resolve(nextSession);
      });
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [client, resolve]);

  const login = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      setError(null);
      const { data, error: authError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) {
        setLoading(false);
        throw authError;
      }
      await resolve(data.session);
    },
    [client, resolve],
  );

  const logout = useCallback(async () => {
    const { error: authError } = await client.auth.signOut();
    if (authError) throw authError;
    await resolve(null);
  }, [client, resolve]);

  const retry = useCallback(() => resolve(session), [resolve, session]);

  const applySeller = useCallback(
    async (input: SellerApplicationInput) => {
      await gateway.applySeller(input, client);
      await resolve(session);
    },
    [client, gateway, resolve, session],
  );

  const updateSeller = useCallback(
    async (input: SellerApplicationInput) => {
      await gateway.updateSeller(input, client);
      await resolve(session);
    },
    [client, gateway, resolve, session],
  );

  const createStoreAction = useCallback(
    async (input: StoreProfileInput) => {
      await gateway.createStore(input, client);
      await resolve(session);
    },
    [client, gateway, resolve, session],
  );

  const updateStoreAction = useCallback(
    async (input: StoreProfileInput) => {
      if (!store) throw new Error("store_context_required");
      await gateway.updateStore(store.id, input, client);
      await resolve(session);
    },
    [client, gateway, resolve, session, store],
  );

  const phase = derivePhase(loading, session, seller, store, error);
  const value = useMemo(
    () => ({
      phase,
      loading,
      session,
      user,
      seller,
      store,
      error,
      login,
      logout,
      retry,
      applySeller,
      updateSeller,
      createStore: createStoreAction,
      updateStore: updateStoreAction,
    }),
    [
      phase,
      loading,
      session,
      user,
      seller,
      store,
      error,
      login,
      logout,
      retry,
      applySeller,
      updateSeller,
      createStoreAction,
      updateStoreAction,
    ],
  );

  return (
    <BusinessAuthContext.Provider value={value}>
      {children}
    </BusinessAuthContext.Provider>
  );
}

export function useBusinessAuth() {
  const value = useContext(BusinessAuthContext);
  if (!value) throw new Error("BusinessAuthProvider requerido");
  return value;
}
