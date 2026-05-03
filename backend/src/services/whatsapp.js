const axios = require('axios');

function isWhatsAppConfigured() {
  return Boolean(process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function toE164(tr) {
  if (!tr) return '';
  const digits = String(tr).replace(/\D/g, '');
  if (digits.startsWith('90')) return '+' + digits;
  if (digits.startsWith('0')) return '+90' + digits.slice(1);
  return '+90' + digits;
}

function buildMessage({ daire_no, sahip_ad, plakalar }) {
  const liste = (plakalar || []).join(', ');
  return (
    `Sayın ${sahip_ad}, ${daire_no} numaralı dairenize tanımlı birden fazla araç ` +
    `(${liste}) site otoparkında tespit edildi. ` +
    `Lütfen en kısa sürede fazla olan aracı/araçları çıkartınız.`
  );
}

async function sendTemplate({ telefon, daire_no, sahip_ad, plakalar }) {
  const to = toE164(telefon);
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_API_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'ihlal_bildirimi';

  if (!isWhatsAppConfigured()) {
    return {
      ok: true,
      mock: true,
      to,
      mesaj: buildMessage({ daire_no, sahip_ad, plakalar }),
    };
  }

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  try {
    const { data } = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'tr' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: sahip_ad || '' },
                { type: 'text', text: daire_no || '' },
                { type: 'text', text: (plakalar || []).join(', ') },
              ],
            },
          ],
        },
      },
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    return { ok: true, mock: false, to, response: data };
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    const transient = !status || status >= 500;
    return {
      ok: false,
      transient,
      to,
      hata: data?.error?.message || err.message,
      raw: data,
    };
  }
}

module.exports = { isWhatsAppConfigured, sendTemplate, buildMessage, toE164 };
