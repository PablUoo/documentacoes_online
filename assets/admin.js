const $ = s => document.querySelector(s);
const CFG_KEY = 'docqr.config';
const MAX_MB = 25;

let cfg = {};
let docs = [];
let docsSha = null;
let editando = null;

// ---------- Configuração ----------

function lerCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
}
function gravarCfg(c) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch { /* sem storage */ }
}

// Em usuario.github.io/repo/ dá para deduzir usuário e repositório.
function detectarRepo() {
  const h = location.hostname;
  if (!h.endsWith('.github.io')) return {};
  const owner = h.split('.')[0];
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: seg && !seg.endsWith('.html') ? seg : h };
}

function baseSite() {
  let b = cfg.baseUrl || new URL('./', location.href).href;
  if (!b.endsWith('/')) b += '/';
  return b;
}
function linkDoc(id) {
  return baseSite() + 'doc.html?id=' + encodeURIComponent(id);
}

// ---------- Mensagens ----------

function aviso(texto, tipo = '') {
  $('#msg').innerHTML = texto ? `<div class="aviso ${tipo}">${App.esc(texto)}</div>` : '';
  if (tipo === 'ok') setTimeout(() => { if ($('#msg').textContent === texto) aviso(''); }, 6000);
}

// ---------- API do GitHub ----------

