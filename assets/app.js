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

  // Link público da página de um documento (é o conteúdo do QR Code).
  linkDoc(id, base) {
    let b = base || new URL('./', location.href).href;
    if (!b.endsWith('/')) b += '/';
    return b + 'doc.html?id=' + encodeURIComponent(id);
  },

  // Requer a biblioteca qrcodejs carregada na página.
  qrCanvas(texto, tamanho) {
    const div = document.createElement('div');
    new QRCode(div, { text: texto, width: tamanho, height: tamanho, correctLevel: QRCode.CorrectLevel.M });
    return div.querySelector('canvas');
  },

  // Folha A4 em nova aba: título do manual, QR Code no centro e instruções de uso.
  // Os textos podem ser editados direto na página antes de imprimir.
  imprimirA4(doc, link) {
    const qr = this.qrCanvas(link, 1000).toDataURL('image/png');
    const e = s => this.esc(s);
    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(doc.titulo)} · QR Code</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #e5e5e5; font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; color: #1f1f1f; }
  .barra { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap;
    padding: 10px 16px; background: #1f1f1f; color: #ccc; font-size: 13px; }
  .barra button { height: 32px; padding: 0 18px; border: 0; border-radius: 4px; background: #0078d4; color: #fff; font: inherit; cursor: pointer; }
  .barra button:hover { background: #026ec1; }
  .folha { width: 210mm; height: 297mm; margin: 16px auto; background: #fff; padding: 22mm 20mm 16mm;
    display: flex; flex-direction: column; align-items: center; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,.15); overflow: hidden; }
  .rotulo { font-size: 11pt; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #005fb8; }
  .linha { width: 28mm; height: 3px; background: #005fb8; margin: 6mm auto; border-radius: 2px; }
  h1 { font-size: 30pt; line-height: 1.15; margin: 0; font-weight: 700; letter-spacing: -.3px; max-width: 100%; overflow-wrap: anywhere; }
  .descricao { font-size: 13pt; color: #555; margin: 4mm 0 0; }
  .qr { margin: auto 0; padding: 7mm; border: 1.5px solid #d4d4d4; border-radius: 6mm; }
  .qr img { display: block; width: 95mm; height: 95mm; }
  .chamada { font-size: 18pt; font-weight: 700; margin: 0 0 6mm; }
  ol { list-style: none; padding: 0; margin: 0 0 8mm; display: flex; gap: 6mm; justify-content: center; }
  li { flex: 1; max-width: 42mm; font-size: 10.5pt; color: #3b3b3b; line-height: 1.35; }
  li b { display: flex; align-items: center; justify-content: center; width: 9mm; height: 9mm; margin: 0 auto 2.5mm;
    border-radius: 50%; background: #005fb8; color: #fff; font-size: 12pt; }
  [contenteditable]:hover { outline: 1px dashed #9ec5f0; outline-offset: 2px; }
  [contenteditable]:focus { outline: 1px solid #0078d4; outline-offset: 2px; }
  @media print {
    body { background: #fff; }
    .barra { display: none; }
    .folha { margin: 0; box-shadow: none; }
    [contenteditable] { outline: none !important; }
  }
</style>
</head>
<body>
  <div class="barra">
    <span>Clique nos textos para editar antes de imprimir.</span>
    <button onclick="print()">Imprimir / Salvar PDF</button>
  </div>
  <div class="folha">
    <div class="rotulo" contenteditable>Manual do produto</div>
    <div class="linha"></div>
    <h1 contenteditable>${e(doc.titulo)}</h1>
    <p class="descricao" contenteditable>${e(doc.descricao || '')}</p>
    <div class="qr"><img src="${qr}" alt="QR Code"></div>
    <p class="chamada" contenteditable>Escaneie o QR Code para acessar o manual</p>
    <ol>
      <li><b>1</b><span contenteditable>Abra a câmera do seu celular</span></li>
      <li><b>2</b><span contenteditable>Aponte para o QR Code acima</span></li>
      <li><b>3</b><span contenteditable>Toque no link que aparecer na tela</span></li>
      <li><b>4</b><span contenteditable>Visualize ou baixe o manual em PDF</span></li>
    </ol>
  </div>
</body>
</html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('O navegador bloqueou a nova aba. Permita pop-ups para este site e tente de novo.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  },
};
