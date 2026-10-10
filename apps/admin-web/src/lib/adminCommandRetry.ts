export type AdminCommandAttempt={signature:string;idempotencyKey:string};

export function adminCommandSignature(parts:readonly string[]){
  return JSON.stringify(parts);
}

export function acquireAdminCommandAttempt(
  current:AdminCommandAttempt|null,
  signature:string,
  createId:()=>string,
):AdminCommandAttempt{
  if(current?.signature===signature)return current;
  return{signature,idempotencyKey:createId()};
}
