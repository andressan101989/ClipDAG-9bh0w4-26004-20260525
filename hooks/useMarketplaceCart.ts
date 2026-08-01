import {useContext} from 'react';
import {MarketplaceCartContext} from '@/contexts/MarketplaceCartContext';

export function useMarketplaceCart(){
  const value=useContext(MarketplaceCartContext);
  if(!value)throw new Error('useMarketplaceCart must be used within MarketplaceCartProvider');
  return value;
}
