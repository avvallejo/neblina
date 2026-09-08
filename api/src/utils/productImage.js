const { ApiError } = require('./asyncHandler');
function productImage(value) {
  if(value===undefined) return undefined;
  if(value===null||value==='') return null;
  if(typeof value!=='string'||value.length>1400000) throw new ApiError(400,'La imagen debe pesar menos de 1 MB.');
  const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!m) throw new ApiError(400,'Usa una imagen PNG, JPG o WebP.');
  const b=Buffer.from(m[2],'base64');
  const valid=m[1]==='png'?b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):
    m[1]==='jpeg'?b[0]===255&&b[1]===216&&b[2]===255:
    b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
  if(!valid||b.length>1048576||b.toString('base64')!==m[2]) throw new ApiError(400,'La imagen no es válida. Elige otro archivo PNG, JPG o WebP.');
  return value;
}
module.exports={productImage};
