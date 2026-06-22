require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API de la cafetería escuchando en el puerto ${PORT}`);
});
