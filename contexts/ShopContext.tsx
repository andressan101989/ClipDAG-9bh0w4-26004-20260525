import React,{createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import { AuthContext } from './AuthContext';
import {
  fetchProducts as loadProducts,fetchMyProducts as loadMyProducts,
  fetchSavedProductIds,toggleProductSave as persistSave,
  createProduct as createMarketplaceProduct,setProductPublished,softDeleteProduct,
  type MarketplaceCategory,type Product,type ProductMutation,
} from '@/services/marketplaceService';

export type ProductCategory=MarketplaceCategory;
export type { Product };

interface ShopContextType {
  products:Product[];myProducts:Product[];savedProductIds:Set<string>;isLoading:boolean;
  fetchProducts:(category?:string,search?:string)=>Promise<void>;
  fetchMyProducts:()=>Promise<void>;
  createProduct:(data:ProductMutation)=>Promise<{success:boolean;error?:string;product?:Product}>;
  setPublished:(id:string,published:boolean)=>Promise<{success:boolean;error?:string}>;
  deleteProduct:(id:string)=>Promise<{success:boolean;error?:string}>;
  toggleSaveProduct:(id:string)=>void;isSavedProduct:(id:string)=>boolean;
}
export const ShopContext=createContext<ShopContextType|undefined>(undefined);

function safeMessage(error:unknown):string {
  const message=error&&typeof error==='object'&&'message' in error?(error as {message?:unknown}).message:null;
  return typeof message==='string'&&message.length<160?message:'marketplace_request_failed';
}

export function ShopProvider({children}:{children:ReactNode}) {
  const auth=useContext(AuthContext);
  const user=auth?.user;
  const [products,setProducts]=useState<Product[]>([]);
  const [myProducts,setMyProducts]=useState<Product[]>([]);
  const [savedProductIds,setSavedProductIds]=useState<Set<string>>(new Set());
  const [isLoading,setIsLoading]=useState(false);

  const fetchProducts=useCallback(async(category?:string,search?:string)=>{
    setIsLoading(true);
    try {
      setProducts(await loadProducts({
        category:category&&category!=='all'?category as MarketplaceCategory:'',
        search,
      }));
    } catch { setProducts([]); }
    finally { setIsLoading(false); }
  },[]);
  const fetchMyProducts=useCallback(async()=>{
    if(!user){setMyProducts([]);return;}
    try { setMyProducts(await loadMyProducts()); } catch { setMyProducts([]); }
  },[user]);

  useEffect(()=>{void fetchProducts();},[fetchProducts]);
  useEffect(()=>{
    if(!user){setSavedProductIds(new Set());setMyProducts([]);return;}
    void fetchMyProducts();
    void fetchSavedProductIds(user.id).then(setSavedProductIds);
  },[user,fetchMyProducts]);

  const createProduct=useCallback(async(input:ProductMutation)=>{
    try {
      const id=await createMarketplaceProduct(input);
      const product=(await loadMyProducts()).find(item=>item.id===id);
      await Promise.all([fetchProducts(),fetchMyProducts()]);
      return product?{success:true,product}:{success:false,error:'product_identity_missing'};
    } catch(error){return {success:false,error:safeMessage(error)};}
  },[fetchProducts,fetchMyProducts]);
  const setPublished=useCallback(async(id:string,published:boolean)=>{
    try {await setProductPublished(id,published);await Promise.all([fetchProducts(),fetchMyProducts()]);return {success:true};}
    catch(error){return {success:false,error:safeMessage(error)};}
  },[fetchProducts,fetchMyProducts]);
  const deleteProduct=useCallback(async(id:string)=>{
    try {await softDeleteProduct(id);await Promise.all([fetchProducts(),fetchMyProducts()]);return {success:true};}
    catch(error){return {success:false,error:safeMessage(error)};}
  },[fetchProducts,fetchMyProducts]);
  const toggleSaveProduct=useCallback((id:string)=>{
    if(!user)return;
    const saved=savedProductIds.has(id);
    setSavedProductIds(previous=>{const next=new Set(previous);if(saved)next.delete(id);else next.add(id);return next;});
    void persistSave(user.id,id,!saved).then(ok=>{if(!ok)setSavedProductIds(previous=>{const next=new Set(previous);if(saved)next.add(id);else next.delete(id);return next;});});
  },[user,savedProductIds]);
  const value=useMemo(()=>({
    products,myProducts,savedProductIds,isLoading,fetchProducts,fetchMyProducts,
    createProduct,setPublished,deleteProduct,toggleSaveProduct,
    isSavedProduct:(id:string)=>savedProductIds.has(id),
  }),[products,myProducts,savedProductIds,isLoading,fetchProducts,fetchMyProducts,createProduct,setPublished,deleteProduct,toggleSaveProduct]);
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}
