// Servicio de SMS abstraído: en desarrollo solo IMPRIME el código (cero costo,
// cero cuenta de SMS necesaria para trabajar); en producción usa AWS SNS, ya
// que el hosting final es AWS y así no se necesita una cuenta de Twilio
// aparte. Cambiar de proveedor es cambiar SMS_PROVIDER en .env, no código.
const PROVIDER = process.env.SMS_PROVIDER || 'console';
const COUNTRY_CODE = process.env.SMS_COUNTRY_CODE || '52';

async function enviarSms(telefono, mensaje) {
  if (PROVIDER === 'console') {
    // eslint-disable-next-line no-console
    console.log(`[SMS simulado] a +${COUNTRY_CODE}${telefono}: ${mensaje}`);
    return { ok: true, simulado: true };
  }

  if (PROVIDER === 'sns') {
    // Carga perezosa: si nunca se usa SNS, no hace falta tener el paquete
    // instalado en ambientes donde solo se prueba en modo "console".
    // eslint-disable-next-line global-require
    const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
    const client = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    await client.send(new PublishCommand({
      PhoneNumber: `+${COUNTRY_CODE}${telefono}`,
      Message: mensaje,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    }));
    return { ok: true };
  }

  throw new Error(`SMS_PROVIDER desconocido: "${PROVIDER}". Usa "console" o "sns".`);
}

module.exports = { enviarSms };
