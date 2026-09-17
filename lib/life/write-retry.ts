// An authentication rejection describes only this attempt. It cannot disprove
// an earlier write whose acknowledgement was lost.
export function definiteClientRejection(status:number|undefined,wasUnconfirmed:boolean):boolean{
 return status!==undefined&&status>=400&&status<500&&!(wasUnconfirmed&&(status===401||status===403));
}
