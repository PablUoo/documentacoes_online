// Funções compartilhadas entre as páginas públicas e o painel admin.
const App = {
  DATA_PATH: 'data/documentos.json',

  async carregarPublico() {
    const r = await fetch(this.DATA_PATH + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return [];
    return r.json();
  },

  // Gera os links de visualização, download e incorporação conforme a origem.
  links(doc) {
    if (doc.tipo === 'arquivo') {
      const abs = new URL(doc.arquivo, location.href).href;
      return { ver: doc.arquivo, baixar: doc.arquivo, embed: doc.arquivo, absoluto: abs, local: true };
    }
    const url = doc.url || '';
    const gdoc = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
    if (gdoc) {
      const base = `https://docs.google.com/${gdoc[1]}/d/${gdoc[2]}`;
      return { ver: base + '/view', baixar: base + '/export?format=pdf', embed: base + '/preview' };
    }
    if (/drive\.google\.com/.test(url)) {
      const m = url.match(/\/d\/([\w-]{10,})/) || url.match(/[?&]id=([\w-]{10,})/);
      if (m) {
        const id = m[1];
        return {
          ver: `https://drive.google.com/file/d/${id}/view`,
          baixar: `https://drive.google.com/uc?export=download&id=${id}`,
          embed: `https://drive.google.com/file/d/${id}/preview`,
        };
      }
    }
    return { ver: url, baixar: url, embed: url };
  },

  ehMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
};
