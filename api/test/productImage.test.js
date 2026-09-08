const test=require('node:test');
const assert=require('node:assert/strict');
const {productImage}=require('../src/utils/productImage');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('product image supports storing, preserving and removing a raster photo',()=>{
 assert.equal(productImage(png),png);
 assert.equal(productImage(undefined),undefined);
 assert.equal(productImage(null),null);
 assert.equal(productImage(''),null);
});
test('product image rejects scripts, external URLs, disguised formats and oversized payloads',()=>{
 for(const value of ['https://example.com/a.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,PHNjcmlwdD4=',png+'!',123,'x'.repeat(1400001)])assert.throws(()=>productImage(value));
});
