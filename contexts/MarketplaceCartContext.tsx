import React,{createContext,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {fetchMarketplaceProductDetail} from '@/services/marketplaceService';
import {
  addMarketplaceCartItem,marketplaceCartTotals,revalidateMarketplaceCartItems,setMarketplaceCartQuantity,
  type AddMarketplaceCartItemInput,type CartMutationResult,type MarketplaceCartItem,
} from '@/services/marketplaceCart';
import {marketplaceCartStorage,marketplaceCartStorageKey} from '@/services/marketplaceCartStorage';

export interface CartRefreshResult {
  complete:boolean;
  adjustedItemCount:number;
  priceChangedKeys:string[];
  unavailableItemCount:number;
}

export interface MarketplaceCartContextValue {
  items:MarketplaceCartItem[];
  isHydrated:boolean;
  isRefreshing:boolean;
  totalQuantity:number;
  distinctItemCount:number;
  availableItemCount:number;
  subtotal:number;
  addItem(input:AddMarketplaceCartItemInput):CartMutationResult;
  setQuantity(key:string,quantity:number):CartMutationResult;
  incrementItem(key:string):CartMutationResult;
  decrementItem(key:string):CartMutationResult;
  removeItem(key:string):void;
  removeItems(keys:string[]):void;
  clearCart():void;
  refreshCart():Promise<CartRefreshResult>;
  getItem(key:string):MarketplaceCartItem|undefined;
}

export const MarketplaceCartContext=createContext<MarketplaceCartContextValue|undefined>(undefined);

export function MarketplaceCartProvider({children}:{children:ReactNode}){
  const {user}=useAuth();
  const identityKey=marketplaceCartStorageKey(user?.id??null);
  const [items,setItems]=useState<MarketplaceCartItem[]>([]);
  const itemsRef=useRef<MarketplaceCartItem[]>([]);
  const [isHydrated,setIsHydrated]=useState(false);
  const [hydratedIdentityKey,setHydratedIdentityKey]=useState<string|null>(null);
  const [isRefreshing,setIsRefreshing]=useState(false);
  const refreshLockRef=useRef(false);
  const identityRevisionRef=useRef(0);

  const replaceItems=useCallback((next:MarketplaceCartItem[])=>{
    itemsRef.current=next;
    setItems(next);
  },[]);

  useEffect(()=>{
    const revision=++identityRevisionRef.current;
    setIsHydrated(false);
    setHydratedIdentityKey(null);
    itemsRef.current=[];
    setItems([]);
    void marketplaceCartStorage.load(identityKey).then(loaded=>{
      if(identityRevisionRef.current!==revision)return;
      itemsRef.current=loaded;
      setItems(loaded);
      setHydratedIdentityKey(identityKey);
      setIsHydrated(true);
    });
  },[identityKey]);

  useEffect(()=>{
    if(!isHydrated||hydratedIdentityKey!==identityKey)return;
    void marketplaceCartStorage.save(identityKey,items).catch(()=>{
      console.warn('[MarketplaceCart] cart persistence failed');
    });
  },[identityKey,isHydrated,hydratedIdentityKey,items]);

  const identityHydrated=isHydrated&&hydratedIdentityKey===identityKey;

  const addItem=useCallback((input:AddMarketplaceCartItemInput):CartMutationResult=>{
    if(!identityHydrated)return {ok:false,code:'unavailable'};
    const mutation=addMarketplaceCartItem(itemsRef.current,input);
    if(mutation.result.ok)replaceItems(mutation.items);
    return mutation.result;
  },[identityHydrated,replaceItems]);

  const setQuantity=useCallback((key:string,quantity:number)=>{
    const mutation=setMarketplaceCartQuantity(itemsRef.current,key,quantity);
    if(mutation.result.ok)replaceItems(mutation.items);
    return mutation.result;
  },[replaceItems]);
  const incrementItem=useCallback((key:string):CartMutationResult=>{
    const item=itemsRef.current.find(value=>value.key===key);
    return item?setQuantity(key,item.quantity+1):{ok:false,code:'not_found'};
  },[setQuantity]);
  const decrementItem=useCallback((key:string):CartMutationResult=>{
    const item=itemsRef.current.find(value=>value.key===key);
    return item?setQuantity(key,Math.max(1,item.quantity-1)):{ok:false,code:'not_found'};
  },[setQuantity]);
  const removeItem=useCallback((key:string)=>replaceItems(itemsRef.current.filter(item=>item.key!==key)),[replaceItems]);
  const removeItems=useCallback((keys:string[])=>{const selected=new Set(keys);replaceItems(itemsRef.current.filter(item=>!selected.has(item.key)));},[replaceItems]);
  const clearCart=useCallback(()=>replaceItems([]),[replaceItems]);
  const getItem=useCallback((key:string)=>identityHydrated?itemsRef.current.find(item=>item.key===key):undefined,[identityHydrated]);

  const refreshCart=useCallback(async():Promise<CartRefreshResult>=>{
    if(!identityHydrated||refreshLockRef.current)return {complete:false,adjustedItemCount:0,priceChangedKeys:[],unavailableItemCount:0};
    refreshLockRef.current=true;
    setIsRefreshing(true);
    try{
      const result=await revalidateMarketplaceCartItems(itemsRef.current,fetchMarketplaceProductDetail);
      replaceItems(result.items);
      return result;
    }finally{setIsRefreshing(false);refreshLockRef.current=false;}
  },[identityHydrated,replaceItems]);

  const visibleItems=useMemo(()=>identityHydrated?items:[],[identityHydrated,items]);
  const totals=useMemo(()=>marketplaceCartTotals(visibleItems),[visibleItems]);
  const value=useMemo<MarketplaceCartContextValue>(()=>({items:visibleItems,isHydrated:identityHydrated,isRefreshing,...totals,
    addItem,setQuantity,incrementItem,decrementItem,removeItem,removeItems,clearCart,refreshCart,getItem}),
  [visibleItems,identityHydrated,isRefreshing,totals,addItem,setQuantity,incrementItem,decrementItem,removeItem,removeItems,clearCart,refreshCart,getItem]);
  return <MarketplaceCartContext.Provider value={value}>{children}</MarketplaceCartContext.Provider>;
}
