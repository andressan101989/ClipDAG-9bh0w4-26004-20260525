/* eslint-disable react-refresh/only-export-components -- provider and hook are one business-context authority */
import type { Session, User } from "@supabase/supabase-js";
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
  type BusinessAccess,
  type BusinessCapability,
  type BusinessGateway,
  type MarketplaceSeller,
  type SellerApplicationInput,
  type StoreProfileInput,
} from "../lib/businessApi";
import { supabase, type BusinessSupabaseClient } from "../lib/supabase";

const BUSINESS_SELECTION_KEY = "nelyon.business.selected-owner";

export type BusinessPhase =
  | "loading"
  | "error"
  | "signed_out"
  | "no_seller"
  | "seller_pending"
  | "seller_rejected"
  | "seller_suspended"
  | "select_business"
  | "no_permissions"
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
  businesses: BusinessAccess[];
  currentBusiness: BusinessAccess | null;
  store: BusinessAccess["store"];
  accessType: BusinessAccess["accessType"] | null;
  effectiveCapabilities: BusinessCapability[];
  error: string | null;
  hasCapability: (code: BusinessCapability) => boolean;
  selectBusiness: (businessOwnerId: string) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
  applySeller: (input: SellerApplicationInput) => Promise<void>;
  updateSeller: (input: SellerApplicationInput) => Promise<void>;
  createStore: (input: StoreProfileInput) => Promise<void>;
  updateStore: (input: StoreProfileInput) => Promise<void>;
};

const BusinessAuthContext = createContext<BusinessAuthState | null>(null);

function storedSelection() {
  try {
    return window.sessionStorage.getItem(BUSINESS_SELECTION_KEY);
  } catch {
    return null;
  }
}

function persistSelection(value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(BUSINESS_SELECTION_KEY, value);
    else window.sessionStorage.removeItem(BUSINESS_SELECTION_KEY);
  } catch {
    // Selection persistence is UX only; server authorization remains authoritative.
  }
}

function derivePhase(
  loading: boolean,
  session: Session | null,
  seller: MarketplaceSeller | null,
  businesses: BusinessAccess[],
  currentBusiness: BusinessAccess | null,
  error: string | null,
): BusinessPhase {
  if (loading) return "loading";
  if (error) return "error";
  if (!session) return "signed_out";
  if (businesses.length > 1 && !currentBusiness) return "select_business";
  if (currentBusiness) {
    if (currentBusiness.capabilities.length === 0) return "no_permissions";
    if (currentBusiness.accessType === "owner" && !currentBusiness.store) return "approved_no_store";
    if (currentBusiness.store?.status === "draft") return "store_draft";
    if (currentBusiness.store?.status === "suspended") return "store_suspended";
    return "store_active";
  }
  if (!seller) return "no_seller";
  if (seller.status === "pending") return "seller_pending";
  if (seller.status === "rejected") return "seller_rejected";
  if (seller.status === "suspended") return "seller_suspended";
  return "approved_no_store";
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
  const [businesses, setBusinesses] = useState<BusinessAccess[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const resolve = useCallback(async (nextSession: Session | null) => {
    const request = ++requestRef.current;
    setSession(nextSession);
    setError(null);
    if (!nextSession) {
      setUser(null);
      setSeller(null);
      setBusinesses([]);
      setSelectedOwnerId(null);
      persistSelection(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const identity = await gateway.loadIdentity(client);
      if (request !== requestRef.current) return;
      const saved = storedSelection();
      const selected = identity.businesses.find((item) => item.businessOwnerId === saved)
        ?? (identity.businesses.length === 1 ? identity.businesses[0] : null);
      setUser(identity.user);
      setSeller(identity.ownedSeller);
      setBusinesses(identity.businesses);
      setSelectedOwnerId(selected?.businessOwnerId ?? null);
      persistSelection(selected?.businessOwnerId ?? null);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setUser(null);
      setSeller(null);
      setBusinesses([]);
      setSelectedOwnerId(null);
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el contexto empresarial");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [client, gateway]);

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

  const currentBusiness = useMemo(
    () => businesses.find((item) => item.businessOwnerId === selectedOwnerId) ?? null,
    [businesses, selectedOwnerId],
  );
  const hasCapability = useCallback(
    (code: BusinessCapability) => currentBusiness?.capabilities.includes(code) ?? false,
    [currentBusiness],
  );
  const selectBusiness = useCallback((businessOwnerId: string) => {
    if (!businesses.some((item) => item.businessOwnerId === businessOwnerId)) return;
    setSelectedOwnerId(businessOwnerId);
    persistSelection(businessOwnerId);
  }, [businesses]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    const { data, error: authError } = await client.auth.signInWithPassword({ email, password });
    if (authError) {
      setLoading(false);
      throw authError;
    }
    await resolve(data.session);
  }, [client, resolve]);

  const logout = useCallback(async () => {
    const { error: authError } = await client.auth.signOut();
    if (authError) throw authError;
    await resolve(null);
  }, [client, resolve]);
  const retry = useCallback(() => resolve(session), [resolve, session]);

  const applySeller = useCallback(async (input: SellerApplicationInput) => {
    await gateway.applySeller(input, client);
    await resolve(session);
  }, [client, gateway, resolve, session]);
  const updateSeller = useCallback(async (input: SellerApplicationInput) => {
    await gateway.updateSeller(input, client);
    await resolve(session);
  }, [client, gateway, resolve, session]);
  const createStoreAction = useCallback(async (input: StoreProfileInput) => {
    if (currentBusiness?.accessType !== "owner") throw new Error("business_owner_required");
    await gateway.createStore(input, client);
    await resolve(session);
  }, [client, currentBusiness, gateway, resolve, session]);
  const updateStoreAction = useCallback(async (input: StoreProfileInput) => {
    if (!currentBusiness?.store) throw new Error("store_context_required");
    if (!hasCapability("business.store.manage")) throw new Error("business_capability_required");
    await gateway.updateStore(currentBusiness.store.id, input, client);
    await resolve(session);
  }, [client, currentBusiness, gateway, hasCapability, resolve, session]);

  const phase = derivePhase(loading, session, seller, businesses, currentBusiness, error);
  const value = useMemo<BusinessAuthState>(() => ({
    phase,
    loading,
    session,
    user,
    seller,
    businesses,
    currentBusiness,
    store: currentBusiness?.store ?? null,
    accessType: currentBusiness?.accessType ?? null,
    effectiveCapabilities: currentBusiness?.capabilities ?? [],
    error,
    hasCapability,
    selectBusiness,
    login,
    logout,
    retry,
    applySeller,
    updateSeller,
    createStore: createStoreAction,
    updateStore: updateStoreAction,
  }), [
    phase, loading, session, user, seller, businesses, currentBusiness, error,
    hasCapability, selectBusiness, login, logout, retry, applySeller,
    updateSeller, createStoreAction, updateStoreAction,
  ]);

  return <BusinessAuthContext.Provider value={value}>{children}</BusinessAuthContext.Provider>;
}

export function useBusinessAuth() {
  const value = useContext(BusinessAuthContext);
  if (!value) throw new Error("BusinessAuthProvider requerido");
  return value;
}