async function gh(path, { method = 'GET', body, allow404 = false } = {}) {
  let url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/` +
    path.split('/').map(encodeURIComponent).join('/');
  if (method === 'GET') url += '?ref=' + encodeURIComponent(cfg.branch);
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (r.status === 404 && allow404) return null;
  if (!r.ok) {
    let detalhe = '';
    try { detalhe = (await r.json()).message; } catch { /* sem corpo */ }
    const e = new Error(`GitHub ${r.status}: ${detalhe}`);
    e.status = r.status;
    throw e;
  }
  return r.status === 204 ? null : r.json();
}

function bytesParaB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function b64ParaTexto(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

async function carregarDocs() {
  const r = await gh(App.DATA_PATH, { allow404: true });
  if (!r) { docs = []; docsSha = null; return; }
  docs = JSON.parse(b64ParaTexto(r.content) || '[]');
  docsSha = r.sha;
}

async function salvarDocs(mensagem) {
  const conteudo = new TextEncoder().encode(JSON.stringify(docs, null, 2) + '\n');
  const body = { message: mensagem, content: bytesParaB64(conteudo), branch: cfg.branch };
  if (docsSha) body.sha = docsSha;
  const r = await gh(App.DATA_PATH, { method: 'PUT', body });
  docsSha = r.content.sha;
}

// Recarrega a lista do repositório antes de alterar, para não sobrescrever mudanças feitas em outro lugar.
async function alterarDocs(mensagem, alteracao) {
  await carregarDocs();
  alteracao(docs);
  await salvarDocs(mensagem);
}

async function enviarPdf(file, id) {
  const nome = file.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'documento';
  const path = `arquivos/${id}-${nome}.pdf`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await gh(path, { method: 'PUT', body: { message: `Envia PDF: ${file.name}`, content: bytesParaB64(bytes), branch: cfg.branch } });
  return path;
}

async function excluirArquivo(path, mensagem) {
  const meta = await gh(path, { allow404: true });
  if (meta) await gh(path, { method: 'DELETE', body: { message: mensagem, sha: meta.sha, branch: cfg.branch } });
}

function novoId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-3);
}

// ---------- Telas ----------

function mostrarLogin() {
  const det = detectarRepo();
  $('#cfgOwner').value = cfg.owner || det.owner || '';
  $('#cfgRepo').value = cfg.repo || det.repo || '';
  $('#cfgBranch').value = cfg.branch || 'main';
  $('#cfgToken').value = '';
  $('#cfgBase').value = cfg.baseUrl || '';
  $('#telaLogin').classList.remove('oculto');
  $('#telaDocs').classList.add('oculto');
  $('#btnSair').classList.add('oculto');
  $('#statusRepo').textContent = 'Desconectado';
  $('#statusContagem').textContent = '';
}

async function conectar() {
  aviso('Conectando...');
  try {
    await carregarDocs();
    $('#telaLogin').classList.add('oculto');
    $('#telaDocs').classList.remove('oculto');
    $('#btnSair').classList.remove('oculto');
    aviso('');
    renderLista();
  } catch (e) {
    const dicas = { 401: 'Token inválido ou expirado.', 403: 'O token não tem permissão neste repositório.', 404: 'Repositório ou branch não encontrado (ou o token não tem acesso a ele).' };
    aviso(dicas[e.status] || e.message, 'erro');
    mostrarLogin();
  }
}

function renderLista() {
  const termo = $('#busca').value.trim().toLowerCase();
  const filtrados = docs
    .filter(d => !termo || (d.titulo + ' ' + (d.descricao || '')).toLowerCase().includes(termo))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
  $('#lista').innerHTML = filtrados.map(d => `
    <li>
      <div class="info">
        <div class="titulo">${App.esc(d.titulo)}</div>
        <div class="small">
          <span class="tag">${d.tipo === 'arquivo' ? 'PDF no site' : 'Link'}</span>
          ${d.ativo === false ? '<span class="tag off">Desativado</span>' : ''}
          ${d.listar === false ? '<span class="tag">Oculto da lista</span>' : ''}
        </div>
      </div>
      <div class="botoes">
        <button class="btn primario" data-acao="qr" data-id="${d.id}">QR Code</button>
        <button class="btn" data-acao="editar" data-id="${d.id}">Editar</button>
        <button class="btn perigo" data-acao="excluir" data-id="${d.id}">Excluir</button>
      </div>
    </li>`).join('');
  $('#statusRepo').textContent = `⎇ ${cfg.owner}/${cfg.repo} · ${cfg.branch}`;
  $('#statusContagem').textContent = `${docs.length} documento${docs.length === 1 ? '' : 's'}`;
  $('#vazio').textContent = docs.length ? (filtrados.length ? '' : 'Nada encontrado.') : 'Nenhum documento ainda. Clique em “+ Novo documento”.';
}

// ---------- Formulário ----------

function atualizarTipo() {
  const tipo = document.querySelector('input[name=fTipo]:checked').value;
  $('#campoLink').classList.toggle('oculto', tipo !== 'link');
  $('#campoArquivo').classList.toggle('oculto', tipo !== 'arquivo');
}

function abrirForm(doc = null) {
  editando = doc;
  $('#dlgDocTitulo').textContent = doc ? 'Editar documento' : 'Novo documento';
  $('#fTitulo').value = doc?.titulo || '';
  $('#fDescricao').value = doc?.descricao || '';
  document.querySelector(`input[name=fTipo][value=${doc?.tipo || 'link'}]`).checked = true;
  $('#fUrl').value = doc?.url || '';
  $('#fArquivo').value = '';
  $('#arquivoAtual').textContent = doc?.arquivo ? `Arquivo atual: ${doc.arquivo} (envie outro só se quiser substituir)` : '';
  $('#fAtivo').checked = doc ? doc.ativo !== false : true;
  $('#fListar').checked = doc ? doc.listar !== false : true;
  atualizarTipo();
  $('#dlgDoc').showModal();
}

async function salvarForm(ev) {
  ev.preventDefault();
  const tipo = document.querySelector('input[name=fTipo]:checked').value;
  const titulo = $('#fTitulo').value.trim();
  const url = $('#fUrl').value.trim();
  const file = $('#fArquivo').files[0];

  if (!titulo) return;
  if (tipo === 'link' && !url) { alert('Informe o link do documento.'); return; }
  if (tipo === 'arquivo' && !file && !editando?.arquivo) { alert('Selecione um arquivo PDF.'); return; }
  if (file && file.size > MAX_MB * 1024 * 1024) {
    alert(`O arquivo tem ${(file.size / 1048576).toFixed(1)} MB. O limite é ${MAX_MB} MB — para arquivos maiores, use um link do Google Drive.`);
    return;
  }

  const btn = $('#btnSalvar');
  btn.disabled = true;
  btn.textContent = file ? 'Enviando PDF...' : 'Salvando...';
  try {
    const id = editando?.id || novoId();
    const agora = new Date().toISOString();
    let arquivo = tipo === 'arquivo' ? editando?.arquivo : undefined;
    const arquivoAntigo = editando?.arquivo;

    if (tipo === 'arquivo' && file) arquivo = await enviarPdf(file, id);

    const registro = {
      id, titulo,
      descricao: $('#fDescricao').value.trim(),
      tipo,
      ...(tipo === 'link' ? { url } : { arquivo }),
      ativo: $('#fAtivo').checked,
      listar: $('#fListar').checked,
      criadoEm: editando?.criadoEm || agora,
      atualizadoEm: agora,
    };

    await alterarDocs(`${editando ? 'Atualiza' : 'Adiciona'} documento: ${titulo}`, lista => {
      const i = lista.findIndex(d => d.id === id);
      if (i >= 0) lista[i] = registro; else lista.push(registro);
    });

    // Remove o PDF antigo se ele foi substituído ou se a origem virou link.
    if (arquivoAntigo && arquivoAntigo !== arquivo) {
      await excluirArquivo(arquivoAntigo, `Remove PDF antigo de: ${titulo}`).catch(() => {});
    }

    $('#dlgDoc').close();
    renderLista();
    aviso('Salvo! O site público é atualizado pelo GitHub Pages em cerca de 1 minuto.', 'ok');
    if (!editando) abrirQr(registro);
  } catch (e) {
    alert('Erro ao salvar: ' + e.message + (e.status === 409 ? '\nO repositório mudou enquanto você editava. Tente de novo.' : ''));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function excluirDoc(doc) {
  if (!confirm(`Excluir “${doc.titulo}”?\nO QR Code deste documento deixará de funcionar.\n\nSe quiser só bloquear temporariamente, use “Editar” e desmarque “Ativo”.`)) return;
  aviso('Excluindo...');
  try {
    await alterarDocs(`Remove documento: ${doc.titulo}`, lista => {
      const i = lista.findIndex(d => d.id === doc.id);
      if (i >= 0) lista.splice(i, 1);
    });
    if (doc.arquivo) await excluirArquivo(doc.arquivo, `Remove PDF de: ${doc.titulo}`).catch(() => {});
    renderLista();
    aviso('Documento excluído.', 'ok');
  } catch (e) {
    aviso('Erro ao excluir: ' + e.message, 'erro');
  }
}

// ---------- QR Code ----------

let qrAtual = null;

function abrirQr(doc) {
  const link = linkDoc(doc.id);
  qrAtual = { doc, link };
  $('#qrTitulo').textContent = doc.titulo;
  $('#qrLink').textContent = link;
  $('#btnAbrirLink').href = link;
  const box = $('#qrBox');
  box.innerHTML = '';
  const img = new Image();
  img.src = App.qrCanvas(link, 520).toDataURL('image/png');
  img.width = 260;
  img.alt = 'QR Code';
  box.appendChild(img);
  if (/^(file:|http:\/\/(localhost|127\.0\.0\.1))/.test(link)) {
    $('#qrLink').textContent += '  ⚠ endereço local — configure a “URL pública do site” em Sair → Conectar.';
  }
  $('#dlgQr').showModal();
}

// PNG em alta resolução com o título embaixo, pronto para imprimir.
function baixarQr() {
  const { doc, link } = qrAtual;
  const tam = 1000, margem = 60, alturaTexto = 140;
  const qr = App.qrCanvas(link, tam);
  const c = document.createElement('canvas');
  c.width = tam + margem * 2;
  c.height = tam + margem * 2 + alturaTexto;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(qr, margem, margem);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  let fonte = 56;
  ctx.font = `600 ${fonte}px system-ui, sans-serif`;
  while (ctx.measureText(doc.titulo).width > c.width - margem * 2 && fonte > 24) {
    fonte -= 2;
    ctx.font = `600 ${fonte}px system-ui, sans-serif`;
  }
  ctx.fillText(doc.titulo, c.width / 2, tam + margem + 90, c.width - margem * 2);
  const a = document.createElement('a');
  a.download = 'qrcode-' + doc.titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
  a.href = c.toDataURL('image/png');
  a.click();
}

function imprimirA4() {
  App.imprimirA4(qrAtual.doc, qrAtual.link);
}

async function copiarLink() {
  try {
    await navigator.clipboard.writeText(qrAtual.link);
    $('#btnCopiar').textContent = 'Copiado!';
  } catch {
    prompt('Copie o link:', qrAtual.link);
  }
  setTimeout(() => { $('#btnCopiar').textContent = 'Copiar link'; }, 1500);
}

// ---------- Eventos ----------

$('#formLogin').addEventListener('submit', ev => {
  ev.preventDefault();
  cfg = {
    owner: $('#cfgOwner').value.trim(),
    repo: $('#cfgRepo').value.trim(),
    branch: $('#cfgBranch').value.trim() || 'main',
    token: $('#cfgToken').value.trim(),
    baseUrl: $('#cfgBase').value.trim(),
  };
  gravarCfg(cfg);
  conectar();
});

$('#btnSair').addEventListener('click', () => {
  cfg = { ...cfg, token: '' };
  gravarCfg(cfg);
  aviso('');
  mostrarLogin();
});

$('#btnNovo').addEventListener('click', () => abrirForm());
$('#busca').addEventListener('input', renderLista);
$('#lista').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-acao]');
  if (!b) return;
  const doc = docs.find(d => d.id === b.dataset.id);
  if (!doc) return;
  if (b.dataset.acao === 'qr') abrirQr(doc);
  if (b.dataset.acao === 'editar') abrirForm(doc);
  if (b.dataset.acao === 'excluir') excluirDoc(doc);
});

document.querySelectorAll('input[name=fTipo]').forEach(r => r.addEventListener('change', atualizarTipo));
$('#formDoc').addEventListener('submit', salvarForm);
$('#btnCancelar').addEventListener('click', () => $('#dlgDoc').close());
$('#btnBaixarQr').addEventListener('click', baixarQr);
$('#btnImprimir').addEventListener('click', imprimirA4);
$('#btnCopiar').addEventListener('click', copiarLink);
$('#btnFecharQr').addEventListener('click', () => $('#dlgQr').close());

// ---------- Início ----------

cfg = lerCfg();
if (cfg.token && cfg.owner && cfg.repo) conectar(); else mostrarLogin();
