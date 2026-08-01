import AsyncStorage from '@react-native-async-storage/async-storage';
import { isMarketplaceCartItem, type MarketplaceCartItem } from './marketplaceCart';

export const MARKETPLACE_CART_STORAGE_VERSION=1;
export const marketplaceCartStorageKey=(userId:string|null)=>
  userId?`onspace:marketplace-cart:v1:user:${userId}`:'onspace:marketplace-cart:v1:guest';

export interface MarketplaceCartStorageAdapter {
  getItem(key:string):Promise<string|null>;
  setItem(key:string,value:string):Promise<void>;
}

export class MarketplaceCartStorage {
  private writeChain:Promise<void>=Promise.resolve();
  constructor(private adapter:MarketplaceCartStorageAdapter=AsyncStorage) {}

  async load(key:string):Promise<MarketplaceCartItem[]> {
    try {
      const raw=await this.adapter.getItem(key);
      if(!raw)return [];
      const parsed:unknown=JSON.parse(raw);
      if(!parsed||typeof parsed!=='object'||(parsed as {version?:unknown}).version!==MARKETPLACE_CART_STORAGE_VERSION
        ||!Array.isArray((parsed as {items?:unknown}).items)) throw new Error('invalid_cart_envelope');
      return (parsed as {items:unknown[]}).items.filter(isMarketplaceCartItem).slice(0,100);
    } catch {
      console.warn('[MarketplaceCart] ignored invalid persisted cart');
      return [];
    }
  }

  save(key:string,items:MarketplaceCartItem[]):Promise<void> {
    const payload=JSON.stringify({version:MARKETPLACE_CART_STORAGE_VERSION,items});
    this.writeChain=this.writeChain.catch(()=>{}).then(()=>this.adapter.setItem(key,payload));
    return this.writeChain;
  }
}

export const marketplaceCartStorage=new MarketplaceCartStorage();
