const coffee = '/images/bebidas-transparentes.png';
const others = '/images/menu-complementos-transparentes.png';
// Ventanas de cada silueta: evitan que se asome una bebida vecina del atlas.
const coffeeFrames = [[80,67,254,313],[412,54,432,335],[929,72,249,306],[63,468,374,288],[492,425,273,358],[918,410,260,391],[69,814,296,385],[482,807,298,395],[895,811,300,392]];
const otherFrames = [[25,89,263,181],[352,31,147,244],[630,24,141,254],[889,25,182,255],[61,289,174,279],[341,300,169,268],[651,297,99,279],[863,328,230,234],[20,592,248,222],[301,612,245,195],[580,599,241,215],[864,587,235,231],[18,840,256,235],[296,854,248,201],[573,836,256,241],[854,839,255,240],[11,1108,279,238],[304,1111,242,227],[569,1121,293,222],[888,1101,227,237]];
function illustration(src, frames, index, width, height) {
  const [x,y,w,h] = frames[index];
  return { src, viewBox: `${x-3} ${y-3} ${w+6} ${h+6}`, width, height };
}
// El catálogo y sus precios siguen siendo datos vivos; estas son ilustraciones.
export function menuIllustration(product) {
  const name = (product.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/ques[ao]\s*burgu?er|quesa\s*burguesa/.test(name)) {
    return { src: '/images/quesaburger.png', viewBox: '0 0 1254 1254', width: 1254, height: 1254 };
  }
  const otherRules = [
    [/\bte\b|infusion/, 0], [/chocomilk|choco milk/, 1], [/esquimo/, 2], [/frap.*fresa/, 3],
    [/horchata/, 4], [/jamaica/, 5], [/refresco|cola/, 6], [/brownie/, 7], [/concha/, 8],
    [/galleta.*(ny|new york)/, 10], [/galleta.*chisp|cookie/, 9], [/muffin|panque/, 11],
    [/oreja|palmier/, 12], [/tarta.*frut/, 13], [/hawaiana|hawai/, 15], [/papas|patatas/, 16],
    [/cheeseburger/, 17], [/hamburguesa|burger/, 14], [/torta/, 18], [/chocolate/, 19],
  ];
  const other = otherRules.find(([pattern]) => pattern.test(name));
  // Moka/Oreo/Café se resuelven antes del chocolate genérico.
  let index = /frap/.test(name) && !/fresa/.test(name)
    ? /oreo/.test(name) ? 7 : /moka|mocha/.test(name) ? 8 : 6
    : /espresso/.test(name) ? 0 : /americano/.test(name) ? 1 : /cortado/.test(name) ? 2
    : /capuch|cappuc/.test(name) ? 3 : /latte/.test(name) ? (product.frio || /helado|frio/.test(name) ? 5 : 4) : null;
  if (index !== null) return illustration(coffee, coffeeFrames, index, 1254, 1254);
  if (other) return illustration(others, otherFrames, other[1], 1122, 1402);
  return null;
}
