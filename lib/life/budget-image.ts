// Read dimensions without decoding pixels or trusting a file extension. The
// provider still validates the image. Bound its visual input before reserving AI.
export function budgetImageDimensions(data:string,mime:string):{width:number;height:number}|null{
 try{
  const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),v=new DataView(bytes.buffer);
  if(mime==='image/png'&&bytes.length>=24)return {width:v.getUint32(16),height:v.getUint32(20)};
  if(mime==='image/jpeg')for(let p=2;p+8<bytes.length;){
   if(bytes[p++]!==255)return null;while(bytes[p]===255)p++;const marker=bytes[p++];
   if(marker===217||marker===218)return null;if(marker===1||marker>=208&&marker<=215)continue;
   const length=v.getUint16(p);if(length<2||p+length>bytes.length)return null;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {height:v.getUint16(p+3),width:v.getUint16(p+5)};
   p+=length;
  }
  if(mime==='image/webp'&&bytes.length>=30){const tag=String.fromCharCode(...bytes.slice(12,16)),u24=(p:number)=>bytes[p]+bytes[p+1]*256+bytes[p+2]*65536;
   if(tag==='VP8X')return {width:u24(24)+1,height:u24(27)+1};
   if(tag==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42)return {width:v.getUint16(26,true)&16383,height:v.getUint16(28,true)&16383};
   if(tag==='VP8L'&&bytes[20]===47){const bits=v.getUint32(21,true);return {width:(bits&16383)+1,height:((bits>>>14)&16383)+1};}
  }
 }catch{}return null;
}
