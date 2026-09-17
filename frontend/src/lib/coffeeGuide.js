// Datos de las fichas aportadas por el negocio. No inferir la mezcla en uso
// desde un nombre de producto: el personal debe comprobar la bolsa/lote.
export const coffeeSources = {
  proveedor: ['Ficha del proveedor · septiembre de 2024', 'https://crm.rillydelievano.com/knowledge-base/article/ficha-tecnica-de-rilly-de-lievano'],
  bebidas: ['Nespresso · capuchino y latte', 'https://www.nespresso.com/uk/en/articles/cappuccino-vs-latte'],
  tostado: ['Coffee Association of Canada · tostado', 'https://coffeeassoc.com/coffee-101/roasting/'],
  historia: ['National Coffee Association · historia', 'https://www.aboutcoffee.org/origins/history-of-coffee/'],
};
export const coffeeSections = ['Nuestro café', 'Bebidas', 'Sabor y técnica', 'Historia'];
export const coffeeArticles = [
  { id: 'origen', section: 'Nuestro café', title: '¿De dónde viene nuestro café?',
    answer: 'Trabajamos con Rilly de Liévano, de El Triunfo, Chiapas. Tenemos las fichas de sus líneas Tradicional y Exportación; te confirmo cuál estamos preparando.',
    detail: 'La ficha de la empresa señala que su café procede principalmente de la finca Santa Rosa, establecida en 1968 en la zona de El Triunfo. Su sede está en Tuxtla Gutiérrez. No atribuyas una finca específica a cada bolsa sin revisar su lote.', source: 'proveedor' },
  { id: 'tradicional', section: 'Nuestro café', title: 'Tradicional · tostado medio oscuro',
    answer: 'El Tradicional viene de El Triunfo, Chiapas, y tiene tostado medio oscuro. El proveedor lo describe como un café de sabores suaves y taza limpia.',
    facts: [['Origen', 'El Triunfo, Chiapas'], ['Altitud', '1,300 msnm'], ['Variedades', 'Caturra y Sarchimor'], ['Tostado', 'Medio oscuro']],
    detail: 'La ficha lo presenta para consumo cotidiano. “Taza limpia” significa ausencia de sabores extraños o defectos perceptibles; no describe la higiene de la taza. Las notas son la descripción del proveedor, no una garantía de sabor idéntico en toda preparación.', image: '/guia-cafe/tradicional.jpg' },
  { id: 'exportacion', section: 'Nuestro café', title: 'Exportación · tostado medio',
    answer: 'El Exportación también viene de El Triunfo, Chiapas. Tiene tostado medio; el proveedor lo describe como aromático, con acidez balanceada y buen cuerpo.',
    facts: [['Origen', 'El Triunfo, Chiapas'], ['Altitud', '1,350–1,450 msnm'], ['Variedades', 'Caturra, Bourbon y Sarchimor'], ['Tostado', 'Medio']],
    detail: '“Exportación” es el nombre de esta línea: no significa que el café venga del extranjero. La ficha dice “preparación americana”, que describe la clasificación del producto del proveedor; no significa que solo sirva para preparar un americano.', image: '/guia-cafe/exportacion.jpg' },
  { id: 'confirmar', section: 'Nuestro café', title: '¿Y el Gourmet, el proceso o las notas de chocolate?',
    answer: 'Déjame revisar la bolsa y la ficha de ese café para darte el dato correcto.',
    detail: 'La ficha general menciona Gourmet y procesos lavado, honey y natural, pero no asigna un proceso a las dos líneas de las imágenes. Falta la ficha específica de Gourmet. No prometas proceso, porcentaje de arábica, certificación, puntuación, fecha de tueste ni notas de chocolate o frutas sin confirmarlos. Revisa qué bolsa está en el molino antes de responder.', source: 'proveedor' },
  { id: 'capuchino-latte', section: 'Bebidas', title: '¿Qué diferencia hay entre capuchino y latte?',
    answer: 'Los dos llevan espresso y leche. El capuchino tiene más espuma y suele sentirse más intenso; el latte lleva más leche y una capa fina de espuma, por eso resulta más suave y sedoso.',
    detail: 'No prometas más cafeína por tener sabor más intenso: depende de la dosis y los shots. Para prepararlos, sigue la receta y el tamaño del ticket; las proporciones cambian entre cafeterías.', source: 'bebidas' },
  { id: 'espresso-americano', section: 'Bebidas', title: 'Espresso, americano y cortado',
    answer: 'El espresso es corto y concentrado. El americano es espresso con agua. El cortado lleva una pequeña cantidad de leche para suavizar el café sin que deje de ser protagonista.',
    detail: 'Agregar agua baja la concentración de sabor; no elimina la cafeína del espresso. Consulta “Ver receta” para las dosis, shots y cantidades de nuestra preparación.' },
  { id: 'moka', section: 'Bebidas', title: 'Moka, frappé y bebidas con sabor',
    answer: 'Un moka combina café, leche y chocolate. Un frappé es una bebida fría licuada; sus ingredientes y si lleva café dependen del sabor y de la receta.',
    detail: 'No todos los frappés llevan café. Revisa la receta antes de ofrecer uno sin café o decir qué ingredientes contiene. Los jarabes y chocolates añadidos son diferentes de las notas naturales del grano.' },
  { id: 'recomendar', section: 'Bebidas', title: '¿Cuál le recomiendo al cliente?',
    answer: '¿Lo prefieres con leche o sin leche, más suave o con el café más presente, caliente o frío?',
    detail: 'Con leche y suave: ofrece latte. Con espuma y café más presente: capuchino. Sin leche: americano o espresso según la concentración que prefiera. Comprueba disponibilidad, tamaño y extras en el pedido; no prometas que un café es menos ácido para el estómago.' },
  { id: 'sabores', section: 'Sabor y técnica', title: '¿Por qué cambian los sabores?',
    answer: 'El sabor se forma desde el grano y su origen, cambia con el proceso y el tostado, y termina de definirse al prepararlo con agua.',
    detail: 'Variedad, maduración, proceso, frescura, agua, molienda y extracción influyen en la taza. Las notas como cacao o fruta describen sensaciones: no significan que se hayan agregado esos ingredientes. En estas fichas no hay notas específicas de cacao o frutas confirmadas.' },
  { id: 'tostado', section: 'Sabor y técnica', title: 'Tostado medio y medio oscuro',
    answer: 'El tostado desarrolla el aroma y el sabor del café. Un tostado más oscuro suele resaltar sabores tostados y amargor; uno medio puede conservar más del carácter del grano.',
    detail: 'Son tendencias generales, no una escala de calidad. No confundas un tueste oscuro con un café mal preparado ni atribuyas más cafeína al color. En nuestras fichas: Tradicional es medio oscuro y Exportación es medio.', source: 'tostado' },
  { id: 'cuerpo', section: 'Sabor y técnica', title: 'Acidez, amargor, aroma y cuerpo',
    answer: 'Acidez es la sensación viva o brillante del café; amargor es otra sensación. El aroma es lo que percibimos al oler. El cuerpo es el peso o la textura que deja en la boca.',
    detail: '“Buen cuerpo” no equivale a más cafeína. Una acidez agradable puede formar parte del café; una taza agresivamente agria, amarga o seca merece revisar la preparación. Describe lo que percibes sin inventar una nota de cata.' },
  { id: 'leche', section: 'Sabor y técnica', title: '¿Por qué la leche queda sedosa o con burbujas?',
    answer: 'Al vaporizar incorporamos aire y calentamos la leche. Una microespuma de burbujas pequeñas da una textura uniforme y sedosa; las burbujas grandes se sienten más aireadas.',
    detail: 'El latte busca una capa fina de microespuma; el capuchino incorpora más espuma. Usa la leche y cantidad de la receta, una jarra limpia y el procedimiento de la barra. La apariencia bonita no sustituye una extracción y una leche bien preparadas.' },
  { id: 'preparar', section: 'Sabor y técnica', title: 'Preparar café es repetir una buena taza',
    answer: 'Cada taza debe respetar la receta y el café elegido: medimos, preparamos y revisamos el resultado para que el cliente reciba lo que pidió.',
    detail: 'Antes: revisa la bolsa en uso y la personalización del ticket. Durante: sigue dosis, rendimiento y tiempos de la receta; mantén limpios los utensilios. Después: revisa presentación, temperatura y consistencia. Si sale agrio, muy amargo o aguado, avisa y revisa molienda, dosis, agua y extracción; no cambies varios ajustes a la vez. Esta guía no reemplaza “Ver receta”.' },
  { id: 'historia', section: 'Historia', title: 'La historia del café en un minuto',
    answer: 'La historia del café se vincula con Etiopía. En el siglo XV ya se cultivaba y comerciaba en Yemen; después se extendió por otras regiones y llegó a Europa en el siglo XVII.',
    detail: 'Las cafeterías se convirtieron en lugares para conversar e intercambiar ideas. El relato del pastor Kaldi y sus cabras es una leyenda, no un hecho comprobado. El café que bebemos se prepara con las semillas tostadas del fruto del cafeto.', source: 'historia' },
  { id: 'rilly', section: 'Historia', title: 'La historia de Rilly de Liévano',
    answer: 'Nuestro proveedor es una empresa chiapaneca que participa desde la producción hasta el tostado y la comercialización del café.',
    detail: 'Según su ficha de septiembre de 2024, la finca Santa Rosa se estableció en 1968, la empresa tiene experiencia como tostadora desde 2004 y trabaja café de especialidad desde 2013. Eso no constituye por sí solo una certificación o puntuación para todas sus líneas.', source: 'proveedor' },
];
export const normalizeCoffeeSearch = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function findCoffeeArticles(query, section) {
  const words = normalizeCoffeeSearch(query).trim().split(/\s+/).filter(Boolean);
  return coffeeArticles.filter(article => words.length
    ? words.every(word => normalizeCoffeeSearch([article.title, article.answer, article.detail, ...(article.facts || []).flat()].join(' ')).includes(word))
    : article.section === section);
}
