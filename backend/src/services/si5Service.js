const SI5_BASE_URL = 'https://global.si5.com.br/api';

function getToken() {
  return process.env.SI5_API_TOKEN || '';
}

async function si5Request(path) {
  const token = getToken();
  if (!token) {
    throw new Error('SI5_API_TOKEN não configurado nas variáveis de ambiente do servidor.');
  }

  const res = await fetch(`${SI5_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401) throw new Error('Token SI5 Global inválido ou expirado.');
  if (res.status === 404) throw new Error('Produto não encontrado na base SI5 Global.');
  if (res.status === 429) throw new Error('Limite diário de consultas da API SI5 Global atingido.');
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Erro na API SI5 Global (HTTP ${res.status}): ${txt.slice(0, 200)}`);
  }

  return res.json();
}

async function searchSi5Products({ q = '', page = 1, per_page = 20 }) {
  const params = new URLSearchParams({
    q: String(q || ''),
    page: String(page || 1),
    per_page: String(Math.min(100, Number(per_page || 20))),
  });
  return si5Request(`/produtos?${params.toString()}`);
}

async function getSi5ProductByBarcode(codbar) {
  const clean = String(codbar || '').trim();
  if (!clean) throw new Error('Código de barras (GTIN/EAN) é obrigatório.');
  return si5Request(`/produtos/${encodeURIComponent(clean)}`);
}

module.exports = {
  searchSi5Products,
  getSi5ProductByBarcode,
};
