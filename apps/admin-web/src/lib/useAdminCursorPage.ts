import {useEffect,useRef,useState} from "react";
import {useSearchParams} from "react-router-dom";

/** Filter drafts live in the URL so browser Back restores the list context. */
export function useAdminUrlFilter(name:string,initial=""):[string,(value:string)=>void]{
  const [params,setParams]=useSearchParams();
  return [params.get(name)??initial,(value)=>setParams(current=>{const next=new URLSearchParams(current);if(value||initial)next.set(name,value);else next.delete(name);return next},{replace:true})];
}
export function useAdminDebouncedValue<T>(value:T,delay=250):T{
  const [settled,setSettled]=useState(value);
  useEffect(()=>{const timer=window.setTimeout(()=>setSettled(value),delay);return()=>window.clearTimeout(timer)},[value,delay]);
  return settled;
}
type CursorPage<T,C>={items:T[];next_cursor:C|null};
/** Holds only the current bounded server page; history contains cursors, never row sets. */
export function useAdminCursorPage<F,T,C>(filters:F,load:(filters:F,cursor:C|undefined,limit:number)=>Promise<CursorPage<T,C>>,revision=0){
  const key=JSON.stringify(filters),settledKey=useAdminDebouncedValue(key);
  const loadRef=useRef(load);loadRef.current=load;
  const keyRef=useRef(key);keyRef.current=key;
  const [navigation,setNavigation]=useState<{key:string;cursors:(C|undefined)[];index:number}>({key,cursors:[undefined],index:0});
  useEffect(()=>{setNavigation(previous=>previous.key===key?previous:{key,cursors:[undefined],index:0})},[key]);
  const current=navigation.key===key?navigation:{key,cursors:[undefined],index:0},cursor=current.cursors[current.index];
  const [nonce,setNonce]=useState(0);
  const scope=JSON.stringify([key,current.index,cursor]),identity=JSON.stringify([scope,nonce,revision]);
  const identityRef=useRef(identity);identityRef.current=identity;
  const [result,setResult]=useState<{identity:string;scope:string;value:CursorPage<T,C>|null;error:string|null;loading:boolean}>({identity:"",scope:"",value:null,error:null,loading:true});
  const lock=useRef(false),generation=useRef(0);
  useEffect(()=>{
    if(key!==settledKey)return;
    const request=++generation.current;let active=true;lock.current=true;
    setResult(previous=>({identity,scope,value:previous.scope===scope?previous.value:null,error:null,loading:true}));
    const isCurrent=()=>active&&request===generation.current&&identityRef.current===identity&&keyRef.current===key;
    void loadRef.current(JSON.parse(settledKey) as F,cursor,50).then(value=>{
      if(!isCurrent())return;
      const seen=new Set<unknown>();
      const items=value.items.filter(item=>{const row=item as Record<string,unknown>,id=row.id??row.assignment_id??row.campaign_id;const rowKey=id===undefined?item:JSON.stringify([row.type,id]);if(seen.has(rowKey))return false;seen.add(rowKey);return true});
      setResult({identity,scope,value:{...value,items},error:null,loading:false});
    }).catch(reason=>{if(isCurrent())setResult(previous=>({identity,scope,value:previous.scope===scope?previous.value:null,error:reason instanceof Error?reason.message:"No se pudo cargar la página",loading:false}))}).finally(()=>{if(isCurrent())lock.current=false});
    return()=>{active=false};
  },[key,settledKey,cursor,identity,scope]);
  const valid=result.scope===scope&&key===settledKey,value=valid?result.value:null,error=valid&&result.identity===identity?result.error:null,loading=!valid||result.identity!==identity||result.loading;
  const next=()=>{if(lock.current||loading||!value?.next_cursor)return;lock.current=true;setNavigation({key,cursors:[...current.cursors.slice(0,current.index+1),value.next_cursor],index:current.index+1})};
  const previous=()=>{if(lock.current||loading||current.index===0)return;lock.current=true;setNavigation({...current,index:current.index-1})};
  const retry=()=>{if(lock.current)return;lock.current=true;setNonce(n=>n+1)};
  return {value,data:value,items:value?.items??null,error,loading,retry,reload:retry,page:current.index+1,hasNext:!loading&&!error&&!!value?.next_cursor,hasPrevious:!loading&&current.index>0,next,previous};
}
