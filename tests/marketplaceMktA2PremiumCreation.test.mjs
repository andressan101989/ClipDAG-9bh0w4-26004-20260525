import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const creation=fs.readFileSync('app/create-product.tsx','utf8');
const ui=fs.readFileSync('components/marketplace/MarketplaceCreationUI.tsx','utf8');
const edit=fs.readFileSync('app/seller/product/[id]/edit.tsx','utf8');

test('static client contract: creation is a real five-step stateful flow',()=>{
  assert.match(ui,/const STEPS = \['Información', 'Fotos', 'Opciones', 'Variantes', 'Revisar'\]/);
  assert.match(creation,/const \[step, setStep\] = useState\(0\)/);
  assert.match(creation,/MarketplaceCreationProgress current=\{step\}/);
  assert.match(creation,/setStep\(current => Math\.min\(4, current \+ 1\)\)/);
  assert.match(creation,/setStep\(current => current - 1\)/);
});

test('static client contract: sticky navigation is safe-area and keyboard aware',()=>{
  assert.match(creation,/KeyboardAvoidingView/);
  assert.match(creation,/MarketplaceStickyFooter/);
  assert.match(ui,/paddingBottom: Math\.max\(bottom, Spacing\.sm\)/);
  assert.match(ui,/accessibilityState=\{\{ disabled:/);
});

test('static client contract: photo UX retains authoritative uploads and duplicate-tap protection',()=>{
  assert.match(creation,/const MAX_PRODUCT_IMAGES = 5/);
  assert.match(creation,/Agrega hasta 5 fotos/);
  assert.match(creation,/\{images\.length\}\/\{MAX_PRODUCT_IMAGES\} fotos agregadas/);
  assert.match(creation,/Máximo 5 fotos/);
  assert.match(creation,/La primera foto será la portada/);
  assert.match(creation,/if \(uploadBatchLockRef\.current \|\| isUploadingImage\) return/);
  assert.match(creation,/uploadMediaFromUri/);
  assert.match(creation,/draftAssetIdsRef/);
});

test('static client contract: gallery selection fills only the ordered remaining capacity',()=>{
  assert.match(creation,/const remainingSlots = MAX_PRODUCT_IMAGES - images\.length/);
  assert.match(creation,/allowsMultipleSelection: true/);
  assert.match(creation,/selectionLimit: remainingSlots/);
  assert.match(creation,/orderedSelection: true/);
  assert.doesNotMatch(creation,/allowsEditing/);
  assert.match(creation,/result\.assets\.slice\(0, remainingSlots\)/);
  assert.match(creation,/for \(const \[selectedAssetIndex, asset\] of selectedAssets\.entries\(\)\)/);
  assert.doesNotMatch(creation,/Promise\.all\(selectedAssets/);
});

test('static client contract: batch uploads preserve order, progress, and successful R2 ownership',()=>{
  const upload=creation.indexOf('const uploaded = await uploadMediaFromUri');
  const appendUrl=creation.indexOf('setImages(current => [...current, uploaded.url!])',upload);
  const appendId=creation.indexOf('setImageAssetIds(current => [...current, uploaded.assetId])',upload);
  const trackDraft=creation.indexOf('draftAssetIdsRef.current = [...draftAssetIdsRef.current, uploaded.assetId]',upload);
  assert.ok(upload>0&&upload<appendUrl&&appendUrl<appendId&&appendId<trackDraft);
  assert.match(creation,/uploaded\.url\?\.startsWith\('https:\/\/'\)/);
  assert.match(creation,/setPhotoUploadProgress\(\{ current: selectedAssetIndex \+ 1, total: selectedAssets\.length \}\)/);
  assert.match(creation,/Subiendo foto \$\{photoUploadProgress\.current\} de \$\{photoUploadProgress\.total\}…/);
  assert.match(creation,/uploadBatchLockRef\.current = true/);
  assert.match(creation,/uploadBatchLockRef\.current = false/);
  assert.match(creation,/\{index === 0 \? <View style=\{styles\.coverBadge\}/);
});

test('static client contract: partial batch failure keeps successes and reports one safe summary',()=>{
  assert.match(creation,/successfulUploads \+= 1/);
  assert.match(creation,/const failedUploads = selectedAssets\.length - successfulUploads/);
  assert.match(creation,/Una foto no pudo subirse/);
  assert.match(creation,/Se agregaron \$\{successfulUploads\} de \$\{selectedAssets\.length\} fotos/);
  assert.equal((creation.match(/showAlert\(\s*title,\s*`Se agregaron/g)||[]).length,1);
  assert.match(creation,/httpStatus: safe\.httpStatus/);
  assert.match(creation,/selectedAssetIndex/);
  assert.doesNotMatch(creation,/setImages\([^)]*(?:asset\.uri|result\.assets)/);
  assert.match(creation,/for \(const assetId of abandoned\) void deleteMediaAsset/);
});

test('static client contract: product types are large accessible choice cards',()=>{
  assert.match(creation,/MarketplaceChoiceCard[\s\S]+Producto simple/);
  assert.match(creation,/MarketplaceChoiceCard[\s\S]+Producto con variantes/);
  assert.match(ui,/accessibilityRole="radio"/);
});

test('static client contract: comma entry UI is replaced by value chips',()=>{
  assert.match(creation,/valueComposer/);
  assert.match(creation,/valueChip/);
  assert.match(creation,/onSubmitEditing=\{\(\) => addOptionValue/);
  assert.match(creation,/removeOptionValue/);
  assert.doesNotMatch(creation,/Valores separados por comas/);
  assert.doesNotMatch(creation,/valuesText=\{option\.valuesText\}/);
});

test('static client contract: arbitrary names, limits, duplicates, and live count are surfaced',()=>{
  assert.match(creation,/Color', 'Talla', 'Material', 'Capacidad', 'Estilo/);
  assert.match(creation,/updateOptionName/);
  assert.match(creation,/Cada opción admite hasta 20 valores/);
  assert.match(creation,/El máximo es 100 variantes/);
  assert.match(creation,/Se generarán \$\{combinationEstimate\} variantes/);
  assert.match(creation,/toLocaleLowerCase\('es'\)/);
  assert.doesNotMatch(creation,/name:\s*'Color'/);
});

test('static client contract: variant list is collapsed, memoized, and incrementally rendered',()=>{
  assert.match(creation,/FlatList/);
  assert.match(creation,/expandedVariantKey/);
  assert.match(creation,/initialNumToRender=\{12\}/);
  assert.match(ui,/memo\(function MarketplaceVariantListItem/);
  assert.match(ui,/expanded \? <View style=\{styles\.variantEditor\}/);
});

test('static client contract: bulk editing has explicit scope and destructive confirmation',()=>{
  assert.match(creation,/MarketplaceBulkEditSheet/);
  assert.match(ui,/Los cambios afectarán \{count\} variantes/);
  assert.match(ui,/Generar SKU automáticamente/);
  assert.match(creation,/Este precio se aplicará a \$\{variantDrafts\.length\} variantes/);
  assert.match(creation,/Desactivar todas/);
});

test('static client contract: exactly one default and regeneration safety remain explicit',()=>{
  assert.match(creation,/isDefault: itemIndex === index/);
  assert.match(creation,/Mostrar primero/);
  assert.match(creation,/Volver a generar puede reemplazar cambios sin guardar/);
  assert.match(creation,/const previous = new Map/);
  assert.match(creation,/previous\.get\(item\.key\) \?\? item/);
});

test('static client contract: review provides preview and direct edit navigation',()=>{
  assert.match(creation,/Todo listo para publicar/);
  assert.match(creation,/Desde \$\{minVariantPrice\.toFixed\(2\)\} BDAG/);
  assert.match(creation,/reviewRow\('edit-note', 'Información'/);
  assert.match(creation,/reviewRow\('photo-library', 'Fotos'/);
  assert.match(creation,/reviewRow\('tune', 'Opciones'/);
  assert.match(creation,/reviewRow\('inventory-2', 'Variantes'/);
});

test('static client integration: private draft order, retry identity, and duplicate lock are preserved',()=>{
  const draft=creation.indexOf('await createProductDraft');
  const configure=creation.indexOf('await configureProductVariants');
  const publish=creation.indexOf('await setProductPublished');
  assert.ok(draft>0&&draft<configure&&configure<publish);
  assert.match(creation,/let productId = activeDraftId/);
  assert.match(creation,/configurationKeyRef\.current/);
  assert.match(creation,/publishLockRef\.current \|\| isPublishing/);
  assert.match(creation,/Tu producto permanece privado/);
  assert.match(creation,/deleteIncompleteDraft/);
  assert.doesNotMatch(creation,/setVariantInventory|adjustVariantInventory/);
});

test('static client contract: product edit exposes a premium setup summary',()=>{
  assert.match(edit,/Producto simple/);
  assert.match(edit,/Producto con variantes/);
  assert.match(edit,/Agregar variantes/);
  assert.match(edit,/Administrar variantes/);
  assert.match(edit,/variantCount/);
  assert.match(edit,/activeVariantCount/);
  assert.match(edit,/totalInventory/);
  assert.match(edit,/priceRange/);
});

test('static scope contract: no direct writes or unrelated commerce systems were introduced',()=>{
  assert.doesNotMatch(creation,/\.from\('products'\)\.(insert|update)/);
  assert.doesNotMatch(`${creation}\n${ui}\n${edit}`,/\b(ledger|bdag transfer)\b/i);
});
