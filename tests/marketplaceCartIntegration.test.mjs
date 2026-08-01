import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const detail=read('app/product/[id].tsx');const shop=read('app/(tabs)/shop.tsx');const screen=read('app/cart.tsx');
const context=read('contexts/MarketplaceCartContext.tsx');const domain=read('services/marketplaceCart.ts');const storage=read('services/marketplaceCartStorage.ts');const layout=read('app/_layout.tsx');

test('product integration uses the exact selected variant with lock, options and cart navigation',()=>{
  assert.match(detail,/variantId:selectedVariant\.id/);assert.match(detail,/selectedVariant\.option_value_ids/);
  assert.match(detail,/addToCartLockRef\.current/);assert.match(detail,/finally\{addToCartLockRef\.current=false/);
  assert.match(detail,/!selectedVariant\|\|available<=0/);assert.match(detail,/isOwner/);
  assert.match(detail,/Agregado al carrito/);assert.match(detail,/Ver carrito/);assert.match(detail,/Agregar al carrito/);
  assert.doesNotMatch(detail,/shippingAddress|orderModalVisible|Confirmar pedido/);
});

test('cart badges are immediate, capped, accessible and preserve shop wallet/bookmark entry points',()=>{
  for(const source of [detail,shop]){assert.match(source,/shopping-cart/);assert.match(source,/totalQuantity>99\?'99\+'/);assert.match(source,/Carrito, \$\{totalQuantity\} productos/);}
  assert.match(shop,/walletPill/);assert.match(detail,/bookmark/);
});

test('cart screen covers hydration, empty, unavailable, clear, refresh and accessibility contracts',()=>{
  assert.match(layout,/MarketplaceCartProvider/);assert.match(layout,/Stack\.Screen name="cart"/);
  assert.match(screen,/Cargando tu carrito/);assert.match(screen,/Tu carrito está vacío/);assert.match(screen,/Producto no disponible/);
  assert.match(screen,/Vaciar carrito/);assert.match(screen,/useFocusEffect/);assert.match(screen,/RefreshControl/);
  assert.match(screen,/accessibilityState=\{\{disabled:/);assert.match(screen,/Eliminar \$\{item\.title\} del carrito/);
  assert.match(screen,/Continuar al checkout/);assert.match(screen,/router\.push\('\/checkout'/);
});

test('persistence waits for hydration and identity changes clear memory before namespace load',()=>{
  assert.match(context,/if\(!isHydrated\|\|hydratedIdentityKey!==identityKey\)return/);assert.match(context,/setIsHydrated\(false\)[\s\S]*setItems\(\[\]\)[\s\S]*marketplaceCartStorage\.load\(identityKey\)/);
  assert.match(context,/visibleItems=useMemo\(\(\)=>identityHydrated\?items:\[\]/);
  assert.match(storage,/MARKETPLACE_CART_STORAGE_VERSION=1/);assert.match(storage,/writeChain/);
});

test('scope remains client-only with no order, payment, inventory or backend mutation',()=>{
  const changed=[detail,shop,screen,context,domain,storage,layout].join('\n');
  assert.doesNotMatch(changed,/\.from\(['"](?:orders|order_items|cart)|create_order|reserve_inventory|adjustVariantInventory|setVariantInventory|atomic_ledger_transfer|payment_intent|commission_transfer|refund_rpc|USDT/i);
  assert.doesNotMatch(changed,/supabase\/migrations|supabase\/functions/);
});
